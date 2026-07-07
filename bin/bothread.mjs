#!/usr/bin/env node
/**
 * `bothread` — the global CLI.
 *
 * Two modes:
 *  • Production (npm install / npx):  dist-server/server.js already bundled → node it directly.
 *  • Development (cloned repo):       no bundle → tsx + TypeScript source, auto-build UI.
 *
 * Install once from the repo with `npm install && npm link`, or globally with
 * `npm install -g bothread` (or `npx bothread start` for zero-install).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const args = process.argv.slice(2);
const cmd = (args[0] ?? "start").toLowerCase();

function help() {
  console.log(`
  bothread — a local, human-governed room where your AI agents work together.

  Usage:
    bothread             Start the hub and open the room (same as 'start')
    bothread start       Start the hub and open the room
    bothread help        Show this help

  Options (env vars):
    BOTHREAD_PORT=4889   Port to bind on 127.0.0.1
    BOTHREAD_AUTH=off    Disable the agent bearer token (local only)
    BOTHREAD_NO_OPEN=1   Don't auto-open the browser
    BOTHREAD_DB=path     SQLite file (default: per-user data dir)
`);
}

if (["help", "--help", "-h"].includes(cmd)) {
  help();
  process.exit(0);
}
if (["--version", "-v", "version"].includes(cmd)) {
  console.log("bothread 0.2.0");
  process.exit(0);
}
if (cmd !== "start") {
  console.error(`Unknown command: ${cmd}\nTry 'bothread start' or 'bothread help'.`);
  process.exit(1);
}

// Friendly preflight: Node version.
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 20) {
  console.error(
    `\n  Bothread needs Node.js 20 or newer — you're on ${process.versions.node}.\n` +
      `  Install the latest LTS from https://nodejs.org, then run 'bothread start' again.\n`
  );
  process.exit(1);
}

function sh(command, cmdArgs) {
  const r = spawnSync(command, cmdArgs, { stdio: "inherit", shell: isWin, cwd: root });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** Newest mtime under `dir` (recursive), skipping node_modules/dist. Best-effort. */
function newestMtime(dir) {
  let newest = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          const m = statSync(p).mtimeMs;
          if (m > newest) newest = m;
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(dir);
  return newest;
}

/** True if the room UI's built dist/ is missing OR older than its source
 *  (room-ui + the shared types it depends on) — so a `git pull` of UI or
 *  shared-type changes doesn't silently serve a stale build. */
function uiNeedsBuild() {
  const distIndex = path.join(root, "apps", "room-ui", "dist", "index.html");
  if (!existsSync(distIndex)) return true;
  const builtAt = statSync(distIndex).mtimeMs;
  const sourceAt = Math.max(
    newestMtime(path.join(root, "apps", "room-ui", "src")),
    newestMtime(path.join(root, "packages", "shared", "src"))
  );
  return sourceAt > builtAt;
}

// ── Production mode (npm install / npx): use the pre-built bundle. ──
const prodBundle = path.join(root, "dist-server", "server.js");
if (existsSync(prodBundle)) {
  const hub = spawn(process.execPath, [prodBundle], {
    stdio: "inherit",
    cwd: root,
    env: process.env,
  });
  hub.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => hub.kill("SIGINT"));
  process.on("SIGTERM", () => hub.kill("SIGTERM"));
  process.exit; // never reached; keeps linters happy
} else {
  // ── Development mode (cloned repo): tsx + TypeScript source. ──
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  if (!existsSync(tsxCli)) {
    console.log("• Installing dependencies (first run only)…\n");
    sh("npm", ["install"]);
  }
  if (uiNeedsBuild()) {
    console.log("• Building the room UI (new or changed since last build)…\n");
    sh("npm", ["run", "build:ui"]);
  }

  const hub = spawn(process.execPath, [tsxCli, path.join(root, "packages", "server", "src", "index.ts")], {
    stdio: "inherit",
    cwd: root,
    env: process.env,
  });
  hub.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => hub.kill("SIGINT"));
  process.on("SIGTERM", () => hub.kill("SIGTERM"));
}
