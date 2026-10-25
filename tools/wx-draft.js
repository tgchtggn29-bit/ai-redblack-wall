#!/usr/bin/env node
/**
 * 把文章推进微信公众号草稿箱（零依赖，Node 18+ 自带 fetch/FormData）
 *
 * 用法：
 *   WX_APPID=wx... WX_SECRET=... node wx-draft.js --html ./wx-article.html --cover ./cover.png
 *   node wx-draft.js --html ... --cover ... --dry      # 只验凭证，不写任何东西
 *
 * 可选参数：
 *   --title "..."      默认取 HTML <title>
 *   --author "..."     默认 zhaoweng
 *   --digest "..."     默认自动截取正文前 110 字
 *   --source URL       原文链接（阅读原文）
 *   --dry              只获取 access_token 并打印，不创建草稿
 *
 * 流程：token → 正文图逐张 uploadimg（换成微信域名直链）→ 封面上传取 thumb_media_id → draft/add
 */
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const arg = (k, d = "") => {
  const i = args.indexOf("--" + k);
  return i >= 0 ? args[i + 1] : d;
};
const has = k => args.includes("--" + k);

const APPID = process.env.WX_APPID || arg("appid");
const SECRET = process.env.WX_SECRET || arg("secret");
const HTML = arg("html");
const COVER = arg("cover");
const SOURCE = arg("source", "https://vote.wqai.ltd/");
const DRY = has("dry");

const API = "https://api.weixin.qq.com";

function die(msg, hint) {
  console.error("\n❌ " + msg);
  if (hint) console.error("   " + hint);
  process.exit(1);
}

const ERR = {
  "-1": ["微信系统繁忙，稍后重试"],
  40001: ["AppSecret 不正确（或 access_token 已失效）", "去 公众平台→设置与开发→基本配置 重新生成开发者密码"],
  40013: ["AppID 不合法", "核对是否复制了完整的 wx 开头 18 位 AppID"],
  40125: ["AppSecret 无效", "AppSecret 只在生成时显示一次，重置后旧的立即失效"],
  40164: ["调用来源 IP 不在白名单", "把本机出口 IP 加进 基本配置→IP 白名单"],
  48001: ["该接口未授权（api unauthorized）", "草稿箱接口需要【已认证】的公众号；个人未认证订阅号没有这个权限"],
  45009: ["接口调用次数已达上限", "公众号每日调用配额用完，明天再试"],
  45002: ["内容超长", "正文超过 20000 字或 1MB，需要拆篇"],
  40007: ["media_id 无效", "封面上传失败，重跑一次"],
};
function check(j, step) {
  if (j && j.errcode) {
    const [m, h] = ERR[j.errcode] || ["未知错误", ""];
    die(`${step} 失败：${m}（errcode=${j.errcode}${j.errmsg ? "，" + j.errmsg : ""}）`, h);
  }
  return j;
}

async function getToken() {
  const u = `${API}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(APPID)}&secret=${encodeURIComponent(SECRET)}`;
  const r = await fetch(u).then(x => x.json());
  check(r, "获取 access_token");
  if (!r.access_token) die("没有拿到 access_token", JSON.stringify(r));
  console.log("✔ access_token 获取成功（有效期 %d 秒）", r.expires_in);
  return r.access_token;
}

/** 正文图片：media/uploadimg，返回微信域名直链 */
async function uploadImage(token, buf, name) {
  const fd = new FormData();
  fd.append("media", new Blob([buf], { type: "image/png" }), name);
  const r = await fetch(`${API}/cgi-bin/media/uploadimg?access_token=${token}`, { method: "POST", body: fd })
    .then(x => x.json());
  check(r, "上传正文图片 " + name);
  if (!r.url) die("上传图片没有返回 url：" + JSON.stringify(r));
  return r.url;
}

/** 封面：material/add_material，返回 media_id */
async function uploadCover(token, buf, name) {
  const fd = new FormData();
  fd.append("media", new Blob([buf], { type: "image/png" }), name);
  const r = await fetch(`${API}/cgi-bin/material/add_material?access_token=${token}&type=image`, { method: "POST", body: fd })
    .then(x => x.json());
  check(r, "上传封面 " + name);
  return r.media_id;
}

async function addDraft(token, article) {
  const r = await fetch(`${API}/cgi-bin/draft/add?access_token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ articles: [article] }),
  }).then(x => x.json());
  check(r, "创建草稿");
  return r.media_id;
}

function stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/\s+/g, " ")
    .trim();
}

(async () => {
  if (!APPID || !SECRET) die("缺少 AppID / AppSecret", "用法：WX_APPID=wx... WX_SECRET=... node wx-draft.js --html 文章.html --cover 封面.png");
  if (!HTML || !fs.existsSync(HTML)) die("找不到 --html 指定的文章文件");

  let html = fs.readFileSync(HTML, "utf8");
  const title = arg("title") || (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "AI 产品红黑榜";
  const text = stripTags(html);
  const digest = arg("digest") || text.slice(0, 110);
  const author = arg("author", "zhaoweng");

  console.log("文章：《%s》", title);
  console.log("正文纯文本约 %d 字，摘要：%s…", text.length, digest.slice(0, 40));

  const token = await getToken();

  if (DRY) {
    console.log("\n✅ --dry 模式：凭证有效，未创建草稿。");
    return;
  }

  // 1) 正文图：本地相对路径 + 公网直链，逐个换成微信图床
  const srcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => m[1]);
  const uniq = [...new Set(srcs)];
  console.log("\n发现 %d 张图（去重后 %d）", srcs.length, uniq.length);
  const map = new Map();
  let n = 0;
  for (const src of uniq) {
    let buf = null;
    let name = "img" + (++n) + ".png";
    if (/^https?:\/\//i.test(src)) {
      const res = await fetch(src);
      if (!res.ok) { console.warn("  ⚠ 跳过（下载失败 %s）：%s", res.status, src); continue; }
      buf = Buffer.from(await res.arrayBuffer());
      name = (src.split("/").pop() || name).replace(/[?#].*$/, "");
      if (/\.jpe?g$/i.test(name)) name = name.replace(/\.jpe?g$/i, ".jpg");
    } else if (/^data:/i.test(src)) {
      const m = src.match(/^data:([^;]+);base64,(.*)$/);
      if (!m) continue;
      buf = Buffer.from(m[2], "base64");
    } else {
      const p = path.resolve(path.dirname(HTML), src);
      if (!fs.existsSync(p)) { console.warn("  ⚠ 找不到本地图：%s", src); continue; }
      buf = fs.readFileSync(p);
    }
    try {
      const wxUrl = await uploadImage(token, buf, name);
      map.set(src, wxUrl);
      console.log("  ✔ %s → %s", src.slice(0, 46), wxUrl.slice(0, 52));
    } catch (e) {
      console.warn("  ⚠ 上传失败，保留原地址：%s", src);
    }
  }
  for (const [from, to] of map) html = html.split(from).join(to);
  console.log("图片替换完成 %d 张", map.size);

  // 2) 封面
  let thumb = "";
  if (COVER && fs.existsSync(COVER)) {
    thumb = await uploadCover(token, fs.readFileSync(COVER), path.basename(COVER));
    console.log("✔ 封面上传成功 media_id=%s", thumb);
  } else {
    console.warn("⚠ 没有提供封面（--cover），草稿会缺缩略图");
  }

  // 3) 草稿
  const article = {
    title,
    author,
    digest,
    content: html,
    content_source_url: SOURCE,
    thumb_media_id: thumb,
    need_open_comment: 0,
    only_fans_can_comment: 0,
  };
  const mid = await addDraft(token, article);
  console.log("\n✅ 已创建草稿 media_id=%s", mid);
  console.log("   打开 公众平台 → 内容与互动 → 草稿箱 就能看到，预览确认后群发。");
})().catch(e => {
  console.error("\n❌ 执行失败：", e.message);
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
