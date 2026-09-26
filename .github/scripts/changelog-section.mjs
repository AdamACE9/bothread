#!/usr/bin/env node
// Prints the CHANGELOG.md section for one version, without its "## <version>"
// heading, for use as GitHub Release notes.
//
//   node .github/scripts/changelog-section.mjs 0.3.0 [CHANGELOG.md]
//
// Matches "## 0.3.0", "## v0.3.0", "## [0.3.0]" and "## 0.3.0 - 2026-09-26".
// Exits 1 if the version has no section, so a release can't ship without notes.
import { readFileSync } from "node:fs";

const [version, file = "CHANGELOG.md"] = process.argv.slice(2);
if (!version) {
  console.error("usage: changelog-section.mjs <version> [CHANGELOG.md]");
  process.exit(2);
}
const esc = version.replace(/^v/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const heading = new RegExp(`^##\\s+\\[?v?${esc}\\]?(?=\\s|$)`);
const lines = readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n");
const start = lines.findIndex((l) => heading.test(l));
if (start === -1) {
  console.error(`No "## ${version}" section in ${file}`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
if (end === -1) end = lines.length;
const body = lines.slice(start + 1, end).join("\n").trim();
if (!body) {
  console.error(`The "## ${version}" section in ${file} is empty`);
  process.exit(1);
}
process.stdout.write(body + "\n");
