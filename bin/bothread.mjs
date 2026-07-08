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

// ── Startup banner: a chunky pixel-block "BOTHREAD" wordmark (same spirit as
// the big ASCII logo Claude Code shows at launch), in the copper→saffron→teal
// "Loom" thread gradient. Skipped entirely on a non-TTY (piped/CI) run.
const BANNER_FONT = {
  B: ["####.", "#..#.", "####.", "#..#.", "####."],
  O: [".###.", "#...#", "#...#", "#...#", ".###."],
  T: ["#####", "..#..", "..#..", "..#..", "..#.."],
  H: ["#...#", "#...#", "#####", "#...#", "#...#"],
  R: ["####.", "#...#", "####.", "#..#.", "#...#"],
  E: ["#####", "#....", "####.", "#....", "#####"],
  A: [".###.", "#...#", "#####", "#...#", "#...#"],
  D: ["####.", "#...#", "#...#", "#...#", "####."],
};

// The Loom palette's thread accent: copper -> saffron -> teal.
const GRADIENT_STOPS = [
  [0xcf, 0x7a, 0x3c],
  [0xe2, 0xa9, 0x4c],
  [0x63, 0xad, 0x8f],
];

function printBanner() {
  if (!process.stdout.isTTY) return;
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const RESET = "\x1b[0m";
  const colorAt = (t) => {
    const seg = t * (GRADIENT_STOPS.length - 1);
    const i = Math.min(GRADIENT_STOPS.length - 2, Math.floor(seg));
    const localT = seg - i;
    const [ar, ag, ab] = GRADIENT_STOPS[i];
    const [br, bg, bb] = GRADIENT_STOPS[i + 1];
    return [lerp(ar, br, localT), lerp(ag, bg, localT), lerp(ab, bb, localT)];
  };
  const fg = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;
  const bold = (r, g, b) => `\x1b[1m${fg(r, g, b)}`;

  // Single-width blocks, one line, one continuous word — "BOTHREAD" is one
  // word, not two, so it must never render as two visually separate stacked
  // words (that reads as "BOTH READ").
  const letters = "BOTHREAD".split("").map((ch) => BANNER_FONT[ch]);
  const wordLines = [];
  for (let row = 0; row < 5; row++) {
    let line = "";
    letters.forEach((letter, i) => {
      const t = i / (letters.length - 1);
      const [r, g, b] = colorAt(t);
      const glyph = letter[row].replace(/#/g, "█").replace(/\./g, " ");
      line += bold(r, g, b) + glyph + RESET + (i < letters.length - 1 ? " " : "");
    });
    wordLines.push(line);
  }
  const width = letters.length * 5 + (letters.length - 1); // 47, visible cols

  // A gradient thread running the same width as the wordmark, tying it back
  // to the woven-thread motif on the website.
  let threadBar = "";
  for (let i = 0; i < width; i++) {
    const [r, g, b] = colorAt(i / (width - 1));
    threadBar += fg(r, g, b) + "─";
  }
  threadBar += RESET;

  const boxLabel = "Welcome to Bothread";
  const boxPad = "─".repeat(boxLabel.length + 4);
  const [starR, starG, starB] = colorAt(0.5);
  const border = fg(0xcf, 0x7a, 0x3c);
  console.log(
    `\n${border}┌${boxPad}┐${RESET}\n` +
      `${border}│${RESET} ${fg(starR, starG, starB)}★${RESET} ${bold(0xec, 0xe4, 0xd3)}${boxLabel}${RESET} ${border}│${RESET}\n` +
      `${border}└${boxPad}┘${RESET}\n`
  );
  console.log(wordLines.join("\n"));
  console.log(threadBar);
  console.log(`\n  A local, human-governed room where your AI agents work together.\n`);
}

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

printBanner();

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

// A real `npm install`/`npx` consumer only gets what package.json's `files` ships —
// bin/, dist-server/, apps/room-ui/dist, LICENSE, README. It never has
// packages/server/src. A git clone always does. So this path is the one reliable
// signal for "dev clone" — and in dev-clone mode we NEVER trust a possibly-stale
// dist-server/server.js bundle (e.g. left over from a one-off `npm run build:server`
// during testing): we always run live from TypeScript source via tsx instead, so
// `git pull && bothread start` is a complete, correct update — no separate build step.
const isDevClone = existsSync(path.join(root, "packages", "server", "src", "index.ts"));
const prodBundle = path.join(root, "dist-server", "server.js");

if (!isDevClone && existsSync(prodBundle)) {
  // ── Production mode (npm install / npx): use the pre-built bundle. ──
  const hub = spawn(process.execPath, [prodBundle], {
    stdio: "inherit",
    cwd: root,
    env: process.env,
  });
  hub.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => hub.kill("SIGINT"));
  process.on("SIGTERM", () => hub.kill("SIGTERM"));
} else {
  // ── Development mode (cloned repo): tsx + TypeScript source, always fresh. ──
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
