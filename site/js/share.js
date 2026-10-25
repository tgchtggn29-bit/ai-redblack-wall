/*!
 * 分享模块：分享卡片（canvas 生成）+ 站点二维码
 * - 打开面板：window.openShare()
 * - 卡片内容：我的打卡数 + 好评/差评前三个 + 二维码 + 网址
 */
(function () {
  var CW = 900, CH = 1200;
  var scrim = document.getElementById("share-scrim");
  if (!scrim) return;

  var cv = document.getElementById("share-canvas");
  var g = cv.getContext("2d");
  var qr = new Image();
  var qrOk = false;
  var built = false;

  qr.onload = function () { qrOk = true; if (!scrim.hidden && built) draw(); };
  qr.src = "img/qr-site.png";

  var HOST = "vote.wqai.ltd";
  var URL_FULL = "https://vote.wqai.ltd/?from=share";
  var WX = /MicroMessenger/i.test(navigator.userAgent);

  function pick(n) {
    var picks = (typeof myPicks === "object" && myPicks) || {};
    var ups = [], dns = [];
    for (var pid in picks) {
      var p = picks[pid];
      if (!p) continue;
      var nm = (typeof NAME === "object" && NAME[pid]) || pid;
      (p.v === "down" ? dns : ups).push(nm);
    }
    return { n: Object.keys(picks).length, ups: ups.slice(0, n), dns: dns.slice(0, n) };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function dot(x, y, r, color, alpha) {
    g.globalAlpha = alpha == null ? 1 : alpha;
    g.fillStyle = color;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.globalAlpha = 1;
  }

  function wrap(text, x, y, maxW, lh, size, color, weight) {
    g.font = (weight || "") + " " + size + "px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.fillStyle = color;
    var line = "";
    for (var i = 0; i < text.length; i++) {
      var t = line + text[i];
      if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); y += lh; line = text[i]; }
      else line = t;
    }
    if (line) { g.fillText(line, x, y); y += lh; }
    return y;
  }

  function draw() {
    var d = pick(3);

    // 背景：深空蓝渐变
    var bg = g.createLinearGradient(0, 0, CW * 0.7, CH);
    bg.addColorStop(0, "#0B132B");
    bg.addColorStop(0.55, "#122347");
    bg.addColorStop(1, "#0A1020");
    g.fillStyle = bg; g.fillRect(0, 0, CW, CH);

    // 右上青色光晕
    var gl = g.createRadialGradient(CW * 0.86, 40, 20, CW * 0.86, 40, 620);
    gl.addColorStop(0, "rgba(0,229,255,.34)");
    gl.addColorStop(1, "rgba(0,229,255,0)");
    g.fillStyle = gl; g.fillRect(0, 0, CW, CH);

    // 贴纸点缀
    var seed = 7;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    for (var i = 0; i < 30; i++) {
      var x = 40 + rnd() * (CW - 80), y = 90 + rnd() * 380;
      dot(x, y, 3 + rnd() * 5, i % 2 ? "#34d399" : "#ff4d6d", 0.10 + rnd() * 0.16);
    }

    // 顶部标识
    g.fillStyle = "#00E5FF";
    g.font = "600 22px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.fillText("A I   P R O D U C T   W A L L", 64, 92);

    // 主标题
    g.fillStyle = "#ffffff";
    g.font = "bold 74px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.fillText("AI 产品", 64, 196);
    g.fillStyle = "#00E5FF";
    g.fillText("红黑榜", 64, 282);

    // 副标
    g.fillStyle = "rgba(201,214,238,.92)";
    g.font = "26px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.fillText("一面能贴贴纸的墙：喜欢贴绿，踩雷贴红", 64, 336);

    // 青色短线
    g.fillStyle = "#00B8D4";
    g.fillRect(64, 366, 120, 4);

    // 我的打卡
    g.fillStyle = "#8FA3C4";
    g.font = "600 24px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.fillText("M Y   C H E C K - I N", 64, 440);

    g.fillStyle = "#ffffff";
    g.font = "bold 42px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.fillText(d.n ? "我给 " + d.n + " 个 AI 产品贴了贴纸" : "我还没贴，等你先来一张", 64, 498);

    // 好评 / 差评 两栏
    var colY = 556;
    g.font = "600 24px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.fillStyle = "#34d399";
    g.fillText("好评 ✓", 64, colY);
    g.fillStyle = "#ff4d6d";
    g.fillText("差评 ✕", 476, colY);

    g.font = "28px 'PingFang SC','Microsoft YaHei',sans-serif";
    var rows = Math.max(d.ups.length, d.dns.length, 1);
    for (var r = 0; r < Math.min(rows, 4); r++) {
      var yy = colY + 56 + r * 54;
      if (d.ups[r]) {
        dot(80, yy - 9, 7, "#34d399", 1);
        g.fillStyle = "#E9F0FF";
        g.font = "28px 'PingFang SC','Microsoft YaHei',sans-serif";
        g.fillText(clip(d.ups[r], 11), 104, yy);
      }
      if (d.dns[r]) {
        dot(492, yy - 9, 7, "#ff4d6d", 1);
        g.fillStyle = "#E9F0FF";
        g.fillText(clip(d.dns[r], 11), 516, yy);
      }
    }
    if (!d.ups.length && !d.dns.length) {
      g.fillStyle = "rgba(201,214,238,.6)";
      g.font = "26px 'PingFang SC','Microsoft YaHei',sans-serif";
      g.fillText("扫码进去，给自己心里的红榜黑榜各贴一张", 64, colY + 60);
    }

    // 底部白色卡片（二维码区）
    var boxY = CH - 330, boxH = 250;
    g.fillStyle = "rgba(255,255,255,.97)";
    roundRect(g, 48, boxY, CW - 96, boxH, 28); g.fill();

    if (qrOk) g.drawImage(qr, 76, boxY + 24, 202, 202);

    g.fillStyle = "#0B132B";
    g.font = "bold 34px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.fillText("扫码来贴你的第一张", 306, boxY + 82);

    g.fillStyle = "#4A5A74";
    g.font = "24px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.fillText("微信扫一扫 · 打开就能贴，不用登录", 306, boxY + 126);

    g.fillStyle = "#00A6C0";
    g.font = "bold 30px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.fillText(HOST, 306, boxY + 176);

    g.fillStyle = "#8FA3C4";
    g.font = "20px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.fillText("长按保存卡片，转发给朋友", 306, boxY + 214);

    // 页脚
    g.fillStyle = "rgba(143,163,196,.75)";
    g.font = "22px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.fillText("@zhaoweng · 2026", 48, CH - 34);
    g.textAlign = "right";
    g.fillText("github.com/tgchtggn29-bit/ai-redblack-wall", CW - 48, CH - 34);
    g.textAlign = "left";
  }

  function clip(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  function open() {
    scrim.hidden = false;
    document.body.style.overflow = "hidden";
    if (!built) { built = true; if (qrOk) draw(); }
    else if (qrOk) draw();
    document.getElementById("share-tip").textContent = WX
      ? "微信里：长按下方卡片可保存图片，再转发给朋友"
      : "保存后发到微信，或在手机浏览器长按卡片保存";
    if (window.track) track("share.open", { n: pick(9).n });
  }
  function close() {
    scrim.hidden = true;
    document.body.style.overflow = "";
  }

  function save() {
    try {
      var a = document.createElement("a");
      a.download = "AI产品红黑榜-分享卡.png";
      a.href = cv.toDataURL("image/png");
      document.body.appendChild(a); a.click(); a.remove();
      if (window.toast) toast(WX ? "已生成图片，若没弹出请长按卡片保存" : "分享卡已保存，发到微信就行");
      if (window.track) track("share.save", { wx: WX });
    } catch (e) { if (window.toast) toast("保存失败，可以长按卡片保存"); }
  }

  function copy() {
    var txt = URL_FULL;
    var done = function () { if (window.toast) toast("链接已复制，粘贴给朋友即可"); if (window.track) track("share.copy", {}); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { if (window.toast) toast("复制失败，手动复制：" + txt); }
      ta.remove();
    }
  }

  // 事件绑定
  var btn = document.getElementById("share");
  if (btn) btn.onclick = open;
  document.getElementById("share-x").onclick = close;
  document.getElementById("share-save").onclick = save;
  document.getElementById("share-copy").onclick = copy;
  scrim.addEventListener("click", function (e) { if (e.target === scrim) close(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !scrim.hidden) close(); });

  window.openShare = open;

  // 从分享链接进来（?from=share / from=qr）时，自动提醒可反向分享
  window.addEventListener("load", function () {
    if (/[?&]from=(share|qr)/.test(location.search)) {
      setTimeout(function () { if (window.toast) toast("你就是被朋友分享进来的，也把这面墙发给别人吧"); }, 2600);
    }
  });
})();
