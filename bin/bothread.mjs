#!/usr/bin/env node
/**
 * `bothread` — the global CLI. Once installed (npm link, or `npm i -g bothread`
 * when published), run `bothread start` from ANY directory and the room opens.
 *
 * It resolves its own install location, so it always finds the repo's deps, the
 * built room UI, and the hub — no matter where you run it from.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
  console.log("bothread 0.1.0");
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

// First-run setup: install deps + build the room UI.
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!existsSync(tsxCli)) {
  console.log("• Installing dependencies (first run only)…\n");
  sh("npm", ["install"]);
}
if (!existsSync(path.join(root, "apps", "room-ui", "dist", "index.html"))) {
  console.log("• Building the room UI (first run only)…\n");
  sh("npm", ["run", "build:ui"]);
}

// Launch the hub via node + tsx (no PATH dependency on `npx`/`tsx`).
const hub = spawn(process.execPath, [tsxCli, path.join(root, "packages", "server", "src", "index.ts")], {
  stdio: "inherit",
  cwd: root,
  env: process.env,
});
hub.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => hub.kill("SIGINT"));
process.on("SIGTERM", () => hub.kill("SIGTERM"));
