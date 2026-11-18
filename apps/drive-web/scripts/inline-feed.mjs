#!/usr/bin/env node
/**
 * Write a preview script a file:// page can load:
 *   <script src="feed-data.js"></script>
 * The file is `window.QBOT_FEED = <feed json>;`
 *
 *   node apps/drive-web/scripts/inline-feed.mjs [feed.json] [feed-data.js]
 *
 * Defaults: ./out/feed.json and ./feed-data.js, resolved from the current
 * directory. The JSON is read from disk; this script does not fetch or upload.
 */
import fs from "node:fs";
import path from "node:path";

const input = path.resolve(process.argv[2] || "out/feed.json");
const output = path.resolve(process.argv[3] || "feed-data.js");
const data = JSON.parse(fs.readFileSync(input, "utf8"));
if (!data || typeof data !== "object" || Array.isArray(data)) {
  throw new Error("feed json must be an object");
}
const json = JSON.stringify(data).replace(/</g, "\\u003c");
fs.writeFileSync(output, "window.QBOT_FEED = " + json + ";\n");
console.log(output);
