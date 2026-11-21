/**
 * Scripts injected into the existing site. The live page still owns Feed and
 * the knowledge base. The host owns the tab bar, the back stack between tabs,
 * and the resolved light/dark value.
 */

import { LIST_PANE_MAX, LIST_PANE_MIN, LIST_PANE_RATIO, SPLIT_WIDTH } from "./theme.ts";

/** Same 38% / 320–400 rule as the native list, applied to the knowledge-base directory. */
export function hostEmbedCss(): string {
  const percent = `${Math.round(LIST_PANE_RATIO * 100)}%`;
  return "#qbsNav{display:none!important}#qbs{grid-template-rows:minmax(0,1fr)!important;grid-template-columns:minmax(0,1fr)!important;grid-template-areas:\"main\" !important}"
    + `@media (min-width:${SPLIT_WIDTH}px){.kb-pane{width:clamp(${LIST_PANE_MIN}px,${percent},${LIST_PANE_MAX}px)!important;flex:none!important;border-right:1px solid var(--line)!important}}`;
}

/** Hide demo library rows before the page script reads index.json. Real rows stay. */
export function kbDemoFilter(): string {
  return `(function () {
  if (window.__qbotKbFilter || !window.fetch) return;
  window.__qbotKbFilter = true;
  var orig = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var pending = orig.call(this, input, init);
    if (String(url).indexOf("index.json") === -1) return pending;
    return pending.then(function (res) {
      return res.clone().json().then(function (data) {
        if (!data || !Array.isArray(data.files)) return res;
        var files = data.files.filter(function (item) {
          var tags = (item && item.tags) || [];
          var blob = ((item && item.name) || "") + " " + ((item && item.key) || "");
          if (blob.indexOf("示例") !== -1) return false;
          for (var i = 0; i < tags.length; i++) if (String(tags[i]).indexOf("示例") !== -1) return false;
          return true;
        });
        return new Response(JSON.stringify(Object.assign({}, data, { files: files, count: files.length })), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }).catch(function () { return res; });
    });
  };
})();
true;`;
}

export function themeBoot(dark: boolean): string {
  const flag = dark ? "true" : "false";
  return `(function () {
  window.__QBOT_HOST_DARK = ${flag};
  var orig = window.matchMedia ? window.matchMedia.bind(window) : null;
  if (!window.__QBOT_THEME_MQ) {
    var mq = {
      media: "(prefers-color-scheme: dark)",
      _ls: [],
      addEventListener: function (_t, fn) { if (fn) this._ls.push(fn); },
      removeEventListener: function (_t, fn) { this._ls = this._ls.filter(function (x) { return x !== fn; }); },
      addListener: function (fn) { this.addEventListener("change", fn); },
      removeListener: function (fn) { this.removeEventListener("change", fn); }
    };
    Object.defineProperty(mq, "matches", { get: function () { return !!window.__QBOT_HOST_DARK; } });
    window.__QBOT_THEME_MQ = mq;
    window.matchMedia = function (q) {
      if (q && String(q).indexOf("prefers-color-scheme") !== -1) return window.__QBOT_THEME_MQ;
      return orig ? orig(q) : { matches: false, addEventListener: function () {}, removeEventListener: function () {} };
    };
  }
  function paint() {
    var theme = window.__QBOT_HOST_DARK ? "dark" : "light";
    var html = document.documentElement;
    if (html) {
      html.setAttribute("data-theme", theme);
      html.style.colorScheme = theme;
    }
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (!meta && document.head) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "color-scheme");
      document.head.appendChild(meta);
    }
    if (meta) meta.setAttribute("content", theme);
    var bar = document.getElementById("qbsThemeColor");
    if (bar) bar.setAttribute("content", theme === "dark" ? "#171614" : "#F3EFE7");
  }
  paint();
  document.addEventListener("DOMContentLoaded", paint);
})();
true;`;
}

export function themeUpdate(dark: boolean): string {
  const flag = dark ? "true" : "false";
  return `(function () {
  window.__QBOT_HOST_DARK = ${flag};
  var theme = ${flag} ? "dark" : "light";
  var html = document.documentElement;
  if (html) {
    html.setAttribute("data-theme", theme);
    html.style.colorScheme = theme;
  }
  var meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute("content", theme);
  if (window.QbotShellTheme && typeof QbotShellTheme.apply === "function") {
    try { QbotShellTheme.apply(html, "auto", !!window.__QBOT_HOST_DARK); } catch (e) {}
  }
  var mq = window.__QBOT_THEME_MQ;
  if (mq && mq._ls) {
    mq._ls.slice().forEach(function (fn) {
      try { fn({ matches: !!window.__QBOT_HOST_DARK }); } catch (e) {}
    });
  }
})();
true;`;
}

export function showWebTab(tab: "feed" | "kb"): string {
  return `(function () {
  var style = document.getElementById("qbot-host-embed");
  if (!style && document.head) {
    style = document.createElement("style");
    style.id = "qbot-host-embed";
    document.head.appendChild(style);
  }
  if (style) style.textContent = ${JSON.stringify(hostEmbedCss())};
  if (window.qbotTab) {
    try { window.qbotTab(${JSON.stringify(tab)}); } catch (e) {}
  }
  if (!window.__qbotHostBackPatched && window.qbotBack) {
    var orig = window.qbotBack;
    window.qbotBack = function (opts) {
      var before = window.qbotCurrentTab && window.qbotCurrentTab();
      var handled = false;
      try { handled = !!orig(opts); } catch (e) { handled = false; }
      var after = window.qbotCurrentTab && window.qbotCurrentTab();
      if (before && after && before !== after) {
        try { window.qbotTab(before); } catch (e) {}
        return false;
      }
      return handled;
    };
    window.__qbotHostBackPatched = true;
  }
})();
true;`;
}

/** Leave the feed tab inside the hidden page so its own code pauses media and parks scroll. */
export function parkWeb(): string {
  return `(function () {
  if (window.qbotTab) {
    try { window.qbotTab("chat"); } catch (e) {}
  }
})();
true;`;
}

export const ASK_BACK = `(function () {
  var handled = false;
  try { handled = !!(window.qbotBack && window.qbotBack()); } catch (e) {}
  try {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "back", handled: handled }));
  } catch (e) {}
})();
true;`;
