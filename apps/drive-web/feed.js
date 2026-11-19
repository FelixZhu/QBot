/* QBot 主动服务 tab
 * Mount: QbotFeed.mount(document.getElementById('tab-feed'), { feedUrl: 'out/feed.json' })
 * Does not own the app tab bar. Stores mute/snooze in localStorage only.
 *
 * Shell contract (the shell already calls this; feed does not replace the shell):
 *   qbotFeed.back() is detail-first:
 *     1. close the in-app page and restore that card's index and scroll, return true
 *     2. close the more menu, return true
 *     3. close the key sheet, return true
 *     4. if not on the first card, scroll to it, return true
 *     5. otherwise return false so the shell can switch to 对话
 *   Optional: window "qbot:appstate" with detail.state "background"|"inactive"|"hidden"
 *   pauses audio and video. The page also pauses on visibilitychange (hidden) and pagehide.
 *   External pages are never assigned to an iframe. An empty sandbox does not
 *   isolate Android 1.0.4's Java bridge, which is injected into subframes.
 *   When window.qbotShell exists (shell contract from the IM module, not owned here):
 *     openArticle(url) shows the explanation; openExternal(url) opens the browser.
 *   Without that API, the feed shows the same explanation itself and the explicit
 *   browser button uses window.open(url, "_blank", "noopener,noreferrer").
 *   Same-origin text we fetched ourselves can be shown. Arbitrary remote pages
 *   are not rendered inside the app.
 */
(function (global) {
  "use strict";

  var TYPE_LABEL = { digest: "AI 日报", english: "每日英语", study: "接着学", file: "文件提醒" };
  var BOT_CLS = {
    "Info Bot": { av: "I", cls: "av-info" },
    "English Bot": { av: "E", cls: "av-en" },
    "Study Bot": { av: "S", cls: "av-st" },
    QBot: { av: "F", cls: "av-file" }
  };
  var PRIMARY = { digest: "打开日报", english: "播放", study: "打开讲义", file: "打开知识库" };
  var DEFAULT_FEED_URL = "https://qian-grokbot.oss-cn-beijing.aliyuncs.com/feed/feed.json";
  var LOCAL_FEED_FALLBACK = "out/feed.json";
  var MUTE_KEY = "qbot-feed-muted-types";
  var SNOOZE_KEY = "qbot-feed-snoozed";
  var TZ = "Asia/Shanghai";
  var PAGE_BYTES = 600000;
  var HANDOFF_MSG = "这个页面不会嵌进 App。这里不加载外部网页：空沙箱不能证明安卓上的接口已经消失，所以不会把外部地址放进 iframe。需要看原文时用浏览器打开。";

  var ICO = {
    play: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.6 5.8v12.4c0 .7.8 1.1 1.4.7l9.2-6.2c.6-.4.6-1.2 0-1.6L10 5.1c-.6-.4-1.4 0-1.4.7z"/></svg>',
    pause: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="6" width="3.5" height="12" rx="1"/><rect x="13.5" y="6" width="3.5" height="12" rx="1"/></svg>',
    chev: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>',
    fs: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4"/></svg>',
    lock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="11" width="12" height="9" rx="2"/><path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11"/></svg>',
    more: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/></svg>',
    mark: '<svg class="mark" viewBox="0 0 32 32" width="40" height="40" aria-hidden="true"><rect x="4" y="6.5" width="17" height="19" rx="6.5" fill="currentColor"/><circle class="dot" cx="25.5" cy="21.5" r="3.2" fill="currentColor"/></svg>'
  };

  var FT_LABEL = { pdf: "PDF", md: "MD", image: "IMG", video: "MP4", audio: "MP3", code: "</>", doc: "DOC", sheet: "XLS", other: "···" };

  function fileIcon(kind, size) {
    var t = kind || "other";
    if (!FT_LABEL[t]) t = "other";
    var lab = FT_LABEL[t];
    var fs = lab.length >= 3 ? 5.6 : 6.4;
    return '<span class="q-fi" data-t="' + t + '" style="width:' + size + 'px;height:' + size + 'px">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M6.5 2.75h7.25l4.5 4.5V19.5a1.75 1.75 0 0 1-1.75 1.75h-10A1.75 1.75 0 0 1 4.75 19.5v-15A1.75 1.75 0 0 1 6.5 2.75z" fill="var(--surface-raised)" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M13.5 3v4.5H18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<text x="11.5" y="17.6" text-anchor="middle" font-size="' + fs + '" font-weight="700" font-family="Arial,sans-serif" fill="currentColor">' + lab + "</text></svg></span>";
  }

  function batchKind(c) {
    var files = (c.data && c.data.files) || [];
    if (files.length === 1) return files[0].kind || "other";
    return "other";
  }

  function avatarEl(c) {
    if (c.type === "file") {
      return el("span", { class: "q-av av-file", html: fileIcon(batchKind(c), 20) });
    }
    var meta = botMeta(c.bot);
    return el("span", { class: "q-av " + (meta.cls || "av-info"), text: meta.av });
  }

  var state = {
    root: null,
    opts: null,
    feedUrl: "",
    all: [],
    visible: [],
    index: 0,
    audio: null,
    playingId: null,
    observer: null,
    toastTimer: 0,
    lastAction: null,
    wide: false,
    fileExpanded: false,
    detail: null,
    menuOpen: false,
    _pageToken: 0
  };

  function $(sel, root) { return (root || state.root).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || state.root).querySelectorAll(sel)); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    var kids = Array.prototype.slice.call(arguments, 2);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "dataset") Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
        else if (k.slice(0, 2) === "on" && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === "html") node.innerHTML = v;
        else if (k === "text") node.textContent = v;
        else if (v === true) node.setAttribute(k, "");
        else node.setAttribute(k, String(v));
      });
    }
    kids.flat().forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function loadJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function saveJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ }
  }

  function mutedTypes() { return loadJson(MUTE_KEY, []); }
  function snoozedMap() { return loadJson(SNOOZE_KEY, {}); }

  function endOfShanghaiDay() {
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    var g = {};
    parts.forEach(function (p) { if (p.type !== "literal") g[p.type] = p.value; });
    return new Date(g.year + "-" + g.month + "-" + g.day + "T16:00:00Z");
  }

  function ymd(date, tz) {
    return date.toLocaleString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  }

  function shanghaiYmdOf(value) {
    if (!value) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    var d = new Date(value);
    if (isNaN(d.getTime())) return "";
    return ymd(d, TZ);
  }

  function shanghaiToday() {
    return ymd(new Date(), TZ);
  }

  function shanghaiYesterday() {
    var parts = shanghaiToday().split("-").map(Number);
    var utc = Date.UTC(parts[0], parts[1] - 1, parts[2]) - 86400000;
    return ymd(new Date(utc), "UTC");
  }

  function weekdayZh(ymdStr) {
    var parts = (ymdStr || "").split("-").map(Number);
    if (parts.length < 3 || !parts[0]) return "";
    var dow = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
    return "日一二三四五六".charAt(dow);
  }

  function relativeDay(value) {
    var that = shanghaiYmdOf(value);
    if (!that) return "";
    if (that === shanghaiToday()) return "今天";
    if (that === shanghaiYesterday()) return "昨天";
    return "";
  }

  function formatTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var hm = new Intl.DateTimeFormat("zh-CN", {
      timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false
    }).format(d);
    var rel = relativeDay(iso);
    if (rel) return rel + " " + hm;
    var that = ymd(d, TZ);
    if (weekStart(d) === weekStart(new Date())) return "周" + weekdayZh(that) + " " + hm;
    var parts = that.split("-");
    return Number(parts[1]) + "月" + Number(parts[2]) + "日 " + hm;
  }

  function weekStart(date) {
    var parts = ymd(date, TZ).split("-").map(Number);
    var y = parts[0], m = parts[1], d = parts[2];
    var dt = new Date(Date.UTC(y, m - 1, d));
    var dow = dt.getUTCDay();
    dt.setUTCDate(dt.getUTCDate() - dow);
    return dt.toISOString().slice(0, 10);
  }

  function botMeta(name) {
    return BOT_CLS[name] || { av: (name || "?").slice(0, 1), cls: "av-info" };
  }

  function resolveUrl(u) {
    if (!u) return "";
    if (/^[a-z]+:/i.test(u)) return u;
    try { return new URL(u, state.feedUrl).href; } catch (e) { return u; }
  }

  /* http(s) only. Rejects javascript:, data:, file:, and userinfo. Relative URLs resolve against the feed. */
  function safeHttpUrl(raw) {
    if (raw == null) return "";
    var s = String(raw).trim();
    if (!s || /[\u0000-\u001f]/.test(s) || /\s/.test(s)) return "";
    var base = state.feedUrl || (typeof location !== "undefined" ? location.href : undefined);
    var u;
    try { u = new URL(s, base); } catch (e) { return ""; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (u.username || u.password) return "";
    return u.href;
  }

  function sameDocumentOrigin(url) {
    try {
      if (typeof location === "undefined" || !location.origin) return false;
      return new URL(url).origin === location.origin;
    } catch (e) {
      return false;
    }
  }

  function shellApi() {
    var s = global.qbotShell;
    if (!s || typeof s !== "object") return null;
    return s;
  }

  function visibleCards(all) {
    var muted = mutedTypes();
    var snoozed = snoozedMap();
    var now = Date.now();
    var dirty = false;
    Object.keys(snoozed).forEach(function (id) {
      if (new Date(snoozed[id]).getTime() <= now) { delete snoozed[id]; dirty = true; }
    });
    if (dirty) saveJson(SNOOZE_KEY, snoozed);
    return all.filter(function (c) {
      if (muted.indexOf(c.type) >= 0) return false;
      if (snoozed[c.id]) return false;
      return true;
    });
  }

  function mount(root, opts) {
    if (!root) throw new Error("QbotFeed.mount: root is required");
    unmount();
    state.root = root;
    state.opts = opts || {};
    var requested = state.opts.feedUrl || DEFAULT_FEED_URL;
    state.feedUrl = new URL(requested, location.href).href;
    state.index = 0;
    state.wide = window.matchMedia("(min-width: 600px)").matches;
    root.innerHTML = "";
    root.classList.add("qb-feed-host");
    var shell = el("div", { class: "feed-root", html: '<div class="skel" style="height:100%;margin:0"></div>' });
    root.appendChild(shell);
    loadFeed(state.feedUrl).then(function (data) {
      state.all = (data && data.cards) || [];
      render();
      bindResize();
    }).catch(function (err) {
      renderError(String(err && err.message ? err.message : err));
    });
    return { unmount: unmount };
  }

  function isLocalPreview() {
    var h = location.hostname;
    return location.protocol === "file:" || h === "localhost" || h === "127.0.0.1";
  }

  function loadFeed(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("feed.json " + r.status);
      return r.json();
    }).catch(function (err) {
      if (!isLocalPreview()) throw err;
      var fallback = new URL(LOCAL_FEED_FALLBACK, location.href).href;
      if (fallback === url) throw err;
      return fetch(fallback, { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw err;
        state.feedUrl = fallback;
        return r.json();
      });
    });
  }

  function renderError(msg) {
    if (!state.root) return;
    state.root.innerHTML = "";
    var root = el("div", { class: "feed-root" },
      el("div", { class: "feed-error" },
        el("p", { text: "打不开，" + msg + "。" }),
        el("button", { class: "q-btn q-primary", type: "button", onClick: function () { mount(state.root, state.opts); } }, "重试")
      )
    );
    state.root.appendChild(root);
  }

  function render() {
    if (!state.root) return;
    state._pageToken += 1;
    state.detail = null;
    state.menuOpen = false;
    stopAudio();
    state.visible = visibleCards(state.all);
    if (state.index >= state.visible.length) state.index = 0;
    state.root.innerHTML = "";
    var wrap = el("div", { class: "feed-root" });
    state.root.appendChild(wrap);

    wrap.appendChild(topbar());

    var body = el("div", { class: "feed-body" });
    body.appendChild(listPane());
    var stage = el("div", { class: "feed-stage" });
    if (!state.visible.length) {
      stage.appendChild(emptyState());
    } else {
      stage.appendChild(feedTrack());
      stage.appendChild(pager());
    }
    body.appendChild(stage);
    wrap.appendChild(body);

    wrap.appendChild(el("div", { class: "q-toast feed-toast", hidden: true }));
    wrap.appendChild(el("div", { class: "feed-scrim", onClick: onScrim }));
    wrap.appendChild(sheet());
    wrap.appendChild(menu());

    syncChrome();
    attachObserver();
    hydrateAudioMeta();
    bindResize();
    requestAnimationFrame(function () { layoutFeed("auto", true); });
  }

  function brandText(c) {
    if (c && c.bot) return "主动服务 · " + c.bot;
    return "主动服务";
  }

  function topbar() {
    var c = state.visible[state.index];
    var more = el("button", {
      class: "qb-iconbtn", type: "button", "aria-label": "更多",
      "aria-haspopup": "menu", "aria-expanded": "false",
      title: "更多",
      onClick: function (e) { e.stopPropagation(); toggleMenu(); }
    });
    more.innerHTML = ICO.more;
    return el("header", { class: "feed-top" },
      el("div", { class: "feed-brand", text: brandText(c) }),
      el("span", { class: "feed-time", text: c ? formatTime(c.time) : "" }),
      more
    );
  }

  function listPane() {
    var aside = el("aside", { class: "feed-list qb-only-unfolded" });
    var rows = el("div", { class: "q-rows" });
    var lastBot = null;
    state.visible.forEach(function (c, i) {
      var bot = (c.bot || "QBot");
      if (bot !== lastBot) {
        rows.appendChild(el("div", { class: "feed-group", text: bot }));
        lastBot = bot;
      }
      var row = el("button", {
        class: "q-row" + (i === state.index ? " active" : ""),
        type: "button",
        dataset: { i: String(i) },
        onClick: function () { goTo(i); }
      },
        avatarEl(c),
        el("div", { class: "q-t" },
          el("div", { class: "q-n", text: listTitle(c) }),
          el("div", { class: "meta" },
            el("span", { class: "k", text: bot }),
            el("span", { class: "when", text: formatTime(c.time) })
          )
        )
      );
      rows.appendChild(row);
    });
    aside.appendChild(rows);
    return aside;
  }

  function typeLabel(c) {
    return kindLabel(c);
  }

  function kindLabel(c) {
    if (c.type === "file" && c.data && c.data.subtype === "due") return "到期";
    if (c.type === "file") return "新入库";
    return TYPE_LABEL[c.type] || c.type;
  }

  function listTitle(c) {
    if (c.private) return "有一条私密提醒";
    if (c.type === "study" && c.data) return (c.data.course || "课程") + " 第 " + c.data.day + "/" + c.data.total + " 天";
    return c.title || "";
  }

  function emptyState() {
    var muted = mutedTypes().length;
    var box = el("div", { class: "empty" });
    box.innerHTML = ICO.mark;
    box.appendChild(el("h4", { text: "今天没有新提醒" }));
    box.appendChild(el("p", { text: muted ? "已关闭的提醒可点右上角恢复。" : "有事我会来找你" }));
    return box;
  }

  function feedTrack() {
    var track = el("div", { class: "q-feed scroller", tabindex: "0", "aria-label": "主动服务卡片" });
    state.visible.forEach(function (c, i) {
      track.appendChild(cardEl(c, i));
    });
    track.addEventListener("scroll", onScroll, { passive: true });
    track.addEventListener("scrollend", onScrollEnd, { passive: true });
    track.addEventListener("keydown", onKey);
    track.addEventListener("wheel", onWheel, { passive: false });
    /* Passive only. A finger never calls preventDefault or goTo. */
    track.addEventListener("touchstart", onTouchStart, { passive: true });
    track.addEventListener("touchend", onTouchEnd, { passive: true });
    track.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return track;
  }

  function cardEl(c, i) {
    var data = c.data || {};
    var card = el("section", {
      class: "q-fcard" + (c.type === "file" ? " is-file" : "") + (c.private ? " is-private" : "") + (data.subtype === "due" ? " urgent" : ""),
      dataset: { id: c.id, type: c.type, i: String(i) },
      "aria-label": typeLabel(c)
    });
    var stage = el("div", { class: "q-stage" });
    fillStage(stage, c);
    card.appendChild(stage);
    card.appendChild(actionBar(c));
    return card;
  }

  function fillStage(stage, c) {
    var data = c.data || {};
    if (c.private) {
      stage.appendChild(el("div", { class: "priv" },
        el("span", { class: "lock", html: ICO.lock }),
        el("div", null,
          el("h2", { text: "有一条私密提醒" }),
          el("div", { class: "mini", text: "输入本地密钥后查看" })
        )
      ));
      return;
    }
    if (c.type === "digest") {
      stage.appendChild(el("h2", { text: c.title }));
      var n = (data.highlights || []).length || 3;
      stage.appendChild(el("div", { class: "q-sum", text: "今天 " + n + " 条值得看。" }));
      var ol = el("ol", { class: "q-hl" });
      (data.highlights || []).forEach(function (h) {
        ol.appendChild(el("li", null, el("span", { text: h.title || h })));
      });
      stage.appendChild(ol);
      return;
    }
    if (c.type === "english") {
      stage.appendChild(el("div", { class: "q-phrase", text: data.expression || c.title }));
      if (data.meaning) stage.appendChild(el("div", { class: "meaning", text: data.meaning }));
      if (data.example) {
        var ex = el("div", { class: "example q-sum" });
        ex.appendChild(el("div", { class: "en", text: "“" + data.example + "”" }));
        if (data.example_zh) ex.appendChild(el("div", { class: "zh", text: data.example_zh }));
        stage.appendChild(ex);
      }
      var media = mediaBlock(c);
      if (media) stage.appendChild(media);
      return;
    }
    if (c.type === "study") {
      stage.appendChild(el("h2", { text: c.title }));
      var day = Number(data.day), total = Number(data.total);
      if (total) {
        var pct = Math.max(4, Math.round((day / total) * 100));
        stage.appendChild(el("div", { class: "progress" }, el("i", { style: { width: pct + "%" } })));
      }
      if (data.brief) stage.appendChild(el("div", { class: "q-sum", text: data.brief }));
      else if (c.summary) stage.appendChild(el("div", { class: "q-sum", text: c.summary }));
      var studyMedia = mediaBlock(c);
      if (studyMedia) stage.appendChild(studyMedia);
      return;
    }
    if (c.type === "file") {
      if (data.subtype === "due" && data.due_in_days != null) {
        var days = data.due_in_days;
        var label = days < 0 ? "已过期" : days === 0 ? "今天" : days + " 天";
        stage.appendChild(el("div", { class: "due" },
          el("span", { class: "big", text: label }),
          el("h2", { text: c.title })
        ));
        return;
      }
      stage.appendChild(el("h2", { text: c.title }));
      var files = data.files || [];
      if (files.length) {
        var list = el("div", { class: "file-list is-open" });
        files.slice(0, 5).forEach(function (f) {
          list.appendChild(el("button", {
            class: "file-row",
            type: "button",
            onClick: function (e) {
              e.stopPropagation();
              openFileItem(f);
            }
          },
            el("span", { class: "file-ico", html: fileIcon(f.kind || "other", 36) }),
            el("div", { class: "q-t" },
              el("div", { class: "q-n", text: f.name || "未命名" }),
              f.dir ? el("div", { class: "q-m", text: f.dir }) : null
            )
          ));
        });
        if (files.length > 5) {
          list.appendChild(el("div", { class: "file-more", text: "还有 " + (files.length - 5) + " 个" }));
        }
        stage.appendChild(list);
      }
      return;
    }
    stage.appendChild(el("h2", { text: c.title }));
    if (c.summary) stage.appendChild(el("div", { class: "q-sum", text: c.summary }));
  }

  function mediaBlock(c) {
    var kind = c.media && c.media.kind;
    var url = c.media && c.media.url;
    if (kind === "video" || (c.data && c.data.has_video)) return videoBlock(c);
    if (kind === "audio" && url) return playerEl(c);
    return null;
  }

  function videoBlock(c) {
    var raw = c.media && c.media.url;
    var safe = raw ? safeHttpUrl(raw) : "";
    if (!safe) {
      return videoMessage("讲解视频还没有放进这条卡片，暂时不能播放。");
    }
    return videoPlayer(c, safe);
  }

  function videoMessage(text) {
    return el("div", { class: "q-video is-unavailable", role: "status" },
      el("p", { class: "q-video-msg", text: text })
    );
  }

  function videoPlayer(c, url) {
    var frame = el("div", { class: "q-video", dataset: { id: c.id } });
    var w = c.media && Number(c.media.width);
    var h = c.media && Number(c.media.height);
    var v = el("video", { preload: "metadata", playsinline: true });
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    if (w > 0 && h > 0) v.style.aspectRatio = w + " / " + h;
    v.src = url;
    v.addEventListener("loadedmetadata", function () {
      if (v.videoWidth > 0 && v.videoHeight > 0) v.style.aspectRatio = v.videoWidth + " / " + v.videoHeight;
    });
    v.addEventListener("error", function () {
      if (v.dataset.dead === "1") return;
      showVideoError(frame, "视频暂时打不开。");
    });
    v.addEventListener("play", function () { paintVideo(v); });
    v.addEventListener("pause", function () { paintVideo(v); });
    v.addEventListener("ended", function () { paintVideo(v); });
    v.addEventListener("timeupdate", function () { paintVideo(v); });
    v.addEventListener("click", function (e) { e.stopPropagation(); toggleVideo(v); });

    var big = el("button", {
      class: "q-video-play", type: "button", "aria-label": "播放",
      onClick: function (e) { e.stopPropagation(); toggleVideo(v); }
    });
    big.innerHTML = ICO.play;
    var pp = el("button", {
      class: "q-video-pp", type: "button", "aria-label": "播放",
      onClick: function (e) { e.stopPropagation(); toggleVideo(v); }
    });
    pp.innerHTML = ICO.play;
    var rail = el("div", { class: "rail" }, el("i"));
    var track = el("div", {
      class: "q-track q-video-track",
      onClick: function (e) { e.stopPropagation(); seekVideo(v, e); }
    }, rail);
    var fs = el("button", {
      class: "q-video-fs", type: "button", "aria-label": "全屏",
      onClick: function (e) { e.stopPropagation(); toggleFullscreen(frame, v); }
    });
    fs.innerHTML = ICO.fs;
    frame.appendChild(v);
    frame.appendChild(big);
    frame.appendChild(el("div", { class: "q-video-bar" }, pp, track, fs));
    return frame;
  }

  function showVideoError(frame, msg) {
    if (!frame) return;
    frame.classList.add("is-unavailable");
    var v = frame.querySelector("video");
    if (v) {
      v.dataset.dead = "1";
      try { v.pause(); } catch (e) {}
      try { v.removeAttribute("src"); v.load(); } catch (e2) {}
      v.remove();
    }
    var bar = frame.querySelector(".q-video-bar");
    if (bar) bar.remove();
    var big = frame.querySelector(".q-video-play");
    if (big) big.remove();
    if (!frame.querySelector(".q-video-msg")) {
      frame.appendChild(el("p", { class: "q-video-msg", text: msg || "视频暂时打不开。" }));
    }
  }

  function paintVideo(v) {
    if (!v || !v.closest) return;
    var frame = v.closest(".q-video");
    if (!frame) return;
    var playing = !v.paused && !v.ended;
    frame.classList.toggle("is-playing", playing);
    var label = playing ? "暂停" : "播放";
    var icon = playing ? ICO.pause : ICO.play;
    frame.querySelectorAll(".q-video-play, .q-video-pp").forEach(function (b) {
      b.setAttribute("aria-label", label);
      b.innerHTML = icon;
    });
    var fill = frame.querySelector(".rail i");
    var dur = v.duration;
    if (fill) fill.style.width = (dur && isFinite(dur) ? (v.currentTime / dur) * 100 : 0) + "%";
  }

  function toggleVideo(v) {
    if (!v || v.dataset.dead === "1") return;
    if (v.paused) {
      pauseVideos(v);
      stopAudio();
      var played = v.play();
      if (played && played.then) {
        played.then(function () { paintVideo(v); }).catch(function () {
          showVideoError(v.closest(".q-video"), "视频没有播起来。");
        });
      }
    } else {
      v.pause();
      paintVideo(v);
    }
  }

  function seekVideo(v, ev) {
    if (!v || !v.duration || !isFinite(v.duration)) return;
    var rect = ev.currentTarget.getBoundingClientRect();
    var p = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
    v.currentTime = p * v.duration;
    paintVideo(v);
  }

  function toggleFullscreen(frame, video) {
    var current = document.fullscreenElement || document.webkitFullscreenElement;
    if (current) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) {
        var leaving = exit.call(document);
        if (leaving && leaving.catch) leaving.catch(function () { toast("当前环境不能退出全屏"); });
      }
      return;
    }
    var req = frame.requestFullscreen || frame.webkitRequestFullscreen;
    if (!req && video && video.webkitEnterFullscreen) {
      try { video.webkitEnterFullscreen(); } catch (e) { toast("当前环境不能全屏"); }
      return;
    }
    if (!req) { toast("当前环境不能全屏"); return; }
    var result;
    try { result = req.call(frame); } catch (e) { toast("当前环境不能全屏"); return; }
    if (result && result.catch) result.catch(function () { toast("当前环境不能全屏"); });
  }

  function cardVideo(c) {
    if (!state.root || !c) return null;
    var frame = state.root.querySelector('.q-video[data-id="' + cssEscape(c.id) + '"]');
    return frame ? frame.querySelector("video") : null;
  }

  function playerEl(c) {
    var box = el("div", { class: "q-player", dataset: { id: c.id } });
    var pp = el("button", { class: "q-pp", type: "button", "aria-label": "播放", onClick: function (e) { e.stopPropagation(); toggleAudio(c); } });
    pp.innerHTML = ICO.play;
    var rail = el("div", { class: "rail" }, el("i"));
    var track = el("div", { class: "q-track", onClick: function (e) { e.stopPropagation(); seekAudio(c, e); } }, rail);
    var tm = el("span", { class: "q-tm", text: "0:00 / --:--" });
    box.appendChild(pp);
    box.appendChild(track);
    box.appendChild(tm);
    return box;
  }

  function actionBar(c) {
    var primaryLabel = c.private ? "解锁查看" : primaryText(c);
    var primary = el("button", { class: "q-btn q-primary", type: "button", onClick: function () { onPrimary(c); } });
    primary.innerHTML = c.private ? ICO.lock : ICO.chev;
    primary.appendChild(document.createTextNode(primaryLabel));
    return el("div", { class: "q-bar" },
      primary,
      el("button", { class: "q-btn q-snooze", type: "button", onClick: function () { snooze(c); } }, "稍后"),
      el("button", { class: "q-btn q-ghost", type: "button", onClick: function () { muteType(c); } }, "不再提醒")
    );
  }

  function pager() {
    var nav = el("div", { class: "feed-pager", "aria-hidden": state.visible.length < 2 ? "true" : "false" });
    if (state.visible.length < 2) nav.style.display = "none";
    state.visible.forEach(function (c, i) {
      nav.appendChild(el("button", {
        type: "button",
        "aria-label": "第 " + (i + 1) + " 张",
        "aria-current": i === state.index ? "true" : "false",
        onClick: function () { goTo(i); }
      }, el("i")));
    });
    return nav;
  }

  function menu() {
    return el("div", { class: "feed-menu", role: "menu", "aria-label": "更多" },
      el("button", {
        type: "button", role: "menuitem",
        onClick: function () { closeMenu(); restoreMuted(); }
      }, "恢复已关闭的提醒")
    );
  }

  function sheet() {
    var s = el("div", { class: "feed-sheet", role: "dialog", "aria-label": "输入本地密钥" });
    s.appendChild(el("div", { style: { fontWeight: "700", marginBottom: "8px" }, text: "输入本地密钥" }));
    var field = el("div", { class: "q-keyfield" });
    var input = el("input", { type: "password", autocomplete: "off", "aria-label": "本地密钥", style: { flex: "1", border: "0", background: "none", font: "inherit", color: "inherit", letterSpacing: "3px", minWidth: "0" } });
    field.appendChild(input);
    s.appendChild(field);
    s.appendChild(el("p", { class: "q-note", style: { margin: "8px 0 20px" }, text: "文件在手机上解密，密钥不离开这台手机。与对话页用同一套。" }));
    s.appendChild(el("button", { class: "q-btn q-primary q-block", type: "button", onClick: function () { toast("解锁还没有接上，等知识库的方案就绪。"); closeSheet(); } }, "解锁并打开"));
    return s;
  }

  function attachObserver() {
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    var track = $(".feed-stage .q-feed");
    if (!track || typeof IntersectionObserver === "undefined") return;
    var cards = $all(".q-fcard", track);
    state.observer = new IntersectionObserver(function (entries) {
      if (state.detail || state._paging || state._touch) return;
      var best = null, ratio = 0;
      entries.forEach(function (en) {
        if (en.intersectionRatio > ratio) { ratio = en.intersectionRatio; best = en.target; }
      });
      if (best && ratio >= 0.6) {
        var i = Number(best.dataset.i);
        if (i !== state.index && !isNaN(i)) setIndex(i, true);
      }
    }, { root: track, threshold: [0.55, 0.9] });
    cards.forEach(function (c) { state.observer.observe(c); });
  }

  function nearestIndex() {
    var track = $(".feed-stage .q-feed");
    if (!track || !track.clientHeight) return state.index;
    var h = track.clientHeight;
    var i = Math.round(track.scrollTop / h);
    return Math.max(0, Math.min(state.visible.length - 1, i));
  }

  /* Sync the pager to wherever native snap already stopped.
     Does not scroll. Call only after the finger is up and motion has settled. */
  function settleFromScroll() {
    if (state._paging || state.detail || state._touch) return;
    var i = nearestIndex();
    if (i !== state.index) setIndex(i, true);
  }

  function armSettle() {
    clearTimeout(state._snapTimer);
    state._snapTimer = setTimeout(settleFromScroll, 120);
  }

  function onScroll() {
    if (state.detail || state._touch || state._paging) {
      clearTimeout(state._snapTimer);
      return;
    }
    armSettle();
  }

  function onScrollEnd() {
    clearTimeout(state._snapTimer);
    if (state.detail) return;
    if (state._paging) {
      state._paging = false;
      clearTimeout(state._pageTimer);
    }
    settleFromScroll();
  }

  function onTouchStart() {
    clearTimeout(state._snapTimer);
    state._touch = true;
  }

  function onTouchCancel() {
    state._touch = false;
    if (!state.detail) armSettle();
  }

  function onTouchEnd() {
    state._touch = false;
    if (state.detail) return;
    /* Browsers without scrollend settle once this quiet timer wins.
       Scroll events during the fling keep resetting it, so it does not run mid-gesture. */
    armSettle();
  }

  function onWheel(e) {
    if (state.detail || state.menuOpen) return;
    if (Math.abs(e.deltaY) < 8) return;
    e.preventDefault();
    if (state._wheelLock) return;
    state._wheelLock = true;
    goTo(state.index + (e.deltaY > 0 ? 1 : -1));
    setTimeout(function () { state._wheelLock = false; }, 420);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      if (back()) e.preventDefault();
      return;
    }
    if (state.detail || state.menuOpen) return;
    if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === "j") { e.preventDefault(); goTo(state.index + 1); }
    if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "k") { e.preventDefault(); goTo(state.index - 1); }
    if (e.key === "Home") { e.preventDefault(); goTo(0); }
    if (e.key === "End") { e.preventDefault(); goTo(state.visible.length - 1); }
  }

  function goTo(i) {
    if (!state.visible.length) return;
    i = Math.max(0, Math.min(state.visible.length - 1, i));
    setIndex(i, true);
    scrollToIndex(i, "smooth");
  }

  function setIndex(i, updateList) {
    var prev = state.index;
    state.index = i;
    if (prev !== i) {
      var cur = state.visible[i];
      if (!cur || state.playingId !== cur.id) stopAudio();
      pauseVideos();
    }
    syncChrome();
    if (updateList !== false) {
      $all(".feed-list .q-row").forEach(function (row) {
        row.classList.toggle("active", Number(row.dataset.i) === i);
      });
    }
  }

  function syncChrome() {
    var c = state.visible[state.index];
    var brand = $(".feed-root > .feed-top .feed-brand");
    var time = $(".feed-root > .feed-top .feed-time");
    if (brand) brand.textContent = brandText(c);
    if (time) time.textContent = c ? formatTime(c.time) : "";
    $all(".feed-pager button").forEach(function (b, idx) {
      if (idx === state.index) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
    $all(".feed-list .q-row").forEach(function (row) {
      row.classList.toggle("active", Number(row.dataset.i) === state.index);
    });
  }

  function scrollToIndex(i, behavior) {
    var track = $(".feed-stage .q-feed");
    var card = track && $all(".q-fcard", track)[i];
    if (!track || !card) return;
    var top = card.offsetTop;
    state._paging = true;
    clearTimeout(state._snapTimer);
    if (behavior === "smooth") track.scrollTo({ top: top, behavior: "smooth" });
    else track.scrollTop = top;
    clearTimeout(state._pageTimer);
    /* scrollend ends the guard. This only covers browsers that never fire it. */
    state._pageTimer = setTimeout(function () {
      if (!state._paging) return;
      state._paging = false;
      if (!state._touch && !state.detail) settleFromScroll();
    }, behavior === "smooth" ? 700 : 0);
  }

  function layoutFeed(behavior, force) {
    var track = $(".feed-stage .q-feed");
    if (!track || !track.clientHeight) return;
    var h = track.clientHeight;
    if (state.detail) {
      state._lastH = h;
      return;
    }
    if (force || state._lastH !== h) {
      state._lastH = h;
      scrollToIndex(state.index, behavior || "auto");
    }
    syncChrome();
  }

  function bindResize() {
    if (state._mq) state._mq.removeEventListener("change", onMq);
    state._mq = window.matchMedia("(min-width: 600px)");
    state._mq.addEventListener("change", onMq);
    if (!state._onTab) {
      state._onTab = function (e) {
        var tab = e && e.detail && e.detail.tab;
        if (tab && tab !== "feed") { stopAudio(); pauseVideos(); return; }
        requestAnimationFrame(function () { layoutFeed("auto", true); });
      };
      window.addEventListener("qbot:tab", state._onTab);
    }
    if (!state._onResize) {
      state._onResize = function () {
        state.wide = window.matchMedia("(min-width: 600px)").matches;
        layoutFeed("auto");
      };
      window.addEventListener("resize", state._onResize);
    }
    if (!state._onVis) {
      state._onVis = function () {
        if (document.visibilityState === "hidden") pauseForLifecycle();
      };
      document.addEventListener("visibilitychange", state._onVis);
    }
    if (!state._onHide) {
      state._onHide = function () { pauseForLifecycle(); };
      window.addEventListener("pagehide", state._onHide);
    }
    if (!state._onApp) {
      state._onApp = function (e) {
        var s = e && e.detail && e.detail.state;
        if (s === "background" || s === "inactive" || s === "hidden") pauseForLifecycle();
      };
      window.addEventListener("qbot:appstate", state._onApp);
    }
    if (typeof ResizeObserver !== "undefined") {
      if (state._ro) { state._ro.disconnect(); state._ro = null; }
      if (state.root) {
        state._ro = new ResizeObserver(function () {
          clearTimeout(state._layoutTimer);
          state._layoutTimer = setTimeout(function () { layoutFeed("auto"); }, 40);
        });
        state._ro.observe(state.root);
        var stage = $(".feed-stage");
        if (stage) state._ro.observe(stage);
      }
    }
  }
  function onMq(e) {
    state.wide = e.matches;
    if (!state.root || !state.all.length) return;
    requestAnimationFrame(function () { layoutFeed("auto", true); });
  }

  function primaryText(c) {
    if (c.type === "file") return "打开知识库";
    return PRIMARY[c.type] || "打开";
  }

  function isPrivateKey(key) {
    var k = String(key || "").replace(/\\/g, "/").replace(/^\/+/, "");
    return !k || k === "private" || k.indexOf("private/") === 0;
  }

  /* Stay inside the App. qbotKb.open(key) already switches tab via qbotTab("kb"). */
  function openFileItem(f) {
    var key = (f && f.key) || "";
    if (key && isPrivateKey(key)) return;
    if (key && global.qbotKb && typeof global.qbotKb.open === "function") {
      var ok = global.qbotKb.open(key);
      if (ok !== false) return;
    }
    if (typeof global.qbotTab === "function") global.qbotTab("kb");
  }

  function openKnowledgeBase() {
    if (typeof global.qbotTab === "function") global.qbotTab("kb");
  }

  function onPrimary(c) {
    if (c.private) { openSheet(); return; }
    if (c.type === "file") { openKnowledgeBase(); return; }
    if (c.type === "english" && c.media && c.media.kind === "video") { toggleVideo(cardVideo(c)); return; }
    if (c.type === "english") { toggleAudio(c); return; }
    openPage(c);
  }

  function ensureAudio(c) {
    if (state.audio && state.playingId === c.id) return state.audio;
    stopAudio();
    var a = new Audio(safeHttpUrl(c.media && c.media.url) || "");
    a.preload = "metadata";
    state.audio = a;
    state.playingId = c.id;
    a.addEventListener("timeupdate", function () { paintPlayer(c); });
    a.addEventListener("ended", function () { paintPlayer(c, true); });
    a.addEventListener("loadedmetadata", function () { paintPlayer(c); });
    return a;
  }

  function toggleAudio(c) {
    if (!c.media || !safeHttpUrl(c.media.url)) { toast("没有音频"); return; }
    pauseVideos();
    var a = ensureAudio(c);
    if (a.paused) {
      a.play().then(function () { paintPlayer(c); }).catch(function () { toast("音频播放失败"); });
    } else {
      a.pause();
      paintPlayer(c);
    }
  }

  function seekAudio(c, ev) {
    if (!c.media || !safeHttpUrl(c.media.url)) return;
    var a = ensureAudio(c);
    var rect = ev.currentTarget.getBoundingClientRect();
    var p = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
    var place = function () {
      if (!a.duration || !isFinite(a.duration)) return false;
      var target = Math.min(a.duration, p * a.duration);
      /* Setting currentTime inside loadedmetadata is ignored; leave that turn first. */
      setTimeout(function () {
        try { a.currentTime = target; } catch (e) { /* not seekable yet */ }
        paintPlayer(c);
      }, 0);
      return true;
    };
    var arm = function () {
      if (!place()) return;
      a.removeEventListener("loadedmetadata", arm);
      a.removeEventListener("durationchange", arm);
    };
    a.addEventListener("seeked", function () { paintPlayer(c); });
    if (!place()) {
      a.addEventListener("loadedmetadata", arm);
      a.addEventListener("durationchange", arm);
    }
  }

  function paintPlayer(c, ended) {
    var box = state.root && state.root.querySelector('.q-player[data-id="' + cssEscape(c.id) + '"]');
    if (!box) return;
    var a = state.audio && state.playingId === c.id ? state.audio : null;
    var pp = box.querySelector(".q-pp");
    var fill = box.querySelector(".rail i");
    var tm = box.querySelector(".q-tm");
    var playing = a && !a.paused && !ended;
    if (pp) {
      pp.innerHTML = playing ? ICO.pause : ICO.play;
      pp.setAttribute("aria-label", playing ? "暂停" : "播放");
    }
    var cur = a ? a.currentTime || 0 : 0;
    var dur = a && isFinite(a.duration) ? a.duration : 0;
    if (fill) fill.style.width = (dur ? (cur / dur) * 100 : 0) + "%";
    if (tm) tm.textContent = fmtDur(cur) + " / " + (dur ? fmtDur(dur) : "--:--");
  }

  function fmtDur(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  function hydrateAudioMeta() {
    state.visible.forEach(function (c) {
      if (!c.media || c.media.kind !== "audio" || !safeHttpUrl(c.media.url)) return;
      var probe = new Audio();
      probe.preload = "metadata";
      probe.src = safeHttpUrl(c.media.url);
      probe.addEventListener("loadedmetadata", function () {
        if (!state.root) return;
        var tm = state.root.querySelector('.q-player[data-id="' + cssEscape(c.id) + '"] .q-tm');
        if (tm && state.playingId !== c.id) tm.textContent = "0:00 / " + fmtDur(probe.duration);
      });
    });
  }

  function stopAudio() {
    var id = state.playingId;
    if (state.audio) {
      try { state.audio.pause(); } catch (e) {}
      try { state.audio.src = ""; } catch (e2) {}
    }
    state.audio = null;
    state.playingId = null;
    if (id && state.root) {
      var pp = state.root.querySelector('.q-player[data-id="' + cssEscape(id) + '"] .q-pp');
      if (pp) { pp.innerHTML = ICO.play; pp.setAttribute("aria-label", "播放"); }
    }
  }

  function pauseAudioInPlace() {
    if (!state.audio) return;
    try { state.audio.pause(); } catch (e) {}
    var id = state.playingId;
    var c = null;
    state.visible.forEach(function (card) { if (card.id === id) c = card; });
    if (c) paintPlayer(c);
  }

  function pauseVideos(except) {
    if (!state.root) return;
    $all("video", state.root).forEach(function (v) {
      if (except && v === except) return;
      try { if (!v.paused) v.pause(); } catch (e) {}
      paintVideo(v);
    });
  }

  function pauseForLifecycle() {
    pauseAudioInPlace();
    pauseVideos();
  }

  function cssEscape(s) {
    if (global.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/"/g, '\\"');
  }

  function snooze(c) {
    var map = snoozedMap();
    map[c.id] = endOfShanghaiDay().toISOString();
    saveJson(SNOOZE_KEY, map);
    state.lastAction = { kind: "snooze", id: c.id };
    var next = Math.min(state.index, Math.max(0, state.visible.length - 2));
    render();
    if (state.visible.length) goTo(Math.min(next, state.visible.length - 1));
    toast("已稍后，今天不再出现。", true);
  }

  function muteType(c) {
    var list = mutedTypes();
    if (list.indexOf(c.type) < 0) list.push(c.type);
    saveJson(MUTE_KEY, list);
    state.lastAction = { kind: "mute", type: c.type };
    render();
    toast("已关闭「" + (TYPE_LABEL[c.type] || c.type) + "」。", true);
  }

  function undo() {
    var act = state.lastAction;
    if (!act) return;
    if (act.kind === "snooze") {
      var map = snoozedMap();
      delete map[act.id];
      saveJson(SNOOZE_KEY, map);
    } else if (act.kind === "mute") {
      saveJson(MUTE_KEY, mutedTypes().filter(function (t) { return t !== act.type; }));
    }
    state.lastAction = null;
    render();
    toast("已撤销");
  }

  function restoreMuted() {
    var had = mutedTypes().length || Object.keys(snoozedMap()).length;
    saveJson(MUTE_KEY, []);
    saveJson(SNOOZE_KEY, {});
    render();
    toast(had ? "已恢复关闭和稍后的提醒" : "没有已关闭的提醒");
  }

  function toast(msg, undoable) {
    var t = $(".feed-toast");
    if (!t) return;
    t.innerHTML = "";
    t.appendChild(document.createTextNode(msg));
    if (undoable) t.appendChild(el("button", { class: "a", type: "button", onClick: undo }, "撤销"));
    t.hidden = false;
    t.classList.add("on");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { t.classList.remove("on"); }, 1600);
  }

  function openSheet() {
    var root = $(".feed-root");
    if (root) root.classList.add("is-sheet");
    var input = $(".feed-sheet input");
    if (input) setTimeout(function () { input.focus(); }, 50);
  }
  function closeSheet() {
    var root = $(".feed-root");
    if (root) root.classList.remove("is-sheet");
  }

  function toggleMenu() {
    state.menuOpen = !state.menuOpen;
    var root = $(".feed-root");
    if (root) root.classList.toggle("is-menu", state.menuOpen);
    var more = $(".feed-root > .feed-top .qb-iconbtn");
    if (more) more.setAttribute("aria-expanded", state.menuOpen ? "true" : "false");
  }
  function closeMenu() {
    state.menuOpen = false;
    var root = $(".feed-root");
    if (root) root.classList.remove("is-menu");
    var more = $(".feed-root > .feed-top .qb-iconbtn");
    if (more) more.setAttribute("aria-expanded", "false");
  }
  function onScrim() {
    if (state.menuOpen) { closeMenu(); return; }
    closeSheet();
  }

  function rememberDetail(c, safe) {
    var track = $(".feed-stage .q-feed");
    state.detail = {
      index: state.index,
      scrollTop: track ? track.scrollTop : 0,
      url: safe,
      title: (c && c.title) || "页面",
      cardId: c && c.id,
      via: ""
    };
  }

  function openPage(c) {
    var safe = safeHttpUrl(c && c.open_url);
    rememberDetail(c, safe);
    pauseForLifecycle();
    var root = $(".feed-root");
    if (!root) return;
    var old = root.querySelector(".feed-detail");
    if (old) old.remove();
    if (safe && !sameDocumentOrigin(safe)) {
      openExternalArticle(c, safe);
      return;
    }
    root.classList.add("is-detail");
    root.appendChild(buildDetail(c, safe));
    if (safe) loadPage(safe);
  }

  /* External http(s) never becomes an iframe src, hidden or otherwise. */
  function openExternalArticle(c, safe) {
    var shell = shellApi();
    if (shell && typeof shell.openArticle === "function") {
      state.detail.via = "shell";
      try { shell.openArticle(safe); } catch (e) { state.detail.via = ""; }
      if (state.detail && state.detail.via === "shell") return;
    }
    var root = $(".feed-root");
    if (!root || !state.detail) return;
    state.detail.via = "feed";
    root.classList.add("is-detail");
    root.appendChild(buildDetail(c, safe));
    showPageFallback(safe, HANDOFF_MSG);
  }

  function buildDetail(c, safe) {
    var backBtn = el("button", {
      class: "qb-iconbtn feed-back", type: "button", "aria-label": "返回",
      onClick: function () { closeDetail(); }
    });
    backBtn.innerHTML = ICO.back;
    var headerBtn = safe ? el("button", {
      class: "feed-browser", type: "button",
      onClick: function () { openInBrowser(safe); }
    }, "用浏览器打开") : null;
    var fallbackBtn = safe ? el("button", {
      class: "q-btn q-primary feed-browser", type: "button",
      onClick: function () { openInBrowser(safe); }
    }, "用浏览器打开") : null;
    var detail = el("div", {
      class: "feed-detail", role: "dialog", "aria-modal": "true",
      "aria-label": (c && c.title) || "页面"
    },
      el("header", { class: "feed-top" },
        backBtn,
        el("div", { class: "feed-brand", text: (c && c.title) || "页面" }),
        headerBtn
      ),
      el("div", { class: "feed-detail-body" },
        el("p", { class: "feed-status", text: safe ? "正在打开…" : "", hidden: !safe }),
        el("div", { class: "feed-fallback", hidden: !!safe },
          el("p", { text: "这个地址不能打开。" }),
          fallbackBtn
        )
      )
    );
    detail.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeDetail();
      }
    });
    return detail;
  }

  function loadPage(url) {
    if (!sameDocumentOrigin(url)) {
      showPageFallback(url, HANDOFF_MSG);
      return;
    }
    var token = ++state._pageToken;
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var opts = { method: "GET", mode: "cors", credentials: "omit", redirect: "follow", cache: "no-store" };
    if (ctrl) opts.signal = ctrl.signal;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
    fetch(url, opts).then(function (res) {
      if (!res.ok) throw new Error("status " + res.status);
      return res.arrayBuffer().then(function (buf) { return { res: res, buf: buf }; });
    }).then(function (got) {
      clearTimeout(timer);
      if (token !== state._pageToken || !state.detail) return;
      if (!got.buf || got.buf.byteLength > PAGE_BYTES) {
        showPageFallback(url, "这个页面太大，App 里读不了。");
        return;
      }
      var reader = readerFromBuffer(got.res, got.buf, url);
      if (reader) showReader(reader);
      else showPageFallback(url, "这个页面没有可读的内容。");
    }).catch(function () {
      clearTimeout(timer);
      if (token !== state._pageToken || !state.detail) return;
      showPageFallback(url, HANDOFF_MSG);
    });
  }

  function readerFromBuffer(res, buf, url) {
    var ct = String((res.headers && res.headers.get("content-type")) || "").split(";")[0].trim().toLowerCase();
    var text;
    try { text = new TextDecoder("utf-8", { fatal: false }).decode(buf); }
    catch (e) { return null; }
    if (!text || !String(text).trim()) return null;
    if (ct.indexOf("html") >= 0) return htmlReader(text);
    var textual = ct.indexOf("text/") === 0 || ct.indexOf("markdown") >= 0 || ct.indexOf("json") >= 0 || /\.(md|markdown|txt)(\?|#|$)/i.test(url);
    if (!textual) return null;
    return el("article", { class: "feed-reader" }, el("pre", { text: text.slice(0, 200000) }));
  }

  function htmlReader(html) {
    var doc;
    try { doc = new DOMParser().parseFromString(html, "text/html"); }
    catch (e) { return null; }
    if (!doc || !doc.body) return null;
    var box = el("article", { class: "feed-reader" });
    var nodes = doc.body.querySelectorAll("h1, h2, h3, p, li, pre, blockquote");
    var count = 0;
    Array.prototype.forEach.call(nodes, function (n) {
      var t = String(n.textContent || "").replace(/\s+/g, " ").trim();
      if (!t) return;
      var tag = n.tagName === "PRE" ? "pre" : (/^H/.test(n.tagName) ? "h2" : "p");
      box.appendChild(el(tag, { text: t.slice(0, 4000) }));
      count++;
    });
    if (!count) {
      var plain = String(doc.body.innerText || doc.body.textContent || "").replace(/\s+/g, " ").trim();
      if (!plain) return null;
      box.appendChild(el("p", { text: plain.slice(0, 20000) }));
    }
    return box;
  }

  function showReader(node) {
    var body = $(".feed-detail-body");
    if (!body || !node) return;
    var status = body.querySelector(".feed-status");
    if (status) status.hidden = true;
    var fb = body.querySelector(".feed-fallback");
    if (fb) fb.hidden = true;
    var old = body.querySelector(".feed-reader");
    if (old) old.remove();
    body.appendChild(node);
  }

  function showPageFallback(url, msg) {
    var body = $(".feed-detail-body");
    if (!body) return;
    var status = body.querySelector(".feed-status");
    if (status) status.hidden = true;
    var old = body.querySelector(".feed-reader");
    if (old) old.remove();
    var frame = body.querySelector(".feed-frame");
    if (frame) frame.remove();
    var fb = body.querySelector(".feed-fallback");
    if (!fb) return;
    var p = fb.querySelector("p");
    if (p) p.textContent = msg;
    var btn = fb.querySelector(".feed-browser");
    if (btn) btn.hidden = !url;
    fb.hidden = false;
  }

  function openInBrowser(url) {
    var safe = safeHttpUrl(url);
    if (!safe) return;
    var shell = shellApi();
    if (shell && typeof shell.openExternal === "function") {
      try { shell.openExternal(safe); } catch (e) { toast("没有打开浏览器。"); }
      return;
    }
    try { window.open(safe, "_blank", "noopener,noreferrer"); }
    catch (e) { toast("没有打开浏览器。"); }
  }

  function closeDetail() {
    var saved = state.detail;
    state.detail = null;
    state._pageToken += 1;
    var node = state.root && state.root.querySelector(".feed-detail");
    if (node) node.remove();
    var root = $(".feed-root");
    if (root) root.classList.remove("is-detail");
    if (!saved) return false;
    setIndex(saved.index || 0, true);
    var track = $(".feed-stage .q-feed");
    if (track) {
      state._paging = true;
      track.scrollTop = saved.scrollTop || 0;
      clearTimeout(state._pageTimer);
      state._pageTimer = setTimeout(function () { state._paging = false; }, 500);
    }
    return true;
  }

  function back() {
    if (state.detail) { closeDetail(); return true; }
    var root = $(".feed-root");
    if (state.menuOpen || (root && root.classList.contains("is-menu"))) { closeMenu(); return true; }
    if (root && root.classList.contains("is-sheet")) { closeSheet(); return true; }
    var i = Math.max(state.index || 0, nearestIndex());
    if (i > 0 && state.visible.length) {
      setIndex(0, true);
      scrollToIndex(0, "auto");
      return true;
    }
    return false;
  }

  function unmount() {
    stopAudio();
    state._pageToken += 1;
    state.detail = null;
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    if (state._mq) { state._mq.removeEventListener("change", onMq); state._mq = null; }
    if (state._ro) { state._ro.disconnect(); state._ro = null; }
    if (state._onTab) { window.removeEventListener("qbot:tab", state._onTab); state._onTab = null; }
    if (state._onResize) { window.removeEventListener("resize", state._onResize); state._onResize = null; }
    if (state._onVis) { document.removeEventListener("visibilitychange", state._onVis); state._onVis = null; }
    if (state._onHide) { window.removeEventListener("pagehide", state._onHide); state._onHide = null; }
    if (state._onApp) { window.removeEventListener("qbot:appstate", state._onApp); state._onApp = null; }
    clearTimeout(state.toastTimer);
    state._touch = false;
    clearTimeout(state._snapTimer);
    clearTimeout(state._pageTimer);
    clearTimeout(state._layoutTimer);
    if (state.root) state.root.innerHTML = "";
    state.root = null;
    state.all = [];
    state.visible = [];
  }

  global.QbotFeed = { mount: mount, unmount: unmount, back: back, closeDetail: closeDetail };
  global.qbotFeed = global.QbotFeed;
})(window);
