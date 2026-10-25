/**
 * 访问统计 + 行为轨迹（无第三方依赖，落盘 stats.json）
 *
 * 采集：/api/track  （POST，批量事件，sendBeacon 友好）
 * 看板：/api/stats  （GET，需 x-owner-token 或 ?token=）
 * 轨迹：/api/stats/visitor/:vid
 *
 * 隐私：不留原始 IP（只存 sha256 前 12 位做去重）；不采集输入内容。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const KEEP_DAYS = 60;          // 日明细保留天数
const MAX_VISITORS = 20000;    // 访客档案上限
const MAX_STREAM = 3000;       // 轨迹流上限（环形）
const MAX_EVENTS_PER_POST = 40;
const BOT_RE = /bot|spider|crawl|slurp|bingpreview|headless|phantom|python-requests|curl|wget|monitor|uptime/i;

const day = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const hhmm = t => new Date(t + 8 * 3600e3).toISOString().slice(11, 16);

function newDay() { return { pv: 0, sessions: {}, vid: {}, path: {}, ev: {}, ref: {}, dev: {}, br: {} }; }

let STATS = {
  v: 1,
  createdAt: Date.now(),
  days: {},        // 'YYYY-MM-DD' -> newDay()
  visitors: {},    // vid -> { first, last, n, ua, dev, br, ref, ip, days:[], ev:{} }
  stream: [],      // 最近事件（新→旧 由读时排序）
};

function load(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && raw.days) {
      STATS.days = raw.days;
      STATS.visitors = raw.visitors || {};
      STATS.stream = raw.stream || [];
      STATS.createdAt = raw.createdAt || STATS.createdAt;
    }
    console.log("loaded stats: days=%d visitors=%d stream=%d",
      Object.keys(STATS.days).length, Object.keys(STATS.visitors).length, STATS.stream.length);
  } catch (e) { console.log("no stats.json yet, starting empty"); }
}

let saveTimer = null;
function save(file) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      prune();
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(STATS));
      fs.renameSync(tmp, file);
    } catch (e) { console.error("stats save failed", e.message); }
  }, 800);
}

function prune() {
  const keys = Object.keys(STATS.days).sort();
  while (keys.length > KEEP_DAYS) delete STATS.days[keys.shift()];
  if (STATS.stream.length > MAX_STREAM) STATS.stream = STATS.stream.slice(-MAX_STREAM);
  const vkeys = Object.keys(STATS.visitors);
  if (vkeys.length > MAX_VISITORS) {
    vkeys.sort((a, b) => (STATS.visitors[a].last || 0) - (STATS.visitors[b].last || 0));
    for (const k of vkeys.slice(0, vkeys.length - MAX_VISITORS)) delete STATS.visitors[k];
  }
}

// ---------- UA 解析（够用即可） ----------
function parseUA(ua = "") {
  const s = String(ua);
  const dev = /iPad|Tablet/i.test(s) ? "tablet" : /Mobile|Android|iPhone|HarmonyOS/i.test(s) ? "mobile" : "desktop";
  let br = "其他";
  if (/Edg\//.test(s)) br = "Edge";
  else if (/MicroMessenger/i.test(s)) br = "微信";
  else if (/QQBrowser/i.test(s)) br = "QQ浏览器";
  else if (/Chrome\//.test(s)) br = "Chrome";
  else if (/Safari\//.test(s)) br = "Safari";
  else if (/Firefox\//.test(s)) br = "Firefox";
  return { dev, br };
}

const ipHash = ip => crypto.createHash("sha256").update(String(ip || "")).digest("hex").slice(0, 12);
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);

module.exports = function analytics({ file, ownerToken, trustProxyDir = null }) {
  load(file);
  const express = require("express");
  const router = express.Router();
  router.use(express.json({ limit: 48 * 1024 }));

  const isOwner = req => !!ownerToken && (req.get("x-owner-token") === ownerToken || req.query.token === ownerToken);

  // ---------------- 采集 ----------------
  const _hits = new Map(); // ip -> {n, exp} 轻量限流，避免被刷爆
  function tooMany(ip) {
    const now = Date.now();
    const e = _hits.get(ip);
    if (!e || e.exp < now) { _hits.set(ip, { n: 1, exp: now + 60_000 }); return false; }
    e.n++;
    return e.n > 90;   // 每分钟 90 次上报（一批可含多个事件）
  }
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _hits) if (v.exp < now) _hits.delete(k);
  }, 60_000).unref();

  router.post("/track", (req, res) => {
    const ua = String(req.get("user-agent") || "");
    if (BOT_RE.test(ua) && !req.get("x-track-force")) return res.json({ ok: true, skip: "bot" });
    const ip = req.ip;
    if (tooMany(ip)) return res.status(429).json({ ok: false, error: "too many" });

    const body = req.body || {};
    const vid = clip(body.vid, 40).replace(/[^\w-]/g, "");
    if (!/^[\w-]{6,40}$/.test(vid)) return res.status(400).json({ ok: false, error: "bad vid" });
    const sid = clip(body.sid, 40).replace(/[^\w-]/g, "") || "s";
    const list = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_POST) : [];
    if (!list.length) return res.json({ ok: true });

    const d = day();
    const D = (STATS.days[d] ||= newDay());
    const { dev, br } = parseUA(ua);
    const ref = clip(body.ref || req.get("referer") || "", 200);
    const refHost = (() => { try { return ref ? new URL(ref).hostname : "直接访问"; } catch { return "直接访问"; } })();

    let V = STATS.visitors[vid];
    const isNewVisitor = !V;
    if (!V) V = STATS.visitors[vid] = { first: Date.now(), last: 0, n: 0, ua: clip(ua, 160), dev, br, ref: refHost, ip: ipHash(ip), days: [], ev: {} };
    V.last = Date.now(); V.n++; V.dev = dev; V.br = br;
    if (!V.days.includes(d)) V.days.push(d);
    D.vid[vid] = 1;
    if (!D.sessions[sid]) D.sessions[sid] = 1;

    for (const raw of list) {
      const ev = clip(raw && raw.ev, 40) || "unknown";
      const t = Number(raw && raw.t) || Date.now();
      const pth = clip(raw && raw.path, 80) || "/";
      const meta = raw && raw.meta && typeof raw.meta === "object" ? raw.meta : null;

      const rec = { t, vid, sid, ev, path: pth };
      if (meta) rec.meta = truncMeta(meta);

      if (ev === "pageview") {
        D.pv++;
        D.path[pth] = (D.path[pth] || 0) + 1;
        D.ref[refHost] = (D.ref[refHost] || 0) + 1;
        D.dev[dev] = (D.dev[dev] || 0) + 1;
        D.br[br] = (D.br[br] || 0) + 1;
      }
      D.ev[ev] = (D.ev[ev] || 0) + 1;
      V.ev[ev] = (V.ev[ev] || 0) + 1;

      STATS.stream.push(rec);
    }

    save(file);
    res.json({ ok: true, newVisitor: isNewVisitor });
  });

  function truncMeta(m) {
    const out = {};
    for (const k of Object.keys(m).slice(0, 10)) {
      const v = m[k];
      out[clip(k, 16)] = typeof v === "number" ? (Number.isFinite(v) ? v : 0)
        : typeof v === "boolean" ? v : clip(v, 60);
    }
    return out;
  }

  // ---------------- 看板 ----------------
  router.get("/stats", (req, res) => {
    if (!isOwner(req)) return res.status(403).json({ ok: false, error: "owner only" });
    const n = Math.max(1, Math.min(KEEP_DAYS, Number(req.query.days) || 7));
    const keys = Object.keys(STATS.days).sort().slice(-n);
    const series = keys.map(k => {
      const D = STATS.days[k];
      return { day: k, pv: D.pv, uv: Object.keys(D.vid).length, sessions: Object.keys(D.sessions).length, events: Object.values(D.ev).reduce((a, b) => a + b, 0) };
    });

    const agg = { path: {}, ev: {}, ref: {}, dev: {}, br: {} };
    for (const k of keys) {
      const D = STATS.days[k];
      for (const f of ["path", "ev", "ref", "dev", "br"]) for (const [kk, v] of Object.entries(D[f] || {})) agg[f][kk] = (agg[f][kk] || 0) + v;
    }
    const top = (o, k = 12) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([name, n]) => ({ name, n }));

    const nowT = Date.now();
    const online = Object.values(STATS.visitors).filter(v => nowT - (v.last || 0) < 5 * 60 * 1000).length;

    const stream = STATS.stream.slice(-260).reverse().map(e => ({ ...e, hhmm: hhmm(e.t) }));
    const visitors = Object.entries(STATS.visitors)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => (b.last || 0) - (a.last || 0)).slice(0, 60)
      .map(v => ({ ...v, ip: undefined, hhmm: hhmm(v.last), online: nowT - (v.last || 0) < 5 * 60 * 1000 }));

    // 今日漏斗：进入 → 贴纸 → 提交 → 留言
    const d0 = day();
    const D0 = STATS.days[d0] || newDay();
    const funnel = ["pageview", "vote.place", "vote.submit", "note.post", "view.switch", "egg.unlock"]
      .map(ev => ({ ev, n: D0.ev[ev] || 0 }));

    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      now: nowT,
      range: { days: n, from: keys[0] || d0, to: keys[keys.length - 1] || d0 },
      totals: {
        pv: series.reduce((a, b) => a + b.pv, 0),
        uv: Object.keys(STATS.visitors).filter(v => STATS.visitors[v].days.some(dd => keys.includes(dd))).length,
        sessions: series.reduce((a, b) => a + b.sessions, 0),
        events: series.reduce((a, b) => a + b.events, 0),
      },
      today: { pv: D0.pv, uv: Object.keys(D0.vid).length, events: Object.values(D0.ev).reduce((a, b) => a + b, 0) },
      online,
      series,
      funnel,
      topEvents: top(agg.ev),
      topPaths: top(agg.path, 8),
      topRefs: top(agg.ref, 8),
      devices: top(agg.dev, 4),
      browsers: top(agg.br, 6),
      stream,
      visitors,
      days: Object.keys(STATS.days).sort().slice(-KEEP_DAYS),
    });
  });

  // ---------------- 单个访客的完整轨迹 ----------------
  router.get("/stats/visitor/:vid", (req, res) => {
    if (!isOwner(req)) return res.status(403).json({ ok: false, error: "owner only" });
    const vid = String(req.params.vid || "").slice(0, 40);
    const V = STATS.visitors[vid];
    if (!V) return res.status(404).json({ ok: false, error: "not found" });
    const evs = STATS.stream.filter(e => e.vid === vid).slice(-400)
      .map(e => ({ ...e, hhmm: hhmm(e.t), date: day(e.t) }));
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, visitor: { ...V, ip: undefined }, events: evs.reverse() });
  });

  return router;
};
