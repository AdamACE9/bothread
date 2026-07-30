#!/usr/bin/env node
/**
 * Fires one anonymous "package_installed" telemetry event when `bothread` is
 * fetched — via `npm install -g bothread` or the first `npx bothread`. Same
 * privacy contract as packages/server/src/telemetry.ts (which this
 * necessarily duplicates in miniature: this runs at npm-install time, before
 * any TypeScript build exists to import from).
 *
 * Set BOTHREAD_NO_TELEMETRY=1 to skip entirely.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Real consumer installs (npm -g / npx) never ship packages/server/src — only
// dist-server/server.js. If it's present, this is a contributor's own
// `npm install` in the monorepo, not a real install — skip telemetry.
const isDevClone = existsSync(path.join(process.cwd(), "packages", "server", "src", "index.ts"));

if (!isDevClone && !process.env.BOTHREAD_NO_TELEMETRY) {
  const platform = { win32: "windows", darwin: "mac", linux: "linux" }[os.platform()] ?? "other";
  const cwd = process.cwd();
  const channel =
    cwd.includes(`${path.sep}_npx${path.sep}`) || cwd.includes("/_npx/")
      ? "npx"
      : process.env.npm_config_global === "true"
        ? "global"
        : "other";

  let version = "";
  try {
    version = JSON.parse(process.env.npm_package_version ? `"${process.env.npm_package_version}"` : '""');
  } catch {
    /* ignore */
  }

  const fields = {
    event: { stringValue: "package_installed" },
    platform: { stringValue: platform },
    channel: { stringValue: channel },
    ts: { timestampValue: new Date().toISOString() },
    ...(version ? { version: { stringValue: version } } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  fetch("https://firestore.googleapis.com/v1/projects/bot-thread/databases/(default)/documents/telemetry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields }),
    signal: controller.signal,
  })
    .catch(() => {})
    .finally(() => clearTimeout(timer));
}
