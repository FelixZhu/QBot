import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const theme = require("./shell-theme.js");
const template = readFileSync(new URL("./template.html", import.meta.url), "utf8");
const feedJs = readFileSync(new URL("./feed.js", import.meta.url), "utf8");
const kbJs = readFileSync(new URL("./kb.js", import.meta.url), "utf8");

function memory(initial) {
  const map = Object.assign({}, initial || {});
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem(k, v) { map[k] = String(v); },
    dump() { return Object.assign({}, map); }
  };
}

test("appearance control is on every tab at 390 and 840", () => {
  for (const tab of ["chat", "feed", "kb"]) {
    for (const width of [390, 840]) {
      const place = theme.placement(width, tab);
      assert.equal(place.visible, true);
      assert.equal(place.tab, tab);
      assert.equal(place.clippedByPanel, false);
      assert.equal(place.edge, width === 390 ? "bottom" : "rail");
      assert.equal(place.menu, width === 390 ? "above-tabbar" : "beside-rail");
    }
  }
  assert.match(template, /id="qbsAppearanceBtn"/);
  assert.match(template, /id="qbsAppearance"/);
  assert.match(template, /浅色/);
  assert.match(template, /深色/);
  assert.match(template, /跟随系统/);
  assert.match(template, /shell-theme\.js\?v=__VERSION__/);
  assert.match(template, /QbotShellTheme\.boot\(\)/);
  assert.match(template, /QbotShellTheme\.mount\(\{nav:document\.getElementById\("qbsNav"\)\}\)/);
  assert.match(template, /QbotShellTheme&&QbotShellTheme\.isOpen&&QbotShellTheme\.isOpen\(\)/);
  assert.equal(template.includes('S.theme=dark?"light":"dark"'), false);
  assert.match(template, /\.qbs-appearance\{flex:1/);
  assert.match(template, /@media \(min-width:600px\)\{[^}]*\.qbs-appearance\{[^}]*margin-top:auto/);
  assert.equal(feedJs.includes("qbsAppearance"), false);
  assert.equal(kbJs.includes("qbsAppearance"), false);
});

test("explicit light or dark wins over the system", () => {
  assert.equal(theme.resolve("light", true), "light");
  assert.equal(theme.resolve("dark", false), "dark");
  assert.equal(theme.resolve("auto", false), "light");
  assert.equal(theme.resolve("auto", true), "dark");
  const light = theme.reduce({ mode: "light", systemDark: true }, { type: "system", systemDark: true });
  assert.equal(light.resolved, "light");
  assert.equal(light.followsSystem, false);
  const dark = theme.reduce({ mode: "dark", systemDark: false }, { type: "foreground", systemDark: false });
  assert.equal(dark.resolved, "dark");
});

test("legacy saved dark is kept and recoverable, not reset", () => {
  const store = memory({
    qd2_theme: JSON.stringify("dark"),
    qd2_tabs: JSON.stringify(["~home"]),
    qd2_active: JSON.stringify("~home")
  });
  const before = store.dump();
  const saved = theme.read(store);
  assert.equal(saved.mode, "dark");
  assert.deepEqual(store.dump(), before);
  assert.equal(theme.resolve(saved.mode, false), "dark");
  const chosen = theme.reduce({ mode: saved.mode, systemDark: false }, { type: "choose", mode: "auto" });
  assert.equal(chosen.mode, "auto");
  assert.equal(chosen.resolved, "light");
  theme.write(store, chosen.mode);
  assert.equal(JSON.parse(store.getItem("qd2_theme")), "auto");
  assert.equal(store.getItem("qd2_tabs"), before.qd2_tabs);
  assert.equal(store.getItem("qd2_active"), before.qd2_active);
});

test("refresh, restart, system change, and foreground", () => {
  const store = memory({ qd2_theme: JSON.stringify("auto"), "qd2_open": "{}" });
  assert.equal(theme.read(store).mode, "auto");
  let state = theme.reduce({ mode: "auto", systemDark: false }, { type: "restart", mode: theme.read(store).mode, systemDark: false });
  assert.equal(state.resolved, "light");
  state = theme.reduce(state, { type: "system", systemDark: true });
  assert.equal(state.resolved, "dark");
  assert.equal(state.followsSystem, true);
  state = theme.reduce(state, { type: "choose", mode: "light" });
  theme.write(store, "light");
  state = theme.reduce(
    { mode: theme.read(store).mode, systemDark: false },
    { type: "foreground", systemDark: true }
  );
  assert.equal(state.mode, "light");
  assert.equal(state.resolved, "light");
  const restarted = theme.reduce(
    { mode: theme.read(store).mode, systemDark: true },
    { type: "restart", mode: theme.read(store).mode, systemDark: true }
  );
  assert.equal(restarted.resolved, "light");
  assert.equal(store.getItem("qd2_open"), "{}");
});

test("invalid or missing storage does not get rewritten", () => {
  const missing = memory({ qd2_tabs: "[]" });
  assert.equal(theme.read(missing).mode, "auto");
  assert.equal(missing.getItem("qd2_theme"), null);
  const bad = memory({ qd2_theme: JSON.stringify("nope"), qd2_info: "false" });
  const snap = bad.dump();
  assert.equal(theme.read(bad).mode, "auto");
  assert.equal(theme.read(bad).invalid, true);
  assert.deepEqual(bad.dump(), snap);
});

test("apply sets resolved theme and keeps the choice", () => {
  const el = {
    attrs: {},
    style: {},
    setAttribute(k, v) { this.attrs[k] = v; }
  };
  const dark = theme.apply(el, "dark", false);
  assert.equal(dark.resolved, "dark");
  assert.equal(el.attrs["data-theme"], "dark");
  assert.equal(el.attrs["data-theme-mode"], "dark");
  assert.equal(el.style.colorScheme, "dark");
  const auto = theme.apply(el, "auto", false);
  assert.equal(auto.resolved, "light");
  assert.equal(el.attrs["data-theme"], "light");
  assert.equal(el.attrs["data-theme-mode"], "auto");
  assert.equal(theme.LABELS.light, "浅色");
  assert.equal(theme.LABELS.dark, "深色");
  assert.equal(theme.LABELS.auto, "跟随系统");
  assert.equal(theme.THEME_COLOR.light, "#F3EFE7");
  assert.equal(theme.THEME_COLOR.dark, "#171614");
});
