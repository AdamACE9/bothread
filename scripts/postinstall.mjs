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

/**
 * Most installs on a young package are automated: registry mirrors, security
 * scanners, and CI. They look identical to a real user here except that they
 * never go on to run the CLI, which made every dashboard number ambiguous.
 * CI runners near-universally set CI=true, so record that one anonymous bit.
 */
const isCi = Boolean(
  process.env.CI ||
    process.env.CONTINUOUS_INTEGRATION ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.BUILDKITE ||
    process.env.CIRCLECI ||
    process.env.JENKINS_URL ||
    process.env.TEAMCITY_VERSION
);

if (!isDevClone && !process.env.BOTHREAD_NO_TELEMETRY) {
  const platform = { win32: "windows", darwin: "mac", linux: "linux" }[os.platform()] ?? "other";
  const cwd = process.cwd();
  // "local" is a plain `npm install bothread` into a project — distinct from
  // "other", which now genuinely means "couldn't tell".
  const channel =
    cwd.includes(`${path.sep}_npx${path.sep}`) || cwd.includes("/_npx/")
      ? "npx"
      : process.env.npm_config_global === "true"
        ? "global"
        : process.env.npm_command === "install" || process.env.npm_config_local_prefix
          ? "local"
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
    ci: { booleanValue: isCi },
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
