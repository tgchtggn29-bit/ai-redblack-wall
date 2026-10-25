#!/usr/bin/env node
/**
 * 查看公众号草稿箱（只读）
 * 用法：set -a && . ./.wx.env && set +a && node wx-list.js
 */
const APPID = process.env.WX_APPID, SECRET = process.env.WX_SECRET;
const API = "https://api.weixin.qq.com";

(async () => {
  if (!APPID || !SECRET) { console.error("缺少 WX_APPID / WX_SECRET"); process.exit(1); }
  const t = await fetch(`${API}/cgi-bin/token?grant_type=client_credential&appid=${APPID}&secret=${SECRET}`).then(r => r.json());
  if (!t.access_token) { console.error("取 token 失败：", JSON.stringify(t)); process.exit(1); }

  const r = await fetch(`${API}/cgi-bin/draft/batchget?access_token=${t.access_token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offset: 0, count: 5, no_content: 1 }),
  }).then(x => x.json());
  if (r.errcode) { console.error("查询失败：", JSON.stringify(r)); process.exit(1); }

  console.log("草稿总数：%d", r.total_count || 0);
  for (const it of r.item || []) {
    const n = (it.content && it.content.news_item && it.content.news_item[0]) || {};
    console.log("\n— %s", n.title || "(无标题)");
    console.log("  作者：%s", n.author || "—");
    console.log("  摘要：%s", (n.digest || "—").slice(0, 60));
    console.log("  原文：%s", n.content_source_url || "—");
    console.log("  封面：%s", (n.thumb_url || "—").slice(0, 72));
    console.log("  更新：%s  media_id=%s", new Date((it.update_time || 0) * 1000).toLocaleString("zh-CN"), it.media_id);
  }
})().catch(e => { console.error("出错：", e.message); process.exit(1); });
