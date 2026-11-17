/* QBot shell: article / video routing for the Android WebView.
 * Pure decisions live on QbotShellMedia so they can be tested without a device.
 * DOM behavior is mount(). Feed owns feed.js / feed.css and does not have to
 * change for the current window.open() call to be caught.
 *
 * Measured 2026-11-17 in headless Chrome, not assumed:
 * - example.com (allows framing), github.com (X-Frame-Options: deny) and an
 *   example.com 404 all fire iframe load and throw SecurityError. The parent
 *   gets no securitypolicyviolation. Cross-origin success and refusal look
 *   the same; only a readable about:blank / chrome-error, a timeout, or an
 *   error event is an explicit failure.
 * - feed.js renders class "q-vframe" while feed.css sizes ".vframe". The
 *   unsized <video> laid out at the UA default 300x150. A ".vframe" box at
 *   the same time was 200x356 (9:16). needsPlayerRescue() is true only for
 *   a box that small, so a real feed slot keeps inline playback.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.QbotShellMedia = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var FOLD = 600;
  var RAIL = 72;
  var HEADER = 44;
  var RESCUE_MIN = { width: 160, height: 180 };
  var LOAD_MS = 12000;
  var VIDEO_EXT = /\.(mp4|webm|m4v|ogv|mov)(?=$|[?#])/i;
  var UNSUPPORTED_EXT = /\.(m3u8|mpd|mkv)(?=$|[?#])/i;
  /* Empty sandbox is NOT proof that Android removed the Java bridge.
     This WebView still injects ReactNativeWebView into every frame, and an
     empty sandbox has not been checked on a device. Arbitrary external
     articles are therefore not loaded here at all. */
  var ARTICLE_SANDBOX = "";
  var HANDOFF_COPY = [
    "在浏览器中打开",
    "这个地址不会嵌进当前的 App。1.0.4 的网页和系统浏览器是分开的；嵌在这里既不能确认页面真的打开了，也不能凭空沙箱证明安卓上的 Java 接口已经消失。需要脚本或禁止内嵌的网站留在这里只会是空白。"
  ];

  var CAPABILITIES = {
    version: 1,
    article: "browser-handoff",
    browserFallback: true,
    videoInline: true,
    videoFullscreen: "element",
    videoAspect: "contain",
    pauseOnLeave: true,
    protocols: ["http:", "https:"],
    requiresNewApk: false,
    apk: { version: "1.0.4", versionCode: 6 }
  };

  var FAIL_COPY = {
    protocol: ["链接被拒绝", "只打开 http 和 https。"],
    invalid: ["链接无效", "这个地址无法解析。"],
    empty: ["没有链接", "没有可打开的地址。"],
    denied: ["页面是空白的", "框架停在空白页或浏览器错误页。对方可能禁止嵌入。外壳没有改写这个网站。"],
    failed: ["页面没有加载", "没有在限定时间内得到页面。可能是网络问题，或对方拒绝嵌入。"],
    "unsupported-media": ["App 里播不了", "这是 HLS、DASH 或 MKV。安卓系统 WebView 不能把它当普通视频内嵌播放，这里也不会转码。"]
  };

  function classifyUrl(raw, base) {
    if (raw == null || String(raw).trim() === "") return { ok: false, reason: "empty" };
    var url;
    try {
      url = new URL(String(raw), base || "https://felixzhu.github.io/qian-drive/");
    } catch (e) {
      return { ok: false, reason: "invalid" };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, reason: "protocol", protocol: url.protocol };
    }
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
    }
    var path = url.pathname || "";
    var kind = "article";
    if (VIDEO_EXT.test(path)) kind = "video";
    else if (UNSUPPORTED_EXT.test(path)) kind = "unsupported-media";
    return { ok: true, url: url.toString(), protocol: url.protocol, kind: kind, host: url.host };
  }

  function isShellPage(url) {
    try {
      var u = new URL(url);
      if (u.protocol !== "https:" || u.host !== "felixzhu.github.io") return false;
      var path = (u.pathname || "").replace(/\/+$/, "");
      return path === "/qian-drive" || path === "/qian-drive/index.html";
    } catch (e) {
      return false;
    }
  }

  function frameVerdict(probe) {
    probe = probe || {};
    if (probe.errorEvent || probe.timedOut) return "failed";
    if (probe.threw) return "opaque";
    var href = probe.href;
    if (href == null || href === "" || href === "about:blank") return "denied";
    if (String(href).indexOf("chrome-error:") === 0) return "denied";
    return "shown";
  }

  function chromeForWidth(width) {
    var w = Number(width) || 0;
    var folded = w < FOLD;
    var rail = folded ? 0 : RAIL;
    return {
      width: w,
      folded: folded,
      rail: rail,
      header: HEADER,
      overlayLeft: rail,
      overlayWidth: Math.max(0, w - rail)
    };
  }

  function snapshotFeed(feed) {
    feed = feed || {};
    return {
      index: feed.index || 0,
      scrollTop: feed.scrollTop || 0,
      tab: feed.tab || "feed"
    };
  }

  function openLayer(state, layer) {
    state = state || {};
    return {
      feed: snapshotFeed(state.feed),
      stack: (state.stack || []).concat([layer])
    };
  }

  function backLayer(state) {
    state = state || {};
    var feed = snapshotFeed(state.feed);
    var stack = state.stack || [];
    if (!stack.length) return { feed: feed, stack: [], handled: false };
    return { feed: feed, stack: stack.slice(0, -1), handled: true };
  }

  function pauseTargets(evt) {
    if (!evt) return [];
    if (evt.type === "visibility") return evt.hidden ? ["all"] : [];
    if (evt.type === "tab") {
      var out = [];
      if (evt.tab !== "feed") out.push("feed");
      if (evt.tab !== "kb") out.push("kb");
      return out;
    }
    if (evt.type === "overlay") return ["feed"];
    if (evt.type === "card") return (Number(evt.ratio) || 0) < 0.5 ? ["element"] : [];
    return [];
  }

  function needsPlayerRescue(box) {
    box = box || {};
    return (Number(box.width) || 0) < RESCUE_MIN.width || (Number(box.height) || 0) < RESCUE_MIN.height;
  }

  function articlePolicy(raw, base) {
    var c = classifyUrl(raw, base);
    if (!c.ok) return { embed: false, mode: "reject", reason: c.reason };
    if (isShellPage(c.url)) return { embed: false, mode: "reject", reason: "shell", url: c.url };
    if (c.kind === "video") return { embed: false, mode: "video", url: c.url };
    if (c.kind === "unsupported-media") return { embed: false, mode: "browser-handoff", reason: "unsupported-media", url: c.url };
    return { embed: false, mode: "browser-handoff", reason: "external-webview", url: c.url };
  }

  /* PR 4's 用浏览器打开 calls window.open(url, "_blank", "noopener,noreferrer").
     The current feed primary button calls window.open(url, "_blank", "noopener").
     noreferrer means "leave for the browser now". noopener alone shows the handoff. */
  function windowOpenIntent(features) {
    var f = String(features || "");
    if (f.indexOf("noopener") !== -1 && f.indexOf("noreferrer") !== -1) return "browser";
    return "handoff";
  }

  function settleArticle(probe) {
    probe = probe || {};
    var verdict = frameVerdict(probe);
    if (verdict === "shown" && probe.text) return "readable";
    return "browser-handoff";
  }

  function mediaErrorCopy(code) {
    if (code === 2) return "网络错误，视频没有下完。";
    if (code === 3) return "解码失败。安卓 WebView 通常能播 H.264/AAC 的 MP4 和 VP8/VP9 的 WebM；HEVC、HLS 和 DRM 经常不行。";
    if (code === 4) return "这个地址不是 WebView 能播的视频。";
    return "播放被中断。";
  }

  function mount(opts) {
    opts = opts || {};
    var doc = opts.document || (typeof document !== "undefined" ? document : null);
    var win = opts.window || (typeof window !== "undefined" ? window : null);
    if (!doc || !win || win.__qbotShellMounted) return win && win.qbotShell;
    win.__qbotShellMounted = true;

    var host = opts.host || doc.getElementById("qbs");
    var nativeOpen = win.open ? win.open.bind(win) : function () { return null; };
    var overlay = null;
    var frame = null;
    var video = null;
    var failEl = null;
    var noteEl = null;
    var titleEl = null;
    var fullBtn = null;
    var browserBtn = null;
    var open = false;
    var currentUrl = "";
    var gen = 0;
    var failTimer = 0;
    var probeTimer = 0;
    var ignoreVideoError = false;

    function el(tag, attrs) {
      var node = doc.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(function (k) {
          if (k === "text") node.textContent = attrs[k];
          else if (k === "hidden") node.hidden = !!attrs[k];
          else node.setAttribute(k, attrs[k]);
        });
      }
      for (var i = 2; i < arguments.length; i++) if (arguments[i]) node.appendChild(arguments[i]);
      return node;
    }

    function ensure() {
      if (overlay) return;
      titleEl = el("div", { class: "qbs-ov-title" });
      var backBtn = el("button", { type: "button", "data-act": "back", "aria-label": "返回", text: "返回" });
      browserBtn = el("button", { type: "button", "data-act": "external", "aria-label": "在浏览器中打开", text: "浏览器" });
      fullBtn = el("button", { type: "button", "data-act": "full", "aria-label": "全屏", text: "全屏", hidden: true });
      var bar = el("header", { class: "qbs-ov-bar" }, backBtn, titleEl, fullBtn, browserBtn);
      frame = el("iframe", {
        class: "qbs-ov-frame",
        title: "文章",
        hidden: true,
        referrerpolicy: "no-referrer",
        sandbox: ARTICLE_SANDBOX
      });
      video = el("video", {
        class: "qbs-ov-video",
        controls: "",
        playsinline: "",
        "webkit-playsinline": "",
        preload: "metadata",
        hidden: true
      });
      video.dataset.qbotShell = "1";
      video.setAttribute("controls", "");
      failEl = el("div", { class: "qbs-ov-fail", hidden: true });
      noteEl = el("p", { class: "qbs-ov-note", hidden: true });
      var body = el("div", { class: "qbs-ov-body" }, frame, video, failEl);
      overlay = el("div", { id: "qbsOverlay", class: "qbs-overlay", hidden: true }, bar, body, noteEl);
      (host || doc.body).appendChild(overlay);
      overlay.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("[data-act]") : null;
        if (!b) return;
        var act = b.getAttribute("data-act");
        if (act === "back") apiClose();
        else if (act === "external" || act === "external-fail") openExternal(currentUrl);
        else if (act === "full") requestFull();
      });
      video.addEventListener("loadedmetadata", function () {
        if (video.videoWidth && video.videoHeight) {
          video.setAttribute("width", String(video.videoWidth));
          video.setAttribute("height", String(video.videoHeight));
          video.style.aspectRatio = video.videoWidth + " / " + video.videoHeight;
        }
      });
      video.addEventListener("error", function () {
        if (ignoreVideoError || !open || video.hidden) return;
        var code = video.error && video.error.code;
        showFailure("这段视频没能播放", mediaErrorCopy(code), currentUrl);
      });
    }

    function clearTimers() {
      if (failTimer) clearTimeout(failTimer);
      if (probeTimer) clearTimeout(probeTimer);
      failTimer = 0;
      probeTimer = 0;
    }

    function pauseWithin(root) {
      if (!root || !root.querySelectorAll) return;
      var nodes = root.querySelectorAll("video");
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].dataset.qbotShell === "1" && root !== overlay && root !== doc) continue;
        try { nodes[i].pause(); } catch (e) {}
      }
    }

    function applyPause(evt) {
      pauseTargets(evt).forEach(function (name) {
        if (name === "all") pauseWithin(doc);
        else if (name === "feed") pauseWithin(doc.getElementById("panel-feed"));
        else if (name === "kb") pauseWithin(doc.getElementById("panel-kb"));
        else if (name === "element" && evt.target) {
          try { evt.target.pause(); } catch (e) {}
        }
      });
    }

    function setOpen(on) {
      ensure();
      open = on;
      overlay.hidden = !on;
      if (on) {
        var back = overlay.querySelector("[data-act=back]");
        if (back && back.focus) back.focus();
      }
    }

    function showFailure(title, msg, url) {
      ensure();
      gen += 1;
      clearTimers();
      frame.onload = null;
      frame.onerror = null;
      frame.hidden = true;
      frame.removeAttribute("src");
      video.hidden = true;
      try { video.pause(); } catch (e) {}
      noteEl.hidden = true;
      failEl.hidden = false;
      failEl.textContent = "";
      failEl.appendChild(el("p", { class: "qbs-ov-fail-title", text: title }));
      failEl.appendChild(el("p", { class: "qbs-ov-fail-msg", text: msg }));
      if (url) {
        var btn = el("button", { type: "button", "data-act": "external-fail", text: "在浏览器中打开" });
        failEl.appendChild(btn);
      }
      fullBtn.hidden = true;
      browserBtn.hidden = !url;
      titleEl.textContent = title;
      currentUrl = url || "";
      setOpen(true);
    }

    function showOpaqueNote(on) {
      noteEl.hidden = !on;
      noteEl.textContent = on
        ? "如果框里是空白的，这个网站不允许嵌入。请用浏览器打开。外壳不会改写对方的页面。"
        : "";
    }

    function showHandoff(c) {
      /* Do not assign iframe.src. A blank or scriptless frame is not a loaded page,
         and an empty sandbox is not evidence the Android Java bridge is gone. */
      ensure();
      clearTimers();
      gen += 1;
      applyPause({ type: "overlay" });
      stopVideo();
      frame.onload = null;
      frame.onerror = null;
      frame.removeAttribute("src");
      frame.hidden = true;
      showOpaqueNote(false);
      showFailure(HANDOFF_COPY[0], HANDOFF_COPY[1], c.url);
      return { ok: true, mode: "browser-handoff", url: c.url, embed: false };
    }

    function stopVideo() {
      if (!video) return;
      ignoreVideoError = true;
      try { video.pause(); } catch (e) {}
      video.removeAttribute("src");
      try { video.load(); } catch (e) {}
      video.hidden = true;
      ignoreVideoError = false;
    }

    function playVideo(raw) {
      var url = raw && typeof raw === "object" ? (raw.url || raw.src) : raw;
      var c = classifyUrl(url, win.location && win.location.href);
      if (!c.ok) {
        showFailure(FAIL_COPY[c.reason][0], FAIL_COPY[c.reason][1], "");
        return { ok: false, reason: c.reason };
      }
      if (c.kind === "unsupported-media") {
        showFailure(FAIL_COPY["unsupported-media"][0], FAIL_COPY["unsupported-media"][1], c.url);
        return { ok: false, reason: "unsupported-media", url: c.url };
      }
      if (c.kind !== "video") return openArticle(c.url);
      ensure();
      clearTimers();
      gen += 1;
      applyPause({ type: "overlay" });
      frame.hidden = true;
      frame.removeAttribute("src");
      failEl.hidden = true;
      showOpaqueNote(false);
      currentUrl = c.url;
      titleEl.textContent = c.host || "视频";
      fullBtn.hidden = false;
      browserBtn.hidden = false;
      video.hidden = false;
      video.style.aspectRatio = "";
      setOpen(true);
      video.src = c.url;
      var play = video.play();
      if (play && play.catch) play.catch(function () { /* controls stay so the user can start it */ });
      return { ok: true, mode: "video", url: c.url };
    }

    function openArticle(raw) {
      var url = raw && typeof raw === "object" ? (raw.url || raw.src) : raw;
      var c = classifyUrl(url, win.location && win.location.href);
      if (!c.ok) {
        var copy = FAIL_COPY[c.reason] || FAIL_COPY.invalid;
        showFailure(copy[0], copy[1], "");
        return { ok: false, reason: c.reason };
      }
      if (isShellPage(c.url)) return { ok: false, reason: "shell" };
      if (c.kind === "video") return playVideo(c.url);
      if (c.kind === "unsupported-media") {
        showFailure(FAIL_COPY["unsupported-media"][0], FAIL_COPY["unsupported-media"][1], c.url);
        return { ok: false, reason: "unsupported-media", url: c.url };
      }
      return showHandoff(c);
    }

    function openExternal(raw) {
      var c = classifyUrl(raw, win.location && win.location.href);
      if (!c.ok) return { ok: false, reason: c.reason };
      if (win.ReactNativeWebView && win.ReactNativeWebView.postMessage) {
        try {
          win.ReactNativeWebView.postMessage(JSON.stringify({ type: "open-external", url: c.url }));
        } catch (e) {}
        /* Installed APK 1.0.4 ignores this message. Its onShouldStartLoadWithRequest
           already hands a top-level http(s) navigation to the system browser and
           cancels the load, so the Feed document stays put. */
        try { win.location.assign(c.url); } catch (e) {}
        return { ok: true, mode: "browser", via: "top-navigation", url: c.url };
      }
      nativeOpen(c.url, "_blank", "noopener,noreferrer");
      return { ok: true, mode: "browser", via: "window.open", url: c.url };
    }

    function requestFull() {
      if (!video || video.hidden) return;
      var fn = video.requestFullscreen || video.webkitRequestFullscreen || video.webkitEnterFullscreen;
      if (!fn) return;
      try { fn.call(video); } catch (e) {}
    }

    function apiClose() {
      if (!open) return false;
      clearTimers();
      gen += 1;
      stopVideo();
      if (frame) {
        frame.onload = null;
        frame.onerror = null;
        frame.removeAttribute("src");
        frame.hidden = true;
      }
      setOpen(false);
      currentUrl = "";
      return true;
    }

    function onWindowOpen(url, _target, features) {
      /* 1.0.4 does not deliver window.open to onOpenWindow. PR 4's
         用浏览器打开 uses noopener,noreferrer and must reach the system browser.
         The current feed primary button uses noopener only; that shows the
         handoff instead of embedding the page. */
      var c = classifyUrl(url, win.location && win.location.href);
      if (!c.ok) {
        openArticle(url);
        return null;
      }
      if (isShellPage(c.url)) return null;
      if (c.kind === "video") {
        playVideo(c.url);
        return null;
      }
      if (windowOpenIntent(features) === "browser") {
        openExternal(c.url);
        return null;
      }
      openArticle(c.url);
      return null;
    }

    win.open = onWindowOpen;
    doc.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a || a.hasAttribute("download")) return;
      if (a.target !== "_blank" && !(a.getAttribute("rel") || "").match(/noopener/)) return;
      var c = classifyUrl(a.href, win.location && win.location.href);
      if (c.ok && isShellPage(c.url)) return;
      e.preventDefault();
      if (!c.ok) openArticle(a.getAttribute("href"));
      else openArticle(c.url);
    }, true);

    doc.addEventListener("play", function (e) {
      var v = e.target;
      if (!v || v.nodeName !== "VIDEO" || v.dataset.qbotShell === "1") return;
      if (!v.closest || !v.closest("#panel-feed")) return;
      var rect = v.getBoundingClientRect();
      if (!needsPlayerRescue({ width: rect.width, height: rect.height })) return;
      try { v.pause(); } catch (err) {}
      var src = v.currentSrc || v.getAttribute("src");
      if (src) playVideo(src);
    }, true);

    win.addEventListener("qbot:tab", function (e) {
      apiClose();
      var tab = e && e.detail && e.detail.tab;
      applyPause({ type: "tab", tab: tab });
    });
    doc.addEventListener("visibilitychange", function () {
      applyPause({ type: "visibility", hidden: doc.hidden });
    });

    var feedRoot = doc.getElementById("panel-feed");
    if (feedRoot && win.IntersectionObserver) {
      var io = new win.IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.target || en.target.dataset.qbotShell === "1") return;
          applyPause({ type: "card", ratio: en.intersectionRatio, target: en.target });
        });
      }, { threshold: [0, 0.5, 1] });
      function arm(node) {
        if (!node || node.dataset.qbotWatch === "1" || node.dataset.qbotShell === "1") return;
        node.dataset.qbotWatch = "1";
        if (!node.hasAttribute("playsinline")) node.setAttribute("playsinline", "");
        if (!node.hasAttribute("webkit-playsinline")) node.setAttribute("webkit-playsinline", "");
        io.observe(node);
      }
      function scan() {
        var nodes = feedRoot.querySelectorAll("video");
        for (var i = 0; i < nodes.length; i++) arm(nodes[i]);
      }
      scan();
      if (win.MutationObserver) {
        new win.MutationObserver(scan).observe(feedRoot, { childList: true, subtree: true });
      }
    }

    var api = {
      version: 1,
      capabilities: function () { return CAPABILITIES; },
      openArticle: openArticle,
      playVideo: playVideo,
      openExternal: openExternal,
      close: apiClose,
      isOpen: function () { return open; }
    };
    win.qbotShell = api;
    return api;
  }

  return {
    FOLD: FOLD,
    RAIL: RAIL,
    HEADER: HEADER,
    RESCUE_MIN: RESCUE_MIN,
    LOAD_MS: LOAD_MS,
    CAPABILITIES: CAPABILITIES,
    FAIL_COPY: FAIL_COPY,
    ARTICLE_SANDBOX: ARTICLE_SANDBOX,
    HANDOFF_COPY: HANDOFF_COPY,
    articlePolicy: articlePolicy,
    windowOpenIntent: windowOpenIntent,
    settleArticle: settleArticle,
    classifyUrl: classifyUrl,
    isShellPage: isShellPage,
    frameVerdict: frameVerdict,
    chromeForWidth: chromeForWidth,
    snapshotFeed: snapshotFeed,
    openLayer: openLayer,
    backLayer: backLayer,
    pauseTargets: pauseTargets,
    needsPlayerRescue: needsPlayerRescue,
    mediaErrorCopy: mediaErrorCopy,
    mount: mount
  };
});
