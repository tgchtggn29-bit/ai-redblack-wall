/**
 * 红黑榜打卡 · 完整后端（Node.js + Express，无需数据库）
 * - 托管静态站（site/）+ 提供数据接口，同源免 CORS
 * - 集合：votes / notes / rhythm / testers（对齐前端）
 * - 落盘：data.json（原子写，防丢）
 * - 防刷：IP/账号/设备 限流 + 封禁（沿用原 LIMITS）
 *
 * 运行： npm i express && PORT=3000 OWNER_TOKEN=xxx node server.js
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");

// ======================= 可调参数 =======================
const LIMITS = {
  IP_SUBMITS_PER_MINUTE: 12,
  IP_SUBMITS_PER_DAY: 60,
  IP_ACCOUNTS_PER_DAY: 12,
  ACCOUNT_SUBMITS_PER_DAY: 60,
  DEVICE_SUBMITS_PER_DAY: 60,
  MIN_GAP_MS: 2000,
  STRIKES_TO_BAN: 8,
  BAN_SECONDS: 24 * 3600,
  MAX_DECO_PER_PRODUCT: 30,
  MAX_BODY_BYTES: 256 * 1024,
  IP_ALLOWLIST: ["127.0.0.1", "::1"],
};
const TRUST_PROXY = Number(process.env.TRUST_PROXY || 1);
const PORT = Number(process.env.PORT || 3000);
const SITE_DIR = process.env.SITE_DIR || path.join(__dirname, "site");
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const OWNER_TOKEN = process.env.OWNER_TOKEN || "";

const PRODUCTS = new Set([
  "chatgpt","claude","gemini","muse","today-ai","qoder","zcode","tripo","meshy","doubao","deepseek","qianwen","yuanbao","kimi",
  "minimax","stepfun","elys","doubao-work","qianwen-office","workbuddy","dumate","xiaohuanxiong","manus","genspark","cherry",
  "jimeng","kling","xiaoyunque","jianying","libtv","vidu","tapnow","oiioii","antafu","quark","weixin-xiaowei","xiaomei","diandian","anker","plaud"
]);

// ======================= 计数存储（限流用，内存即可） =======================
const _m = new Map();
const alive = k => { const e = _m.get(k); if (e && e.exp && e.exp < Date.now()) { _m.delete(k); return null; } return e; };
setInterval(() => { for (const k of _m.keys()) alive(k); }, 60_000).unref();
const store = {
  async incr(k, ttl) { const e = alive(k) || { v: 0, exp: Date.now() + ttl * 1000 }; e.v++; _m.set(k, e); return e.v; },
  async get(k) { const e = alive(k); return e ? e.v : null; },
  async set(k, v, ttl) { _m.set(k, { v, exp: ttl ? Date.now() + ttl * 1000 : 0 }); },
  async sadd(k, member, ttl) { const e = alive(k) || { v: new Set(), exp: Date.now() + ttl * 1000 }; e.v.add(member); _m.set(k, e); return e.v.size; },
};

// ======================= 数据落盘 =======================
let DATA = { votes: {}, notes: {}, rhythm: {}, testers: {} };
try {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  for (const k of ["votes", "notes", "rhythm", "testers"]) DATA[k] = raw[k] || {};
  console.log("loaded data:", Object.fromEntries(Object.entries(DATA).map(([k, v]) => [k, Object.keys(v).length])));
} catch (e) { console.log("no data.json yet, starting empty"); }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = DATA_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(DATA));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) { console.error("save failed", e.message); }
  }, 200);
}

// ======================= 工具 =======================
const day = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const clamp01 = n => Math.min(1, Math.max(0, Number(n)));
const now = () => Date.now();

function sanitizePicks(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [pid, p] of Object.entries(raw)) {
    if (!PRODUCTS.has(pid) || !p || (p.v !== "up" && p.v !== "down")) continue;
    if (!Number.isFinite(+p.x) || !Number.isFinite(+p.y)) continue;
    const d = Array.isArray(p.d) ? p.d.slice(0, LIMITS.MAX_DECO_PER_PRODUCT)
      .filter(a => Array.isArray(a) && Number.isFinite(+a[0]) && Number.isFinite(+a[1])).map(a => [clamp01(a[0]), clamp01(a[1])]) : [];
    out[pid] = { v: p.v, x: clamp01(p.x), y: clamp01(p.y), t: Number(p.t) || now(), d };
  }
  return out;
}

async function strike(ip, reason) {
  const n = await store.incr(`strike:${ip}`, 24 * 3600);
  if (n >= LIMITS.STRIKES_TO_BAN) await store.set(`ban:${ip}`, reason, LIMITS.BAN_SECONDS);
  return n;
}

// ======================= 中间件 =======================
const app = express();
app.set("trust proxy", TRUST_PROXY);
app.use(express.json({ limit: LIMITS.MAX_BODY_BYTES }));
app.use((req, _res, next) => {
  req.cookies = Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split("=")).filter(a => a && a[0]));
  next();
});

function getUid(req, res) {
  let id = String(req.get("x-user-id") || req.cookies.hb_uid || "").trim();
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(id)) {
    id = "u_" + crypto.randomBytes(8).toString("hex");
    res.setHeader("Set-Cookie", `hb_uid=${id}; Path=/; Max-Age=31536000; SameSite=Lax`);
  }
  return id;
}

async function antiAbuse(req, res, next) {
  const ip = req.ip;
  if (LIMITS.IP_ALLOWLIST.includes(ip)) return next();
  const userId = String(req.userId || "");
  const device = String(req.cookies?.hb_device || req.get("x-device-id") || "");
  const d = day();
  const deny = async (status, msg, reason) => { await strike(ip, reason); res.status(status).json({ ok: false, error: msg, reason }); };
  if (await store.get(`ban:${ip}`)) return res.status(403).json({ ok: false, error: "提交太频繁，已暂时封禁 24 小时", reason: "banned" });
  if (await store.incr(`ip:min:${ip}:${Math.floor(Date.now() / 60000)}`, 70) > LIMITS.IP_SUBMITS_PER_MINUTE) return deny(429, "提交太快啦，稍等一分钟", "ip_minute");
  if (await store.incr(`ip:day:${ip}:${d}`, 26 * 3600) > LIMITS.IP_SUBMITS_PER_DAY) return deny(429, "这个网络今天提交次数已达上限", "ip_day");
  if (userId && await store.sadd(`ip:accts:${ip}:${d}`, userId, 26 * 3600) > LIMITS.IP_ACCOUNTS_PER_DAY) return deny(429, "这个网络今天登录的账号太多了", "ip_accounts");
  if (userId) {
    const last = Number(await store.get(`acct:last:${userId}`) || 0);
    if (Date.now() - last < LIMITS.MIN_GAP_MS) return deny(429, "提交太快啦，稍等几秒", "acct_gap");
    await store.set(`acct:last:${userId}`, String(Date.now()), 3600);
    if (await store.incr(`acct:day:${userId}:${d}`, 26 * 3600) > LIMITS.ACCOUNT_SUBMITS_PER_DAY) return deny(429, "你今天的提交次数已达上限，明天再来", "acct_day");
  }
  if (device && await store.incr(`dev:day:${device}:${d}`, 26 * 3600) > LIMITS.DEVICE_SUBMITS_PER_DAY) return deny(429, "这台设备今天提交次数已达上限", "device_day");
  next();
}

app.use((req, _res, next) => { req.userId = getUid(req, _res); next(); });

// ======================= 接口 =======================
app.get("/api/me", (req, res) => {
  const isOwner = !!OWNER_TOKEN && req.get("x-owner-token") === OWNER_TOKEN;
  res.json({ ok: true, id: req.userId, isOwner });
});

app.get("/api/state", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, votes: DATA.votes, notes: DATA.notes, rhythm: DATA.rhythm, testers: DATA.testers });
});

function sanitizeDoc(coll, body, owner) {
  if (!body || typeof body !== "object") return null;
  if (coll === "votes") {
    const picks = sanitizePicks(body.picks);
    const sub = body.sub && typeof body.sub === "object" ? { day: String(body.sub.day || day()).slice(0, 10), n: Math.max(0, Math.min(9999, Number(body.sub.n) || 0)), last: Number(body.sub.last) || now() } : { day: day(), n: 1, last: now() };
    return { picks, sub, demo: false, updatedAt: now() };
  }
  if (coll === "notes") {
    const items = Array.isArray(body.items) ? body.items.slice(0, 20).map(it => (it && typeof it.text === "string") ? { pid: PRODUCTS.has(it.pid) ? it.pid : "", text: it.text.slice(0, 140), t: Number(it.t) || now() } : null).filter(Boolean) : [];
    const nd = body.day && typeof body.day === "object" ? { day: String(body.day.day || day()).slice(0, 10), n: Math.max(0, Math.min(9999, Number(body.day.n) || 0)) } : { day: day(), n: items.length };
    return { items, day: nd, updatedAt: now() };
  }
  if (coll === "rhythm") {
    const out = { updatedAt: now() };
    for (const k of ["easy", "normal", "hard"]) if (Number.isFinite(+body[k])) out[k] = Math.max(0, Math.min(999999, Math.round(+body[k])));
    if (Number.isFinite(+body.t)) out.t = Number(body.t);
    return out;
  }
  if (coll === "testers") {
    if (!owner) return null;
    return { on: body.on === true, updatedAt: now() };
  }
  return null;
}

const COLLS = new Set(["votes", "notes", "rhythm", "testers"]);
app.post("/api/state", antiAbuse, (req, res) => {
  const { collection, id, body } = req.body || {};
  if (!COLLS.has(collection)) return res.status(400).json({ ok: false, error: "bad collection" });
  const isOwner = !!OWNER_TOKEN && req.get("x-owner-token") === OWNER_TOKEN;
  const targetId = String(id || req.userId);
  if (collection === "testers") { if (!isOwner) return res.status(403).json({ ok: false, error: "owner only" }); }
  else if (targetId !== req.userId) return res.status(403).json({ ok: false, error: "can only write your own doc" });
  const doc = sanitizeDoc(collection, body, isOwner);
  if (!doc) return res.status(400).json({ ok: false, error: "bad body" });
  DATA[collection][targetId] = doc;
  save();
  res.json({ ok: true, id: targetId });
});

// 兼容旧接口
app.post("/api/votes", antiAbuse, (req, res) => {
  const picks = sanitizePicks(req.body && req.body.picks);
  DATA.votes[req.userId] = { picks, sub: { day: day(), n: 1, last: now() }, demo: false, updatedAt: now() };
  save();
  res.json({ ok: true, votes: Object.keys(picks).length });
});
app.get("/api/summary", (_req, res) => {
  const sum = {};
  for (const { picks } of Object.values(DATA.votes)) for (const [pid, p] of Object.entries(picks || {})) {
    const s = (sum[pid] ||= { up: 0, down: 0 }); s[p.v]++;
  }
  res.json({ ok: true, products: sum, voters: Object.keys(DATA.votes).length });
});

// ======================= 访问统计 + 行为轨迹 =======================
const analytics = require("./analytics");
const STATS_FILE = process.env.STATS_FILE || path.join(__dirname, "stats.json");
app.use("/api", analytics({ file: STATS_FILE, ownerToken: OWNER_TOKEN }));

// 健康检查
app.get("/api/health", (_req, res) => res.json({ ok: true, voters: Object.keys(DATA.votes).length, notes: Object.keys(DATA.notes).length }));

// ======================= 静态站 =======================
app.use(express.static(SITE_DIR, { extensions: ["html"], maxAge: "1h" }));
app.get("*", (req, res) => { // 兜底回首页
  if (req.path.startsWith("/api/")) return res.status(404).json({ ok: false, error: "not found" });
  res.sendFile(path.join(SITE_DIR, "index.html"));
});

app.listen(PORT, "127.0.0.1", () => console.log(`vote server on 127.0.0.1:${PORT}`));
