/* QBot shell appearance.
 * Persisted choice is only localStorage qd2_theme (JSON string: light | dark | auto).
 * Explicit light/dark always win. auto follows prefers-color-scheme and is
 * re-read on change, visibility, pageshow, and focus.
 * A saved "dark" from the old hidden toggle is kept until the user picks
 * something else. Reading never writes, and writing never touches other keys.
 *
 * data-theme on <html> is the resolved light|dark so existing tokens,
 * feed.css, and the drive --d-* rules keep working. data-theme-mode is the
 * choice (light|dark|auto).
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

  function boot(doc) {
    doc = doc || (typeof document !== "undefined" ? document : null);
    if (!doc || !doc.documentElement) return null;
    var storage = typeof localStorage !== "undefined" ? localStorage : { getItem: function () { return null; } };
    var mode = read(storage).mode;
    var systemDark = false;
    try { systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) {}
    var applied = apply(doc.documentElement, mode, systemDark);
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
    var storage = opts.storage || win.localStorage;
    var nav = opts.nav || doc.getElementById("qbsNav");
    var host = opts.host || doc.getElementById("qbs") || doc.body;
    var btn = doc.getElementById("qbsAppearanceBtn");
    var pop = doc.getElementById("qbsAppearance");
    var open = false;

    if (!btn && nav) {
      btn = doc.createElement("button");
      btn.type = "button";
      btn.id = "qbsAppearanceBtn";
      btn.className = "qbs-appearance";
      nav.appendChild(btn);
    }
    if (btn) {
      btn.setAttribute("aria-haspopup", "dialog");
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-controls", "qbsAppearance");
      if (!btn.getAttribute("aria-label")) btn.setAttribute("aria-label", "外观");
      if (!btn.querySelector("span")) {
        btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/></svg><span>外观</span>';
      }
    }
    if (!pop) {
      pop = doc.createElement("div");
      pop.id = "qbsAppearance";
      pop.className = "qbs-appearance-pop";
      pop.hidden = true;
      host.appendChild(pop);
    }
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "外观");
    if (!pop.querySelector("[data-mode]")) {
      pop.innerHTML = '<div class="qbs-appearance-title">外观</div><div role="radiogroup" aria-label="外观"></div>';
      var group = pop.querySelector("[role=radiogroup]");
      MODES.forEach(function (mode) {
        var b = doc.createElement("button");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.setAttribute("data-mode", mode);
        b.textContent = LABELS[mode];
        group.appendChild(b);
      });
    }

    function systemDark() {
      try { return win.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { return false; }
    }

    function refresh(reason) {
      var mode = read(storage).mode;
      var applied = apply(doc.documentElement, mode, systemDark());
      paintColor(doc, applied.resolved);
      paintMenu(mode);
      try {
        win.dispatchEvent(new CustomEvent("qbot:theme", { detail: { mode: applied.mode, resolved: applied.resolved, systemDark: applied.systemDark, reason: reason || "" } }));
      } catch (e) {}
      return applied;
    }

    function paintMenu(mode) {
      var nodes = pop.querySelectorAll("[data-mode]");
      for (var i = 0; i < nodes.length; i++) {
        var on = nodes[i].getAttribute("data-mode") === mode;
        nodes[i].setAttribute("aria-checked", on ? "true" : "false");
      }
    }

    function setOpen(on) {
      open = !!on;
      pop.hidden = !open;
      if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        var checked = pop.querySelector('[aria-checked="true"]');
        if (checked && checked.focus) checked.focus();
      }
    }

    function choose(mode) {
      if (!normalize(mode)) return refresh("reject");
      write(storage, mode);
      var applied = refresh("choose");
      setOpen(false);
      return applied;
    }

    if (btn) btn.addEventListener("click", function (e) {
      e.stopPropagation();
      setOpen(!open);
    });
    pop.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-mode]") : null;
      if (!b) return;
      e.stopPropagation();
      choose(b.getAttribute("data-mode"));
    });
    doc.addEventListener("click", function (e) {
      if (!open) return;
      if (pop.contains(e.target) || (btn && btn.contains(e.target))) return;
      setOpen(false);
    });
    win.addEventListener("qbot:appearance", function () { setOpen(true); });

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
      open: function () { setOpen(true); },
      close: function () { if (!open) return false; setOpen(false); return true; },
      isOpen: function () { return open; },
      choose: choose,
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
