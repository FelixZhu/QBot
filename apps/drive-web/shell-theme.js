/* QBot shell appearance.
 * The page follows prefers-color-scheme. A saved qd2_theme value is not
 * applied, so an old manual light/dark choice cannot lock the page.
 * The system value is re-read on change, visibility, pageshow, and focus.
 * There is no appearance tab and no theme picker.
 *
 * data-theme on <html> is the resolved light|dark so existing tokens,
 * feed.css, and the drive --d-* rules keep working. data-theme-mode stays
 * "auto".
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.QbotShellTheme = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var KEY = "qd2_theme";
  var MODES = ["light", "dark", "auto"];
  var LABELS = { light: "浅色", dark: "深色", auto: "跟随系统" };
  var THEME_COLOR = { light: "#F3EFE7", dark: "#171614" };
  var FOLD = 600;

  function normalize(value) {
    return value === "light" || value === "dark" || value === "auto" ? value : null;
  }

  function parseStored(raw) {
    if (raw == null) return { mode: "auto", missing: true };
    var parsed = raw;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = raw; }
    var mode = normalize(parsed);
    if (!mode) return { mode: "auto", invalid: true, raw: raw };
    return { mode: mode, explicit: mode !== "auto" };
  }

  function read(storage) {
    var raw = null;
    try { raw = storage.getItem(KEY); } catch (e) { raw = null; }
    return parseStored(raw);
  }

  function write(storage, mode) {
    if (!normalize(mode)) throw new Error("bad theme");
    storage.setItem(KEY, JSON.stringify(mode));
  }

  function resolve(mode, systemDark) {
    if (mode === "light" || mode === "dark") return mode;
    return systemDark ? "dark" : "light";
  }

  function reduce(state, event) {
    state = state || { mode: "auto", systemDark: false };
    var mode = state.mode;
    var systemDark = !!state.systemDark;
    if (!event) event = {};
    if (event.type === "choose") mode = normalize(event.mode) || mode;
    else if (event.type === "restart") {
      mode = event.mode || mode;
      if (event.systemDark != null) systemDark = !!event.systemDark;
    } else if (event.type === "system" || event.type === "foreground") {
      if (event.systemDark != null) systemDark = !!event.systemDark;
    }
    return {
      mode: mode,
      systemDark: systemDark,
      resolved: resolve(mode, systemDark),
      followsSystem: mode === "auto"
    };
  }

  function placement(width, tab) {
    var folded = (Number(width) || 0) < FOLD;
    return {
      tab: tab,
      width: Number(width) || 0,
      visible: true,
      clippedByPanel: false,
      edge: folded ? "bottom" : "rail",
      menu: folded ? "above-tabbar" : "beside-rail"
    };
  }

  function apply(el, mode, systemDark) {
    var choice = normalize(mode) || "auto";
    var resolved = resolve(choice, !!systemDark);
    if (el) {
      el.setAttribute("data-theme", resolved);
      el.setAttribute("data-theme-mode", choice);
      if (el.style) el.style.colorScheme = resolved;
    }
    return { mode: choice, resolved: resolved, systemDark: !!systemDark };
  }

  function boot(doc, env) {
    doc = doc || (typeof document !== "undefined" ? document : null);
    env = env || {};
    if (!doc || !doc.documentElement) return null;
    var systemDark = env.systemDark;
    if (systemDark == null) {
      try { systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { systemDark = false; }
    }
    var applied = apply(doc.documentElement, "auto", !!systemDark);
    paintColor(doc, applied.resolved);
    return applied;
  }

  function paintColor(doc, resolved) {
    var meta = doc.getElementById && doc.getElementById("qbsThemeColor");
    if (meta) meta.setAttribute("content", THEME_COLOR[resolved] || THEME_COLOR.light);
  }

  function mount(opts) {
    opts = opts || {};
    var doc = opts.document || document;
    var win = opts.window || window;
    if (win.__qbotThemeMounted) return win.QbotShellTheme;
    win.__qbotThemeMounted = true;
    var staleBtn = doc.getElementById("qbsAppearanceBtn");
    var stalePop = doc.getElementById("qbsAppearance");
    if (staleBtn && staleBtn.parentNode) staleBtn.parentNode.removeChild(staleBtn);
    if (stalePop && stalePop.parentNode) stalePop.parentNode.removeChild(stalePop);

    function systemDark() {
      try { return win.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { return false; }
    }

    function refresh(reason) {
      var applied = apply(doc.documentElement, "auto", systemDark());
      paintColor(doc, applied.resolved);
      try {
        win.dispatchEvent(new CustomEvent("qbot:theme", { detail: { mode: applied.mode, resolved: applied.resolved, systemDark: applied.systemDark, reason: reason || "" } }));
      } catch (e) {}
      return applied;
    }

    function onSystem() { refresh("system"); }
    try {
      var mq = win.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", onSystem);
      else if (mq.addListener) mq.addListener(onSystem);
    } catch (e) {}
    doc.addEventListener("visibilitychange", function () {
      if (doc.visibilityState === "visible") refresh("foreground");
    });
    win.addEventListener("pageshow", function () { refresh("foreground"); });
    win.addEventListener("focus", function () { refresh("foreground"); });

    refresh("mount");

    var controls = {
      open: function () { return false; },
      close: function () { return false; },
      isOpen: function () { return false; },
      choose: function () { return refresh("choose"); },
      refresh: refresh
    };
    win.qbotAppearance = controls;
    if (win.QbotShellTheme) {
      win.QbotShellTheme.isOpen = controls.isOpen;
      win.QbotShellTheme.close = controls.close;
      win.QbotShellTheme.open = controls.open;
    }
    return controls;
  }

  return {
    KEY: KEY,
    MODES: MODES,
    LABELS: LABELS,
    THEME_COLOR: THEME_COLOR,
    FOLD: FOLD,
    normalize: normalize,
    read: read,
    write: write,
    resolve: resolve,
    reduce: reduce,
    placement: placement,
    apply: apply,
    boot: boot,
    mount: mount
  };
});
