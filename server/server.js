/**
 * 红黑榜打卡 · 防刷后台（Node.js + Express，可选 Redis）
 *
 * 规则：打卡票数不设上限（每个产品每人只算 1 票，可随时改），
 *       只拦截"同一个 IP / 同一个账号 / 同一台设备"在短时间内反复提交刷榜。
 *
 * 运行：
 *   npm i express ioredis
 *   REDIS_URL=redis://127.0.0.1:6379 node server.js     # 有 Redis（多台服务器共享计数，推荐）
 *   node server.js                                        # 无 Redis：单机内存计数，重启清零
 *
 * 放在腾讯云 CLB / Nginx 后面时，务必把 TRUST_PROXY 设成正确的代理层数，
 * 否则 req.ip 拿到的是负载均衡的地址，所有人会共用一个 IP 额度。
 */

// ======================= 可调参数 =======================
const LIMITS = {
  // —— 按 IP ——
  IP_SUBMITS_PER_MINUTE: 6,        // 同一 IP 每分钟最多提交 6 次（正常人点不了这么快）
  IP_SUBMITS_PER_DAY: 30,          // 同一 IP 每天最多提交 30 次；超过即视为刷榜
  IP_ACCOUNTS_PER_DAY: 8,          // 同一 IP 每天最多出现 8 个不同账号（防一台机器换号刷）
  // —— 按账号 / 设备 ——
  ACCOUNT_SUBMITS_PER_DAY: 30,     // 同一账号每天最多提交 30 次（含重置后重投）
  DEVICE_SUBMITS_PER_DAY: 30,      // 同一设备（浏览器 cookie）每天最多 30 次
  MIN_GAP_MS: 3000,                // 同一账号两次提交至少间隔 3 秒
  // —— 惩罚 ——
  STRIKES_TO_BAN: 5,               // 24 小时内触发限制 5 次 → 封禁
  BAN_SECONDS: 24 * 3600,          // 封禁 24 小时
  // —— 数据校验 ——
  MAX_DECO_PER_PRODUCT: 30,        // 每个产品最多 30 张装饰贴纸（只影响画面，不影响票数）
  MAX_BODY_BYTES: 64 * 1024,       // 请求体最大 64KB
  // —— 白名单（运营/压测用）——
  IP_ALLOWLIST: ["127.0.0.1"],
};
const TRUST_PROXY = Number(process.env.TRUST_PROXY || 1); // 前面有几层代理：CLB=1，CLB+Nginx=2
const PORT = Number(process.env.PORT || 8787);

// 产品白名单：只接受这些 id，其余一律丢弃
const PRODUCTS = new Set([
  "chatgpt","claude","gemini","muse","today-ai","qoder","zcode","tripo","meshy","doubao","deepseek","qianwen","yuanbao","kimi",
  "minimax","stepfun","elys","doubao-work","qianwen-office","workbuddy","dumate","xiaohuanxiong","manus","genspark","cherry",
  "jimeng","kling","xiaoyunque","jianying","libtv","vidu","tapnow","oiioii","antafu","quark","weixin-xiaowei","xiaomei","diandian","anker","plaud"
]);

// ======================= 计数存储 =======================
// 有 REDIS_URL 用 Redis，否则用进程内 Map（仅单机）
function makeStore() {
  if (process.env.REDIS_URL) {
    const Redis = require("ioredis");
    const r = new Redis(process.env.REDIS_URL);
    return {
      async incr(key, ttlSec) { const n = await r.incr(key); if (n === 1) await r.expire(key, ttlSec); return n; },
      async get(key) { return r.get(key); },
      async set(key, val, ttlSec) { return ttlSec ? r.set(key, val, "EX", ttlSec) : r.set(key, val); },
      async sadd(key, member, ttlSec) { await r.sadd(key, member); await r.expire(key, ttlSec); return r.scard(key); },
    };
  }
  const m = new Map(); // key -> {v, exp}
  const alive = k => { const e = m.get(k); if (e && e.exp && e.exp < Date.now()) { m.delete(k); return null; } return e; };
  setInterval(() => { for (const k of m.keys()) alive(k); }, 60_000).unref();
  return {
    async incr(k, ttl) { const e = alive(k) || { v: 0, exp: Date.now() + ttl * 1000 }; e.v++; m.set(k, e); return e.v; },
    async get(k) { const e = alive(k); return e ? e.v : null; },
    async set(k, v, ttl) { m.set(k, { v, exp: ttl ? Date.now() + ttl * 1000 : 0 }); },
    async sadd(k, member, ttl) { const e = alive(k) || { v: new Set(), exp: Date.now() + ttl * 1000 }; e.v.add(member); m.set(k, e); return e.v.size; },
  };
}
const store = makeStore();
const db = new Map(); // 示例用的内存"数据库"：userId -> { picks, updatedAt }。上线请换成 MySQL/MongoDB 等

// ======================= 工具函数 =======================
const day = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // 按北京时间切日
const clamp01 = n => Math.min(1, Math.max(0, Number(n)));

function sanitizePicks(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [pid, p] of Object.entries(raw)) {
    if (!PRODUCTS.has(pid) || !p || (p.v !== "up" && p.v !== "down")) continue;
    if (!Number.isFinite(+p.x) || !Number.isFinite(+p.y)) continue;
    const d = Array.isArray(p.d) ? p.d.slice(0, LIMITS.MAX_DECO_PER_PRODUCT)
      .filter(a => Array.isArray(a) && Number.isFinite(+a[0]) && Number.isFinite(+a[1])).map(a => [clamp01(a[0]), clamp01(a[1])]) : [];
    out[pid] = { v: p.v, x: clamp01(p.x), y: clamp01(p.y), t: Date.now(), d }; // 时间以服务器为准，不信任客户端
  }
  return out;
}

async function strike(ip, reason) {
  const n = await store.incr(`strike:${ip}`, 24 * 3600);
  if (n >= LIMITS.STRIKES_TO_BAN) await store.set(`ban:${ip}`, reason, LIMITS.BAN_SECONDS);
  return n;
}

// ======================= 限流中间件 =======================
async function antiAbuse(req, res, next) {
  const ip = req.ip;
  if (LIMITS.IP_ALLOWLIST.includes(ip)) return next();
  const userId = String(req.userId || "");
  const device = String(req.cookies?.hb_device || req.get("x-device-id") || "");
  const d = day();
  const deny = async (status, msg, reason) => { await strike(ip, reason); res.status(status).json({ ok: false, error: msg, reason }); };

  if (await store.get(`ban:${ip}`)) return res.status(403).json({ ok: false, error: "提交太频繁，已暂时封禁 24 小时", reason: "banned" });

  // 1) 同一 IP：每分钟 / 每天次数
  if (await store.incr(`ip:min:${ip}:${Math.floor(Date.now() / 60000)}`, 70) > LIMITS.IP_SUBMITS_PER_MINUTE)
    return deny(429, "提交太快啦，稍等一分钟", "ip_minute");
  if (await store.incr(`ip:day:${ip}:${d}`, 26 * 3600) > LIMITS.IP_SUBMITS_PER_DAY)
    return deny(429, "这个网络今天提交次数已达上限", "ip_day");
  // 2) 同一 IP 换号
  if (userId && await store.sadd(`ip:accts:${ip}:${d}`, userId, 26 * 3600) > LIMITS.IP_ACCOUNTS_PER_DAY)
    return deny(429, "这个网络今天登录的账号太多了", "ip_accounts");
  // 3) 同一账号：间隔 + 每天次数
  if (userId) {
    const last = Number(await store.get(`acct:last:${userId}`) || 0);
    if (Date.now() - last < LIMITS.MIN_GAP_MS) return deny(429, "提交太快啦，稍等几秒", "acct_gap");
    await store.set(`acct:last:${userId}`, String(Date.now()), 3600);
    if (await store.incr(`acct:day:${userId}:${d}`, 26 * 3600) > LIMITS.ACCOUNT_SUBMITS_PER_DAY)
      return deny(429, "你今天的提交次数已达上限，明天再来", "acct_day");
  }
  // 4) 同一设备
  if (device && await store.incr(`dev:day:${device}:${d}`, 26 * 3600) > LIMITS.DEVICE_SUBMITS_PER_DAY)
    return deny(429, "这台设备今天提交次数已达上限", "device_day");
  next();
}

// ======================= 服务 =======================
const express = require("express");
const app = express();
app.set("trust proxy", TRUST_PROXY);
app.use(express.json({ limit: LIMITS.MAX_BODY_BYTES }));
app.use((req, _res, next) => { // 极简 cookie 解析
  req.cookies = Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split("=")).filter(a => a[0]));
  next();
});
// 鉴权占位：请换成你自己的登录校验（JWT / Session），这里只演示从请求头取用户 ID
app.use((req, res, next) => {
  req.userId = req.get("x-user-id") || "";
  if (req.method === "POST" && !req.userId) return res.status(401).json({ ok: false, error: "请先登录再打卡" });
  next();
});

// 提交打卡：整份覆盖自己的投票（每人一份），票数不限，每个产品只算 1 票
app.post("/api/votes", antiAbuse, (req, res) => {
  const picks = sanitizePicks(req.body && req.body.picks);
  db.set(req.userId, { picks, updatedAt: Date.now() });
  res.json({ ok: true, votes: Object.keys(picks).length });
});

// 汇总：每个产品的好评/差评票数（一人一票）
app.get("/api/summary", (_req, res) => {
  const sum = {};
  for (const { picks } of db.values()) for (const [pid, p] of Object.entries(picks)) {
    const s = (sum[pid] ||= { up: 0, down: 0 }); s[p.v]++;
  }
  res.json({ ok: true, products: sum, voters: db.size });
});

app.listen(PORT, () => console.log(`anti-abuse server on :${PORT}`, LIMITS));

/* ======================= 配套 Nginx 限流（可选，挡在 Node 前面） =======================
http {
  # 每个 IP 每秒 2 次、突发 10 次；超出直接 429
  limit_req_zone $binary_remote_addr zone=vote_rl:10m rate=2r/s;
  server {
    location /api/votes {
      limit_req zone=vote_rl burst=10 nodelay;
      limit_req_status 429;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_pass http://127.0.0.1:8787;
    }
  }
}
*/
