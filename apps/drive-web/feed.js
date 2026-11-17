/* QBot 主动服务 tab
 * Mount: QbotFeed.mount(document.getElementById('tab-feed'), { feedUrl: 'out/feed.json' })
 * Does not own the app tab bar. Stores mute/snooze in localStorage only.
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

  var ICO = {
    play: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.6 5.8v12.4c0 .7.8 1.1 1.4.7l9.2-6.2c.6-.4.6-1.2 0-1.6L10 5.1c-.6-.4-1.4 0-1.4.7z"/></svg>',
    pause: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="6" width="3.5" height="12" rx="1"/><rect x="13.5" y="6" width="3.5" height="12" rx="1"/></svg>',
    chev: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
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
    fileExpanded: false
  };

  function $(sel, el) { return (el || state.root).querySelector(sel); }
  function $all(sel, el) { return Array.prototype.slice.call((el || state.root).querySelectorAll(sel)); }

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
    return new Date(g.year + "-" + g.month + "-" + g.day + "T16:00:00Z"); // 00:00 next day CST = 16:00 UTC
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
    var that = ymd(d, TZ);
    var hm = new Intl.DateTimeFormat("zh-CN", {
      timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false
    }).format(d);
    var rel = relativeDay(iso);
    if (rel) return rel + " " + hm;
    if (weekStart(d) === weekStart(new Date())) {
      var weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: TZ, weekday: "short" }).format(d);
      return weekday + " " + hm;
    }
    var md = new Intl.DateTimeFormat("zh-CN", { timeZone: TZ, month: "numeric", day: "numeric" }).format(d);
    return md + " " + hm;
  }

  function formatDateLabel(value) {
    var that = shanghaiYmdOf(value);
    if (!that) return "";
    var parts = that.split("-").map(Number);
    var abs = parts[1] + " 月 " + parts[2] + " 日 · 周" + weekdayZh(that);
    var rel = relativeDay(that);
    return rel ? rel + " · 周" + weekdayZh(that) : abs;
  }

  function weekStart(date) {
    var [y, m, d] = ymd(date, TZ).split("-").map(Number);
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
    wrap.appendChild(el("div", { class: "feed-scrim", onClick: closeSheet }));
    wrap.appendChild(sheet());

    syncChrome();
    attachObserver();
    hydrateAudioMeta();
    if (state.wide && state.visible.length) showOnly(state.index);
    else if (state.visible.length) scrollToIndex(state.index, "auto");
  }

  function topbar() {
    var n = state.visible.length;
    var label = n ? (state.index + 1) + " / " + n : "";
    var more = el("button", {
      class: "qb-iconbtn", type: "button", "aria-label": "更多",
      title: "恢复已关闭的提醒",
      onClick: restoreMuted
    });
    more.innerHTML = ICO.more;
    return el("header", { class: "qb-topbar feed-top" },
      el("div", { class: "title", text: "主动服务", style: { paddingLeft: "12px" } }),
      el("span", { class: "count", text: label }),
      more
    );
  }

  function listPane() {
    var aside = el("aside", { class: "feed-list qb-only-unfolded" },
      el("header", { class: "qb-topbar" },
        el("div", { class: "title", text: "主动服务" }),
        (function () { var b = el("button", { class: "qb-iconbtn", type: "button", "aria-label": "更多", onClick: restoreMuted }); b.innerHTML = ICO.more; return b; })()
      )
    );
    var rows = el("div", { class: "rows" });
    state.visible.forEach(function (c, i) {
      var meta = botMeta(c.bot);
      var row = el("button", {
        class: "q-row" + (i === state.index ? " active" : ""),
        type: "button",
        dataset: { i: String(i) },
        onClick: function () { goTo(i); }
      },
        avatarEl(c),
        el("div", { class: "q-t" },
          el("div", { class: "meta" },
            el("b", { class: "k", text: listKind(c) }),
            el("span", { class: "when", text: formatTime(c.time) })
          ),
          el("div", { class: "q-n", text: listTitle(c) })
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

  function listKind(c) {
    if (c.type === "file" && c.data && c.data.subtype === "due") return "文件提醒";
    if (c.type === "file") return "文件提醒";
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
    var track = el("div", { class: "q-feed", tabindex: "0", "aria-label": "主动服务卡片" });
    state.visible.forEach(function (c, i) {
      track.appendChild(cardEl(c, i));
    });
    track.addEventListener("scroll", onScroll, { passive: true });
    track.addEventListener("keydown", onKey);
    return track;
  }

  function cardEl(c, i) {
    var meta = botMeta(c.bot);
    var data = c.data || {};
    var card = el("section", {
      class: "q-fcard" + (c.type === "file" ? " is-file" : "") + (c.private ? " is-private" : "") + (data.subtype === "due" ? " urgent" : "") + (state.fileExpanded && c.type === "file" ? " is-open" : ""),
      dataset: { id: c.id, type: c.type, i: String(i) },
      "aria-label": typeLabel(c)
    });
    var who = el("div", { class: "q-who" },
      avatarEl(c),
      el("span", { class: "q-nm", text: c.bot }),
      el("span", { text: " · " + formatTime(c.time) }),
      el("span", { class: "q-kind", text: kindLabel(c) })
    );
    var stage = el("div", { class: "q-stage" });
    fillStage(stage, c);
    card.appendChild(who);
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
          el("div", { class: "mini", text: "输入本地密钥后查看", style: { marginTop: "4px", fontSize: "12px", color: "var(--text-3)" } })
        )
      ));
      return;
    }
    if (c.type === "digest") {
      var dlabel = formatDateLabel(data.date || c.time);
      if (dlabel) stage.appendChild(el("div", { class: "mini", text: dlabel, style: { marginBottom: "8px", fontSize: "12px", color: "var(--text-3)" } }));
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
      var enDay = relativeDay(data.date || c.time) || formatDateLabel(data.date || c.time) || "今日";
      stage.appendChild(el("div", { class: "mini", text: enDay + "的表达", style: { marginBottom: "12px", fontSize: "12px", color: "var(--text-3)" } }));
      stage.appendChild(el("div", { class: "q-phrase", text: data.expression || c.title }));
      if (data.meaning) stage.appendChild(el("div", { class: "meaning", text: data.meaning }));
      if (data.example) {
        var ex = el("div", { class: "example q-sum" });
        ex.appendChild(el("div", { class: "en", text: "“" + data.example + "”" }));
        if (data.example_zh) ex.appendChild(el("div", { class: "zh", text: data.example_zh }));
        stage.appendChild(ex);
      }
      if (c.media && c.media.kind === "video" && c.media.url) {
        stage.appendChild(videoSlot(c));
      } else if (c.media && c.media.kind === "audio" && c.media.url) {
        stage.appendChild(playerEl(c));
      }
      return;
    }
    if (c.type === "study") {
      var day = data.day, total = data.total;
      stage.appendChild(el("div", { class: "mini", text: (data.course || "课程") + " · 第 " + day + " / " + total + " 天", style: { fontSize: "12px", color: "var(--text-3)" } }));
      stage.appendChild(el("h2", { text: c.title, style: { marginTop: "8px" } }));
      var pct = total ? Math.max(4, Math.round((day / total) * 100)) : 0;
      var bar = el("div", { class: "progress" }, el("i", { style: { width: pct + "%" } }));
      stage.appendChild(bar);
      var bits = [];
      if (data.brief) bits.push("讲义已就绪");
      if (data.has_video) bits.push("有讲解视频");
      stage.appendChild(el("div", { class: "q-sum", text: bits.join(" · ") || (c.summary || ""), style: { marginTop: "12px" } }));
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
        var shown = files.slice(0, 5);
        shown.forEach(function (f) {
          var row = el("button", {
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
          );
          list.appendChild(row);
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

  function playerEl(c) {
    var box = el("div", { class: "q-player", dataset: { id: c.id } });
    var pp = el("button", { class: "q-pp", type: "button", "aria-label": "播放", onClick: function (e) { e.stopPropagation(); toggleAudio(c); } });
    pp.innerHTML = ICO.play;
    var rail = el("div", { class: "rail" }, el("i"));
    var track = el("div", { class: "q-track", onClick: function (e) { seekAudio(c, e); } }, rail);
    var tm = el("span", { class: "q-tm", text: "0:00 / --:--" });
    box.appendChild(pp);
    box.appendChild(track);
    box.appendChild(tm);
    return box;
  }

  function videoSlot(c) {
    var frame = el("div", { class: "q-vframe" });
    var v = el("video", { src: resolveUrl(c.media.url), playsinline: true, controls: true, preload: "metadata" });
    frame.appendChild(v);
    frame.appendChild(el("div", { class: "subs", hidden: true }));
    /* 15 秒倒计时环：有 video + countdown 数据时再显示，先占位 */
    return frame;
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
      var b = el("button", {
        type: "button",
        "aria-label": "第 " + (i + 1) + " 张",
        "aria-current": i === state.index ? "true" : "false",
        onClick: function () { goTo(i); }
      }, el("i"));
      nav.appendChild(b);
    });
    return nav;
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
    if (!track || state.wide) return;
    var cards = $all(".q-fcard", track);
    state.observer = new IntersectionObserver(function (entries) {
      var best = null, ratio = 0;
      entries.forEach(function (en) {
        if (en.intersectionRatio > ratio) { ratio = en.intersectionRatio; best = en.target; }
      });
      if (best && ratio >= 0.6) {
        var i = Number(best.dataset.i);
        if (i !== state.index && !isNaN(i)) setIndex(i, false);
      }
    }, { root: track, threshold: [0.6, 0.9] });
    cards.forEach(function (c) { state.observer.observe(c); });
  }

  function onScroll() { /* observer handles index */ }

  function onKey(e) {
    if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === "j") { e.preventDefault(); goTo(state.index + 1); }
    if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "k") { e.preventDefault(); goTo(state.index - 1); }
  }

  function goTo(i) {
    if (!state.visible.length) return;
    i = Math.max(0, Math.min(state.visible.length - 1, i));
    setIndex(i, true);
    if (state.wide) showOnly(i);
    else scrollToIndex(i, "smooth");
  }

  function setIndex(i, updateList) {
    state.index = i;
    syncChrome();
    if (updateList !== false) {
      $all(".feed-list .q-row").forEach(function (row, idx) {
        row.classList.toggle("active", idx === i);
      });
    }
  }

  function syncChrome() {
    var n = state.visible.length;
    var count = $(".feed-top .count");
    if (count) count.textContent = n ? (state.index + 1) + " / " + n : "";
    $all(".feed-pager button").forEach(function (b, idx) {
      if (idx === state.index) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
    $all(".feed-list .q-row").forEach(function (row, idx) {
      row.classList.toggle("active", idx === state.index);
    });
  }

  function scrollToIndex(i, behavior) {
    var track = $(".feed-stage .q-feed");
    var card = $all(".q-fcard", track)[i];
    if (!track || !card) return;
    var top = card.offsetTop;
    /* Only scroll the feed itself — scrollIntoView would also drag the window
       and hide the top bar / tab bar. */
    if (behavior === "smooth") track.scrollTo({ top: top, behavior: "smooth" });
    else track.scrollTop = top;
  }

  function showOnly(i) {
    $all(".feed-stage .q-fcard").forEach(function (card, idx) {
      card.style.display = idx === i ? "flex" : "none";
    });
  }

  function bindResize() {
    if (state._mq) state._mq.removeEventListener("change", onMq);
    state._mq = window.matchMedia("(min-width: 600px)");
    state._mq.addEventListener("change", onMq);
  }
  function onMq(e) {
    state.wide = e.matches;
    if (!state.root || !state.all.length) return;
    /* Re-render so overflow/observer match the layout. */
    var keep = state.index;
    render();
    state.index = keep;
    if (state.wide) showOnly(keep);
    else scrollToIndex(keep, "auto");
    syncChrome();
  }

  function primaryText(c) {
    if (c.type === "file") return "打开知识库";
    return PRIMARY[c.type] || "打开";
  }

  function openFileItem(f) {
    var url = resolveUrl((f && f.open_url) || "");
    if (!url) return;
    try { window.open(url, "_blank", "noopener"); } catch (e) { location.href = url; }
  }

  function openKnowledgeBase(c) {
    var url = (c && c.open_url) || "https://felixzhu.github.io/qian-drive/";
    url = resolveUrl(url);
    try { window.open(url, "_blank", "noopener"); } catch (e) { location.href = url; }
  }

  function onPrimary(c) {
    if (c.private) { openSheet(); return; }
    if (c.type === "file") {
      openKnowledgeBase(c);
      return;
    }
    if (c.type === "english") { toggleAudio(c); return; }
    var url = resolveUrl(c.open_url);
    if (url) {
      try { window.open(url, "_blank", "noopener"); } catch (e) { location.href = url; }
    }
  }

  function ensureAudio(c) {
    if (state.audio && state.playingId === c.id) return state.audio;
    stopAudio();
    var a = new Audio(resolveUrl(c.media.url));
    a.preload = "metadata";
    state.audio = a;
    state.playingId = c.id;
    a.addEventListener("timeupdate", function () { paintPlayer(c); });
    a.addEventListener("ended", function () { paintPlayer(c, true); });
    a.addEventListener("loadedmetadata", function () { paintPlayer(c); });
    return a;
  }

  function toggleAudio(c) {
    if (!c.media || !c.media.url) { toast("没有音频"); return; }
    var a = ensureAudio(c);
    if (a.paused) {
      a.play().then(function () { paintPlayer(c); }).catch(function () { toast("音频播放失败"); });
    } else {
      a.pause();
      paintPlayer(c);
    }
  }

  function seekAudio(c, ev) {
    var a = ensureAudio(c);
    if (!a.duration || !isFinite(a.duration)) return;
    var track = ev.currentTarget;
    var rect = track.getBoundingClientRect();
    var p = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    a.currentTime = p * a.duration;
    if (a.paused) a.play().catch(function () {});
    paintPlayer(c);
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
    /* Keep the bottom primary button label in sync on the english card. */
  }

  function fmtDur(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + String(s).padStart(2, "0");
  }


  function hydrateAudioMeta() {
    state.visible.forEach(function (c) {
      if (!c.media || c.media.kind !== "audio" || !c.media.url) return;
      var probe = new Audio();
      probe.preload = "metadata";
      probe.src = resolveUrl(c.media.url);
      probe.addEventListener("loadedmetadata", function () {
        if (!state.root) return;
        var tm = state.root.querySelector('.q-player[data-id="' + cssEscape(c.id) + '"] .q-tm');
        if (tm && state.playingId !== c.id) tm.textContent = "0:00 / " + fmtDur(probe.duration);
      });
    });
  }

  function stopAudio() {
    if (state.audio) {
      try { state.audio.pause(); } catch (e) {}
      state.audio.src = "";
    }
    state.audio = null;
    state.playingId = null;
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
    if (undoable) {
      var a = el("button", { class: "a", type: "button", onClick: undo }, "撤销");
      t.appendChild(a);
    }
    t.hidden = false;
    t.classList.add("on");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      t.classList.remove("on");
    }, 1600);
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

  function unmount() {
    stopAudio();
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    if (state._mq) { state._mq.removeEventListener("change", onMq); state._mq = null; }
    clearTimeout(state.toastTimer);
    if (state.root) state.root.innerHTML = "";
    state.root = null;
    state.all = [];
    state.visible = [];
  }

  global.QbotFeed = { mount: mount, unmount: unmount };
})(window);
