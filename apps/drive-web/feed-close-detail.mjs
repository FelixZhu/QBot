/* Minimal delta on PR4 feed 0dc920ac: export idempotent closeDetail.
 * It clears private detail only, restores that card's index and scroll,
 * and does not call the shell. Applying it twice is a no-op. */

const SHELL_CALLBACK = `    if (saved && saved.via === "shell") {
      var shell = shellApi();
      if (shell && typeof shell.close === "function") {
        try { shell.close(); } catch (e) {}
      }
    }
`;

const EXPORT_BEFORE = "global.QbotFeed = { mount: mount, unmount: unmount, back: back };";
const EXPORT_AFTER = "global.QbotFeed = { mount: mount, unmount: unmount, back: back, closeDetail: closeDetail };";

export function applyFeedCloseDetail(src) {
  if (alreadyPatched(src)) return src;
  if (!src.includes("function closeDetail()")) throw new Error("feed.js has no closeDetail to export");
  if (!src.includes(SHELL_CALLBACK)) throw new Error("feed.js closeDetail is missing the shell callback this delta removes");
  let next = src.replace(SHELL_CALLBACK, "");
  next = next.replace("if (!saved) return;", "if (!saved) return false;");
  const start = next.indexOf("function closeDetail()");
  const end = next.indexOf("\n  function back()", start);
  if (start < 0 || end < 0) throw new Error("could not isolate closeDetail");
  let body = next.slice(start, end);
  if (!body.includes("return true;")) {
    if (!body.endsWith("\n  }\n")) throw new Error("closeDetail does not end where the delta expects");
    body = body.slice(0, -"\n  }\n".length) + "\n    return true;\n  }\n";
  }
  next = next.slice(0, start) + body + next.slice(end);
  if (!next.includes(EXPORT_BEFORE)) throw new Error("feed.js export line missing");
  next = next.replace(EXPORT_BEFORE, EXPORT_AFTER);
  if (!alreadyPatched(next)) throw new Error("closeDetail delta did not apply");
  return next;
}

function closeDetailBody(src) {
  const start = src.indexOf("function closeDetail()");
  const end = src.indexOf("\n  function back()", start);
  return src.slice(start, end);
}

function alreadyPatched(src) {
  if (!src.includes(EXPORT_AFTER)) return false;
  const body = closeDetailBody(src);
  return body.includes("return true;") && body.includes("return false;") && !body.includes("shell.close");
}
