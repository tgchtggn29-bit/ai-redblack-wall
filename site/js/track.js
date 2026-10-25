/*!
 * 访问统计 + 行为轨迹采集（约 4KB，无依赖）
 * - 自动：pageview / 停留心跳 / 滚动深度 / 点击 / 离开
 * - 手动：window.track("vote.place", { pid: "claude", v: "up" })
 * - 隐私：只上报随机访客号，不上报任何输入内容
 */
(function () {
  if (window.__tq) return;
  var API = "/api/track";
  var LS = window.localStorage, SS = window.sessionStorage;

  function rid(n) {
    var s = "", a = "abcdef0123456789";
    for (var i = 0; i < n; i++) s += a[Math.floor(Math.random() * 16)];
    return s;
  }
  function get(k, box, gen) {
    try { var v = box.getItem(k); if (!v && gen) { v = gen(); box.setItem(k, v); } return v; } catch (e) { return gen ? gen() : null; }
  }

  var vid = get("hb_vid", LS, function () { return "v" + rid(14); });
  var sid = get("hb_sid", SS, function () { return "s" + rid(10); });
  var q = [], sent = 0, t0 = Date.now(), lastFlush = 0, maxScroll = 0, hb = null;

  function push(ev, meta) {
    q.push({ ev: ev, t: Date.now(), path: location.pathname, meta: meta || null });
    if (q.length >= 20) flush();
  }

  function flush(useBeacon) {
    if (!q.length) return;
    var payload = JSON.stringify({
      vid: vid, sid: sid,
      ref: document.referrer || "",
      events: q.splice(0, 40)
    });
    lastFlush = Date.now();
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(API, new Blob([payload], { type: "application/json" }));
      } else {
        fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true });
      }
    } catch (e) { /* 统计失败不影响页面 */ }
  }

  // —— 页面浏览
  push("pageview", {
    title: (document.title || "").slice(0, 60),
    sw: screen.width, sh: screen.height,
    lang: navigator.language,
    tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || "").slice(0, 30),
    ref: (document.referrer || "").slice(0, 120)
  });

  // —— 停留心跳：可见时每 30 秒打点（用于算停留时长）
  function beat() {
    if (document.visibilityState !== "visible") return;
    push("heartbeat", { dwell: Math.round((Date.now() - t0) / 1000) });
  }
  hb = setInterval(beat, 30000);

  // —— 滚动深度
  var marks = [25, 50, 75, 100], hit = {};
  function onScroll() {
    var h = document.documentElement.scrollHeight - window.innerHeight;
    var p = h > 0 ? Math.min(100, Math.round((window.scrollY / h) * 100)) : 100;
    if (p > maxScroll) maxScroll = p;
    for (var i = 0; i < marks.length; i++) {
      if (p >= marks[i] && !hit[marks[i]]) { hit[marks[i]] = 1; push("scroll", { depth: marks[i] }); }
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  // —— 点击：优先 data-track，其次产品格子/外链
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("[data-track],[data-pid],a[href]") : null;
    if (!el) return;
    var name = el.getAttribute("data-track");
    if (name) { push("click", { k: name.slice(0, 40) }); return; }
    var pid = el.getAttribute("data-pid");
    if (pid) { push("click.tile", { pid: pid.slice(0, 30) }); return; }
    if (el.tagName === "A") {
      var href = el.getAttribute("href") || "";
      if (/^https?:\/\//.test(href) && href.indexOf(location.host) < 0) {
        push("click.out", { host: (href.split("/")[2] || "").slice(0, 40) });
      }
    }
  }, true);

  // —— 可见性 & 离开
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      push("leave", { dwell: Math.round((Date.now() - t0) / 1000), scroll: maxScroll });
      flush(true);
    } else {
      push("return", { dwell: Math.round((Date.now() - t0) / 1000) });
    }
  });
  window.addEventListener("pagehide", function () {
    push("leave", { dwell: Math.round((Date.now() - t0) / 1000), scroll: maxScroll });
    flush(true);
  });

  setInterval(function () { if (q.length) flush(); }, 5000);

  window.track = function (ev, meta) { if (ev) push(String(ev), meta); };
  window.__tq = { flush: flush, vid: function () { return vid; }, sid: function () { return sid; } };
})();
