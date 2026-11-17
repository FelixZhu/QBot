import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyFeedCloseDetail } from "./feed-close-detail.mjs";

const template = readFileSync(new URL("./template.html", import.meta.url), "utf8");
const PR4 = "0dc920ac3ed47c78795347201488a0987beafd4c";

function popstateHandler() {
  const at = template.indexOf('addEventListener("popstate"');
  assert.ok(at >= 0, "popstate listener missing");
  return template.slice(at, template.indexOf("function toast", at));
}

test("browser popstate calls the live shell back, not only the drive handler", () => {
  const pop = popstateHandler();
  assert.match(pop, /window\.qbotBack/);
  assert.match(pop, /fromPop:true/);
  assert.equal(/^\s*qbotBack\(\{fromPop:true\}\)/m.test(pop), false);
});

test("closing an article does not push the overlay state back onto the stack", () => {
  const branch = template.slice(template.indexOf("if(window.qbotShell&&qbotShell.isOpen())"), template.indexOf("var handled=false;"));
  assert.match(branch, /closeShellOverlay\(\)/);
  assert.equal(branch.includes("restoreShellHistory"), false);
  assert.match(template, /skipFeedHome/);
});

test("leaving the feed parks its scroll before the panel is hidden", () => {
  const fn = template.slice(template.indexOf("function setTab"), template.indexOf("function showViewer"));
  const note = fn.indexOf("noteFeedPark()");
  const hide = fn.indexOf("syncPanel(");
  assert.ok(note >= 0, "setTab does not park the feed scroll");
  assert.ok(hide >= 0 && note < hide, "feed scroll must be parked before the panel is hidden");
  assert.match(template, /restoreFeedPark\(\)/);
});

test("the back after an article returns to chat instead of calling feed.back", () => {
  const feedBranch = template.slice(template.indexOf('else if(cur==="feed")'), template.indexOf("}else{", template.indexOf('else if(cur==="feed")')));
  assert.match(feedBranch, /skipFeedHome/);
  assert.match(feedBranch, /setTab\("chat"/);
});

test("PR4 closeDetail stays private and calls the shell until the export delta", () => {
  const raw = execFileSync("git", ["show", PR4 + ":apps/drive-web/feed.js"], { encoding: "utf8" });
  assert.match(raw, /function closeDetail\(\)/);
  assert.match(raw, /shell\.close\(\)/);
  assert.equal(raw.includes("closeDetail: closeDetail"), false);
  const patched = applyFeedCloseDetail(raw);
  assert.equal(patched.includes("closeDetail: closeDetail"), true);
  const body = patched.slice(patched.indexOf("function closeDetail()"), patched.indexOf("function back()"));
  assert.equal(body.includes("shell.close"), false);
  assert.match(body, /if \(!saved\) return false/);
  assert.match(body, /return true/);
  assert.equal(applyFeedCloseDetail(patched), patched);
});
