import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const template = readFileSync(new URL("./template.html", import.meta.url), "utf8");

function closeShellOverlaySource() {
  const start = template.indexOf("function closeShellOverlay()");
  assert.ok(start >= 0, "closeShellOverlay is missing from template.html");
  let depth = 0;
  let started = false;
  for (let i = start; i < template.length; i++) {
    if (template[i] === "{") { depth++; started = true; }
    else if (template[i] === "}") {
      depth--;
      if (started && depth === 0) return template.slice(start, i + 1);
    }
  }
  throw new Error("closeShellOverlay did not end");
}

function runClose(feed, shell) {
  const window = { qbotFeed: feed, qbotShell: shell };
  const runner = new Function("window", closeShellOverlaySource() + "\nreturn closeShellOverlay();");
  return runner(window);
}

function feedLike(initial) {
  const state = {
    detail: initial.detail,
    index: initial.index,
    scrollTop: initial.scrollTop,
    backs: 0
  };
  const shell = initial.shell;
  return {
    state,
    closeDetail() {
      if (!state.detail) return false;
      const saved = state.detail;
      state.detail = null;
      state.index = saved.index;
      state.scrollTop = saved.scrollTop;
      if (saved.via === "shell" && shell && shell.isOpen()) shell.close();
      return true;
    },
    back() {
      state.backs += 1;
      if (state.detail) return this.closeDetail();
      if (state.index > 0) {
        state.index = 0;
        state.scrollTop = 0;
        return true;
      }
      return false;
    }
  };
}

test("template closes the overlay through closeDetail and not qbotFeed.back", () => {
  const src = closeShellOverlaySource();
  assert.match(src, /closeDetail/);
  assert.equal(src.includes(".back("), false);
  const branch = template.slice(template.indexOf("if(window.qbotShell&&qbotShell.isOpen())"), template.indexOf("var handled=false;"));
  assert.match(branch, /closeShellOverlay\(\)/);
  assert.equal(branch.includes("qbotFeed.back"), false);
});

test("back closes the article overlay and the next back is a normal Feed back", () => {
  const shell = {
    open: true,
    isOpen() { return this.open; },
    close() { this.open = false; return true; }
  };
  const feed = feedLike({
    detail: { via: "shell", index: 1, scrollTop: 743 },
    index: 1,
    scrollTop: 743,
    shell
  });
  assert.equal(runClose(feed, shell), true);
  assert.equal(shell.open, false);
  assert.equal(feed.state.detail, null);
  assert.equal(feed.state.index, 1);
  assert.equal(feed.state.scrollTop, 743);
  assert.equal(feed.state.backs, 0);
  assert.equal(feed.back(), true);
  assert.equal(feed.state.index, 0);
  assert.equal(feed.state.scrollTop, 0);
});

test("without closeDetail the shell only closes the overlay", () => {
  const shell = {
    open: true,
    isOpen() { return this.open; },
    close() { this.open = false; return true; }
  };
  let backs = 0;
  const feed = {
    index: 1,
    scrollTop: 743,
    back() { backs += 1; this.index = 0; this.scrollTop = 0; return true; }
  };
  runClose(feed, shell);
  assert.equal(shell.open, false);
  assert.equal(backs, 0);
  assert.equal(feed.index, 1);
  assert.equal(feed.scrollTop, 743);
});
