#!/usr/bin/env node
/**
 * `bothread` — the global CLI.
 *
 * `start` (the default) runs the hub in one of two modes:
 *  • Production (npm install / npx):  dist-server/server.js already bundled → node it directly.
 *  • Development (cloned repo):       no bundle → tsx + TypeScript source, auto-build UI.
 *
 * Every other command (status, rooms, new, connect, doctor, guard) is a thin client of
 * the running hub's REST API on 127.0.0.1, written for humans AND for AI agents:
 * `--json` prints pure JSON on stdout, and exit codes are stable
 * (0 ok · 1 error / bad usage · 2 no hub running).
 *
 * Zero dependencies beyond Node 20+ built-ins, on purpose: this file must run
 * before `npm install` has happened in a fresh clone.
 *
 * Install once from the repo with `npm install && npm link`, or globally with
 * `npm install -g bothread` (or `npx bothread start` for zero-install).
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS, detectAgents, removeAgent, resolveAgentId, setupAgent, snippetFor, tildify } from "./lib/agents.mjs";
import { CANCEL, createUi, splitKeys } from "./lib/prompts.mjs";
import { colorEnabled, listJoin, palette } from "./lib/term.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Which channel installed/invoked this run — purely for the anonymous usage
// counters (see packages/server/src/telemetry.ts). `_npx` is npm/npx's cache
// directory name on every OS, so a package resolved from inside it means this
// run came from `npx bothread`, cached or not.
function detectChannel() {
  if (existsSync(path.join(root, "packages", "server", "src", "index.ts"))) return "dev-clone";
  return root.includes(`${path.sep}_npx${path.sep}`) || root.includes("/_npx/") ? "npx" : "global";
}
function pkgVersion() {
  try {
    return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version ?? "";
  } catch {
    return "";
  }
}
const isWin = process.platform === "win32";

// A real `npm install`/`npx` consumer only gets what package.json's `files` ships —
// bin/, dist-server/, apps/room-ui/dist, LICENSE, README. It never has
// packages/server/src. A git clone always does. So this path is the one reliable
// signal for "dev clone" — and in dev-clone mode we NEVER trust a possibly-stale
// dist-server/server.js bundle (e.g. left over from a one-off `npm run build:server`
// during testing): we always run live from TypeScript source via tsx instead, so
// `git pull && bothread start` is a complete, correct update — no separate build step.
const isDevClone = existsSync(path.join(root, "packages", "server", "src", "index.ts"));
const prodBundle = path.join(root, "dist-server", "server.js");
const uiIndex = path.join(root, "apps", "room-ui", "dist", "index.html");

const DEFAULT_PORT = 4889;
const SKILL_INSTALL = "npx skills add AdamACE9/bothread -y";
const TOKEN_PLACEHOLDER = "<BOTHREAD_TOKEN>";

/* ─────────────────────────────── colors ─────────────────────────────── */

// Color only on a real terminal, never when NO_COLOR is set; FORCE_COLOR wins
// over both (see lib/term.mjs). `--json` output never goes through these
// helpers, so it is always plain.
const c = palette(colorEnabled(process.stdout));
const ce = palette(colorEnabled(process.stderr));

/* ─────────────────────────────── banner ─────────────────────────────── */

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

/* ─────────────────────────── commands & flags ─────────────────────────── */

/** A failure the user (or agent) should see as one clean line + an exit code. */
class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

const FLAGS = {
  port: { value: true, usage: "--port <n>", desc: `Hub port (env BOTHREAD_PORT, default ${DEFAULT_PORT})` },
  host: { value: true, usage: "--host <h>", desc: "Bind address (env BOTHREAD_HOST, default 127.0.0.1)" },
  db: { value: true, usage: "--db <path>", desc: "SQLite file, or :memory: (env BOTHREAD_DB)" },
  auth: { value: false, usage: "--auth", desc: "Require an agent bearer token (env BOTHREAD_AUTH=on)" },
  "no-open": { value: false, usage: "--no-open", desc: "Don't open the browser (env BOTHREAD_NO_OPEN=1)" },
  project: { value: true, usage: "--project <path>", desc: "Room's project folder (enables per-agent git diffs)" },
  json: { value: false, usage: "--json", desc: "Pure JSON on stdout: no banner, no colors" },
  path: { value: true, usage: "--path <repo>", desc: "Git repo to act on (default: current folder)" },
  agent: { value: true, usage: "--agent <name>", desc: "Check as this room display name (env BOTHREAD_AGENT)" },
  force: { value: false, usage: "--force", desc: "Chain an existing pre-commit hook instead of refusing" },
  "no-setup": { value: false, usage: "--no-setup", desc: "Skip the first-run \"connect your agents?\" question (env BOTHREAD_NO_SETUP=1)" },
  yes: { value: false, usage: "-y, --yes", desc: "Don't ask: connect every agent found that isn't connected yet" },
  only: { value: true, usage: "--only <ids>", desc: "Only these agents, comma-separated (e.g. claude,cursor)" },
  "dry-run": { value: false, usage: "--dry-run", desc: "Show what would change; write nothing" },
  remove: { value: false, usage: "--remove", desc: "Take Bothread back out of agent configs (backups kept)" },
  skill: { value: false, usage: "--skill", desc: "Also install the room-etiquette skill (npx skills add …)" },
  "no-skill": { value: false, usage: "--no-skill", desc: "Don't offer to install the skill" },
  help: { value: false, usage: "-h, --help", desc: "Show help" },
  version: { value: false, usage: "-v, --version", desc: "Print the installed version" },
};
const SHORT_FLAGS = { h: "help", v: "version", y: "yes" };

const COMMANDS = {
  start: {
    args: "",
    summary: "Start the hub and open the room (the default)",
    flags: ["port", "host", "db", "auth", "no-open", "no-setup"],
    details:
      "Runs the hub on 127.0.0.1 and opens the room UI. If a Bothread hub is\n" +
      "already running on the port, it just opens that one and exits 0.\n" +
      "Flags win over the matching BOTHREAD_* env vars.\n" +
      "\n" +
      "The first time, if AI agents are installed but none is connected yet, it\n" +
      "asks once whether to connect them (skip with --no-setup).\n" +
      "\n" +
      "Keys while it runs (in a terminal):\n" +
      "  o  open the room in your browser     c  copy the MCP URL\n" +
      "  s  set up agents (bothread setup)    h  show the keys\n" +
      "  q  stop (also Ctrl-C / Ctrl-D)",
    examples: ["bothread start", "bothread start --port 4890 --no-open", "bothread start --db :memory:", "bothread start --auth"],
  },
  setup: {
    args: "[agents...]",
    summary: "Find your AI agents and connect them all (with backups)",
    flags: ["yes", "only", "dry-run", "remove", "skill", "no-skill", "port", "auth", "json"],
    details:
      "Looks for Claude Code, Claude (desktop), Cursor, Codex, Gemini CLI,\n" +
      "Antigravity, OpenCode, Windsurf, VS Code and Zed on this computer and adds\n" +
      "Bothread's MCP server to each one you pick. Only the \"bothread\" entry is\n" +
      "touched; an existing config is copied to <file>.bothread-backup-<time> first,\n" +
      "and running it again changes nothing. Files with comments (JSONC) are never\n" +
      "rewritten — you get the exact snippet to paste instead.\n" +
      "\n" +
      "In a terminal it asks (↑/↓, space, a = all, enter). Piped, with --yes or\n" +
      "--json it connects every agent found that isn't connected yet, no questions.\n" +
      "The skill install is offered interactively; unattended runs only do it with --skill.\n" +
      "Uses the running hub's MCP URL and token when one is up, else the port's.\n" +
      "Exits 1 if writing a config failed (manual steps alone don't fail it).",
    examples: [
      "bothread setup",
      "bothread setup --yes",
      "bothread setup --only claude,cursor",
      "bothread setup --dry-run",
      "bothread setup --remove",
      "bothread setup --yes --json",
    ],
  },
  status: {
    args: "",
    summary: "Is the hub up? Version, MCP URL, sessions, rooms",
    flags: ["port", "json"],
    details: "Exits 2 when no hub is running on the port (with --json it still prints\n{ \"running\": false, ... }).",
    examples: ["bothread status", "bothread status --json", "bothread status --port 4890"],
  },
  rooms: {
    args: "",
    summary: "List rooms with agents, activity, approvals",
    flags: ["port", "json"],
    details: "Exits 2 when no hub is running on the port.",
    examples: ["bothread rooms", "bothread rooms --json"],
  },
  new: {
    args: "<name>",
    summary: "Create a room; print its session ID + join line",
    flags: ["project", "port", "json"],
    details:
      "Creates a room on the running hub. Give each agent the printed join line\n" +
      "(\"This is a Bothread session: <id>\"). --project points the room at a\n" +
      "folder (relative paths resolve from here) so agents' changes become\n" +
      "reviewable git diffs. With --json: { roomId, name, sessionId, url, mcpUrl }.",
    examples: ['bothread new "auth refactor" --project .', "bothread new demo --json"],
  },
  connect: {
    args: "[agent]",
    summary: "Print MCP setup for claude, cursor, codex, …",
    flags: ["port", "auth", "json"],
    details:
      "Prints the exact config for one agent, the skill install command and the\n" +
      "join step. Works without a running hub (uses the port's URL). With no\n" +
      "agent it lists the choices.",
    examples: ["bothread connect", "bothread connect claude", "bothread connect cursor --json"],
  },
  doctor: {
    args: "",
    summary: "Check Node, SQLite, data dir, port, UI build, agents, guard",
    flags: ["port", "db", "json"],
    details: "Prints ✓ / ! / ✗ per check (· for info) and a verdict. Exits 1 if anything would stop\n'bothread start' from working.",
    examples: ["bothread doctor", "bothread doctor --json"],
  },
  guard: {
    args: "<action>",
    summary: "Pre-commit hook: block commits of files another agent holds",
    flags: ["path", "agent", "force", "port", "json"],
    details:
      "Actions:\n" +
      "  install [--path <repo>] [--force]   write the pre-commit hook (honors core.hooksPath)\n" +
      "  uninstall [--path <repo>]           remove it (restores a chained hook)\n" +
      "  status [--path <repo>] [--json]     installed? hook path, hub reachable?\n" +
      "  check [--agent <name>] [--json] [files...]   run the check now (default: staged files)\n" +
      "\n" +
      "The hook asks the hub whether a staged file is claimed EXCLUSIVELY (claim_files)\n" +
      "by someone else in a room pointed at this repo, and blocks the commit if so.\n" +
      "Agents commit with BOTHREAD_AGENT=\"<room display name>\" so their own claims pass.\n" +
      "It fails open: no hub running (or any error) means the commit goes through.\n" +
      "Bypass once: BOTHREAD_GUARD=off git commit ...  (or git commit --no-verify).\n" +
      "\n" +
      "An existing pre-commit hook that isn't Bothread's is never overwritten: install\n" +
      "refuses, and --force chains it instead (moved to pre-commit.bothread-prev and\n" +
      "run first; if it fails, the commit fails). uninstall puts it back.\n" +
      "check exits 1 when a file is blocked, 2 when no hub is running.",
    examples: [
      "bothread guard install",
      "bothread guard install --path ../api --force",
      "bothread guard status --json",
      'bothread guard check --agent "Claude Code" --json',
      "bothread guard uninstall",
    ],
  },
  help: {
    args: "[command]",
    summary: "Show help for bothread or one command",
    flags: [],
    examples: ["bothread help", "bothread help new"],
  },
  version: {
    args: "",
    summary: "Print the installed version",
    flags: ["json"],
    examples: ["bothread --version", "bothread version --json"],
  },
};

/** Classic edit distance — small inputs only (command / flag / agent names). */
function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}
/** The closest candidate, or null when nothing is plausibly what was meant. */
function closest(input, candidates) {
  const needle = input.toLowerCase();
  let best = null;
  let bestD = Infinity;
  for (const cand of candidates) {
    const d = cand.startsWith(needle) && needle.length >= 2 ? 0.5 : levenshtein(needle, cand);
    if (d < bestD) {
      best = cand;
      bestD = d;
    }
  }
  return best !== null && bestD <= Math.max(2, Math.floor(needle.length / 3)) ? best : null;
}

/** Parse flags for one command. Supports `--port 4890`, `--port=4890`, `--`, `-h`/`-v`. */
function parseArgs(argv, allowed) {
  const flags = {};
  const positionals = [];
  const ok = new Set([...allowed, "help"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (/^-[a-zA-Z]$/.test(arg) && SHORT_FLAGS[arg[1]]) {
      const name = SHORT_FLAGS[arg[1]];
      if (!ok.has(name) && name !== "version") throw new CliError(`Unknown flag '${arg}'. Run 'bothread help' for the flag list.`);
      flags[name] = true;
      continue;
    }
    if (!arg.startsWith("--") || arg === "-") {
      if (arg.startsWith("-") && arg !== "-") throw new CliError(`Unknown flag '${arg}'. Run 'bothread help' for the flag list.`);
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = (eq === -1 ? arg.slice(2) : arg.slice(2, eq)).toLowerCase();
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const spec = FLAGS[name];
    if (!spec || !ok.has(name)) {
      const guess = closest(name, [...ok]);
      const where = allowed.length ? "" : " (this command takes no flags)";
      throw new CliError(`Unknown flag '--${name}'${where}.` + (guess ? ` Did you mean '--${guess}'?` : ""));
    }
    if (spec.value) {
      const v = inline ?? argv[i + 1];
      if (v === undefined || (inline === undefined && v.startsWith("--"))) throw new CliError(`Flag --${name} needs a value: ${spec.usage}`);
      if (inline === undefined) i++;
      flags[name] = v;
    } else {
      if (inline !== undefined) throw new CliError(`Flag --${name} doesn't take a value.`);
      flags[name] = true;
    }
  }
  return { flags, positionals };
}

function resolvePort(flags) {
  const raw = flags.port ?? process.env.BOTHREAD_PORT ?? String(DEFAULT_PORT);
  const n = Number(raw);
  if (!/^\d+$/.test(String(raw).trim()) || !Number.isInteger(n) || n < 1 || n > 65535) {
    const src = flags.port !== undefined ? "--port" : "BOTHREAD_PORT";
    throw new CliError(`Invalid ${src} '${raw}': expected a number from 1 to 65535.`);
  }
  return n;
}
/** The hub runs with cwd = the package root, so a relative DB path must be made absolute here. */
const resolveDb = (p) => (p === ":memory:" ? p : path.resolve(p));

const hubUrl = (port) => `http://127.0.0.1:${port}`;
const mcpUrlFor = (port) => `${hubUrl(port)}/mcp`;
const roomUrlFor = (port, id) => `${hubUrl(port)}/#/room/${encodeURIComponent(id)}`;

/** Same data dir as packages/server/src/config.ts dataDir(). */
function dataDir() {
  if (process.env.BOTHREAD_HOME) return process.env.BOTHREAD_HOME;
  const base = isWin ? process.env.APPDATA ?? os.homedir() : path.join(os.homedir(), ".local", "share");
  return path.join(base, "bothread");
}

/** Same behaviour as packages/server/src/index.ts openBrowser(). */
function openBrowser(url, force = false) {
  if (process.env.BOTHREAD_NO_OPEN && !force) return;
  try {
    const child = isWin
      ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" })
      : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* opening the browser is best-effort */
  }
}

/* ─────────────────────────── talking to the hub ─────────────────────────── */

/** Minimal JSON-over-HTTP to the local hub. node:http (not fetch) so no proxy env var can intercept it. */
function hubRequest(port, method, urlPath, body, timeoutMs = 3000, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method,
        agent: false,
        headers: {
          accept: "application/json",
          ...(data ? { "content-type": "application/json", "content-length": data.length } : {}),
          ...extraHeaders,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          clearTimeout(timer);
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode ?? 0, json, text });
        });
      }
    );
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })), timeoutMs);
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Is a Bothread hub answering on this port?
 * → { state: "bothread", health } | { state: "other" } | { state: "down" }
 */
async function probeHub(port, timeoutMs = 1000) {
  try {
    const r = await hubRequest(port, "GET", "/api/health", undefined, timeoutMs);
    if (r.json && r.json.app === "bothread") return { state: "bothread", health: r.json };
    // Hubs from before 0.2.6 answered just { ok: true, sessions } — still Bothread.
    if (r.status === 200 && r.json?.ok === true && typeof r.json.sessions === "number" && Object.keys(r.json).length === 2)
      return { state: "bothread", health: { ...r.json, app: "bothread", version: null } };
    return { state: "other" };
  } catch (err) {
    return { state: err && err.code === "ECONNREFUSED" ? "down" : "other" };
  }
}

async function requireHub(port) {
  const probe = await probeHub(port);
  if (probe.state === "bothread") return probe.health;
  if (probe.state === "other") {
    throw new CliError(
      `No Bothread hub is running on port ${port} — something else is answering there.\n` +
        `Point at yours with --port <n>, or start one with: bothread start --port <free port>`,
      2
    );
  }
  throw new CliError(`No Bothread hub is running on port ${port} — start one with: bothread start`, 2);
}

async function apiGet(port, urlPath) {
  const r = await hubRequest(port, "GET", urlPath).catch((err) => {
    throw new CliError(`Lost contact with the hub on port ${port}: ${err.message}`, 2);
  });
  if (r.status >= 400) throw new CliError(`The hub refused ${urlPath}: ${r.json?.error ?? `HTTP ${r.status}`}`);
  return r.json ?? {};
}

/** Flatten the hub's room summaries into one stable shape for both JSON and tables. */
async function fetchRooms(port) {
  const data = await apiGet(port, "/api/rooms?summary=1");
  const summaries = Array.isArray(data.summaries)
    ? data.summaries
    : (data.rooms ?? []).map((room) => ({ room, agents: [], messageCount: null, lastActivityAt: room.createdAt, pendingApprovals: 0, activeClaims: 0 }));
  return summaries.map((s) => ({
    id: s.room.id,
    name: s.room.name,
    status: s.room.status,
    projectPath: s.room.projectPath ?? null,
    createdAt: s.room.createdAt ?? null,
    lastActivityAt: s.lastActivityAt ?? s.room.createdAt ?? null,
    url: roomUrlFor(port, s.room.id),
    agents: (s.agents ?? []).map((a) => ({ name: a.name, brand: a.brand ?? null })),
    messageCount: s.messageCount ?? null,
    pendingApprovals: s.pendingApprovals ?? 0,
    activeClaims: s.activeClaims ?? 0,
  }));
}

/* ─────────────────────────────── output ─────────────────────────────── */

const printJson = (value) => process.stdout.write(JSON.stringify(value, null, 2) + "\n");
/** "v0.2.6", or a note for pre-0.2.6 hubs that don't report a version. */
const ver = (health) => (health?.version ? `v${health.version}` : "older version");
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function relTime(ms) {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * An aligned table. Cells are plain strings (so widths are exact); `style`
 * colors a padded cell afterwards — ANSI codes never affect alignment.
 */
function renderTable(headers, rows, { right = [], style } = {}) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const pad = (s, i) => (right.includes(i) ? s.padStart(widths[i]) : s.padEnd(widths[i]));
  const lines = [c.dim("  " + headers.map((h, i) => pad(h, i)).join("  ").trimEnd())];
  rows.forEach((row, r) => {
    const cells = row.map((cell, i) => {
      const padded = i === row.length - 1 && !right.includes(i) ? cell : pad(cell, i);
      return style ? style(r, i, padded) : padded;
    });
    lines.push("  " + cells.join("  "));
  });
  return lines.join("\n");
}

function roomsTable(rooms) {
  const rows = rooms.map((r) => [
    trunc(r.name, 28),
    r.status,
    r.agents.length ? trunc(r.agents.map((a) => a.name).join(", "), 32) : "—",
    r.messageCount === null ? "—" : String(r.messageCount),
    String(r.activeClaims),
    String(r.pendingApprovals),
    relTime(r.lastActivityAt),
    r.id,
  ]);
  return renderTable(["NAME", "STATUS", "AGENTS", "MSGS", "CLAIMS", "APPROVALS", "ACTIVE", "ID"], rows, {
    right: [3, 4, 5],
    style: (r, i, s) => {
      const room = rooms[r];
      if (i === 5 && room.pendingApprovals > 0) return c.bold(c.yellow(s));
      if (room.status === "closed") return c.dim(s);
      if (i === 0) return c.bold(s);
      if (i === 1) return room.status === "active" ? c.green(s) : c.yellow(s);
      if (i === 7) return c.dim(s);
      return s;
    },
  });
}

function approvalsFooter(rooms) {
  const waiting = rooms.filter((r) => r.pendingApprovals > 0);
  if (!waiting.length) return "";
  const lines = waiting.map((r) => `    ${c.yellow("!")} ${r.name}: ${r.pendingApprovals} waiting → ${c.cyan(r.url)}`);
  return `\n  ${c.bold(c.yellow(`${waiting.length} room${waiting.length === 1 ? " needs" : "s need"} your approval:`))}\n${lines.join("\n")}\n`;
}

/* ─────────────────────────────── commands ─────────────────────────────── */

async function cmdVersion({ flags }) {
  if (flags.json) printJson({ version: pkgVersion() });
  else console.log(`bothread ${pkgVersion()}`);
  return 0;
}

async function cmdStatus({ flags }) {
  const port = resolvePort(flags);
  let health;
  try {
    health = await requireHub(port);
  } catch (err) {
    if (flags.json && err instanceof CliError) printJson({ running: false, port, url: hubUrl(port), mcpUrl: mcpUrlFor(port), error: err.message.split("\n")[0] });
    throw err;
  }
  const rooms = await fetchRooms(port);
  if (flags.json) {
    printJson({
      running: true,
      version: health.version ?? null,
      port,
      url: hubUrl(port),
      mcpUrl: mcpUrlFor(port),
      authRequired: !!health.authRequired,
      sessions: health.sessions ?? 0,
      rooms,
    });
    return 0;
  }
  const sessions = health.sessions ?? 0;
  const kv = (k, v) => `    ${c.dim(k.padEnd(10))}${v}`;
  console.log("");
  console.log(`  ${c.green("●")} ${c.bold(`Bothread ${ver(health)}`)} is running on port ${port}`);
  console.log(kv("Room UI", c.cyan(hubUrl(port))));
  console.log(kv("MCP URL", c.cyan(mcpUrlFor(port))));
  console.log(kv("Sessions", `${sessions} MCP session${sessions === 1 ? "" : "s"} connected`));
  console.log(kv("Auth", health.authRequired ? "on — agents need the bearer token" : "off (open on 127.0.0.1)"));
  console.log("");
  if (!rooms.length) {
    console.log(`  No rooms yet. Create one:  ${c.bold('bothread new "my room" --project .')}\n`);
    return 0;
  }
  console.log(`  ${c.bold(`ROOMS (${rooms.length})`)}`);
  console.log(roomsTable(rooms));
  console.log(approvalsFooter(rooms) || "");
  return 0;
}

async function cmdRooms({ flags }) {
  const port = resolvePort(flags);
  await requireHub(port);
  const rooms = await fetchRooms(port);
  if (flags.json) {
    printJson({ port, rooms });
    return 0;
  }
  if (!rooms.length) {
    console.log(`\n  No rooms yet. Create one:  ${c.bold('bothread new "my room" --project .')}\n`);
    return 0;
  }
  console.log("");
  console.log(roomsTable(rooms));
  console.log(approvalsFooter(rooms) || "");
  console.log(`  ${c.dim(`Open one: ${hubUrl(port)}/#/room/<ID>`)}\n`);
  return 0;
}

async function cmdNew({ flags, positionals }) {
  const name = positionals.join(" ").trim();
  if (!name) throw new CliError(`A room name is required.\nUsage: bothread new <name> [--project <path>] [--json]`);
  const port = resolvePort(flags);
  let projectPath;
  if (flags.project !== undefined) {
    projectPath = path.resolve(flags.project);
    if (!existsSync(projectPath)) throw new CliError(`--project folder not found: ${projectPath}`);
  }
  await requireHub(port);
  const r = await hubRequest(port, "POST", "/api/rooms", { name, ...(projectPath ? { projectPath } : {}) }).catch((err) => {
    throw new CliError(`Lost contact with the hub on port ${port}: ${err.message}`, 2);
  });
  if (r.status >= 400 || !r.json?.room) throw new CliError(`Couldn't create the room: ${r.json?.error ?? `HTTP ${r.status}`}`);
  const { room, sessionId } = r.json;
  const url = roomUrlFor(port, room.id);
  if (flags.json) {
    printJson({ roomId: room.id, name: room.name, sessionId, url, mcpUrl: mcpUrlFor(port), projectPath: room.projectPath ?? projectPath ?? null });
    return 0;
  }
  const kv = (k, v) => `    ${c.dim(k.padEnd(10))}${v}`;
  console.log("");
  console.log(`  ${c.green("✓")} Created room ${c.bold(`"${room.name}"`)}`);
  console.log(kv("Room", c.cyan(url)));
  console.log(kv("Session", c.bold(sessionId)));
  if (room.projectPath ?? projectPath) console.log(kv("Project", room.projectPath ?? projectPath));
  console.log(kv("MCP URL", mcpUrlFor(port)));
  console.log("");
  console.log(`  Paste this into each agent ${c.dim("(first time? add the MCP server: bothread connect <agent>)")}:`);
  console.log("");
  console.log(`    This is a Bothread session: ${sessionId}`);
  console.log("");
  return 0;
}

/* connect — the agent list + snippets live in lib/agents.mjs (shared with the hub). */

const snippet = (agent, url, token) => snippetFor(agent, { mcpUrl: url, token });

/**
 * Does this hub need a token, and what is it? A running hub is asked directly
 * (/api/connect-info answers loopback callers — it's what the room UI's Connect
 * panel uses). Otherwise: --auth / BOTHREAD_AUTH, then BOTHREAD_TOKEN or the
 * token the hub persisted in its data dir, else a placeholder.
 */
async function resolveConnectAuth(port, flags) {
  const probe = await probeHub(port, 800);
  if (probe.state === "bothread") {
    const authRequired = !!probe.health.authRequired;
    let token = null;
    if (authRequired) {
      try {
        const r = await hubRequest(port, "GET", "/api/connect-info", undefined, 1500);
        token = typeof r.json?.token === "string" && r.json.token ? r.json.token : null;
      } catch {
        /* fall back to the placeholder */
      }
    }
    return { hub: probe.health, authRequired, token };
  }
  const authRequired = !!flags.auth || process.env.BOTHREAD_AUTH === "on";
  let token = null;
  if (authRequired) {
    token = process.env.BOTHREAD_TOKEN || null;
    if (!token) {
      try {
        token = readFileSync(path.join(dataDir(), "install-token"), "utf8").trim() || null;
      } catch {
        /* none persisted yet */
      }
    }
  }
  return { hub: null, authRequired, token };
}

async function cmdConnect({ flags, positionals }) {
  const port = resolvePort(flags);
  const url = mcpUrlFor(port);
  if (positionals.length > 1) throw new CliError(`Pass one agent at a time, e.g.: bothread connect ${positionals[0]}`);
  let agentId = positionals[0] ? resolveAgentOrThrow(positionals[0]) : undefined;
  const { hub, authRequired, token: realToken } = await resolveConnectAuth(port, flags);
  const token = authRequired ? realToken ?? TOKEN_PLACEHOLDER : null;
  const placeholder = authRequired && !realToken;
  const hubLine = hub
    ? c.green(`hub running · ${ver(hub)}`)
    : c.yellow("hub not running — start it with: bothread start");

  if (!agentId) {
    if (flags.json) {
      printJson({
        mcpUrl: url,
        hubRunning: !!hub,
        authRequired,
        agents: AGENTS.map((a) => ({ agent: a.id, label: a.label, where: a.where, config: snippet(a.id, url, token) })),
        skillInstall: SKILL_INSTALL,
      });
      return 0;
    }
    console.log("");
    console.log(`  ${c.bold("Connect an agent to Bothread")}`);
    console.log(`    ${c.dim("MCP URL".padEnd(10))}${c.cyan(url)}  ${c.dim("(")}${hubLine}${c.dim(")")}`);
    console.log("");
    console.log("  Pick your agent:");
    for (const a of AGENTS) console.log(`    ${c.bold(a.id.padEnd(16))}${a.label}`);
    console.log("");
    console.log(`  Then run:  ${c.bold("bothread connect <agent>")}   ${c.dim("e.g. bothread connect claude")}`);
    console.log(`  Or let Bothread find and configure them all:  ${c.bold("bothread setup")}`);
    console.log(`  Every agent also wants the room-etiquette skill:  ${c.bold(SKILL_INSTALL)}`);
    console.log("");
    return 0;
  }

  const meta = AGENTS.find((a) => a.id === agentId);
  const config = snippet(agentId, url, token);
  if (flags.json) {
    printJson({
      agent: agentId,
      label: meta.label,
      mcpUrl: url,
      config,
      where: meta.where,
      skillInstall: SKILL_INSTALL,
      joinPrompt: "This is a Bothread session: <session ID>",
      hubRunning: !!hub,
      authRequired,
      tokenPlaceholder: placeholder ? TOKEN_PLACEHOLDER : null,
    });
    return 0;
  }
  const indent = (s, n) => s.split("\n").map((l) => " ".repeat(n) + l).join("\n");
  console.log("");
  console.log(`  ${c.bold(`Connect ${meta.label}`)}`);
  console.log(`    ${c.dim("MCP URL".padEnd(10))}${c.cyan(url)}  ${c.dim("(")}${hubLine}${c.dim(")")}`);
  console.log("");
  console.log(`  ${c.accent("1")}  ${meta.where}`);
  console.log("");
  console.log(indent(config, 7));
  console.log("");
  if (agentId !== "other") {
    console.log(`     ${c.dim("Or let Bothread add it for you (with a backup):")} ${c.bold(`bothread setup --only ${agentId}`)}`);
    console.log("");
  }
  if (placeholder) {
    console.log(`     ${c.yellow("!")} Auth is on: replace ${c.bold(TOKEN_PLACEHOLDER)} with the token from the room UI's`);
    console.log(`       "Connect an agent" panel or the hub's startup output.`);
    console.log("");
  }
  console.log(`  ${c.accent("2")}  Install the room-etiquette skill:`);
  console.log("");
  console.log(`       ${SKILL_INSTALL}`);
  console.log("");
  console.log(`  ${c.accent("3")}  Reload ${meta.label} so the "bothread" tools load, then paste the join line:`);
  console.log("");
  console.log(`       This is a Bothread session: <session ID>`);
  console.log("");
  console.log(`     ${c.dim('No room yet? bothread new "my room" --project .  prints a session ID.')}`);
  console.log("");
  return 0;
}

/* setup — detect every AI coding agent on this machine and point it at the hub */

const AGENT_IDS = () => AGENTS.map((a) => a.id);

/** A known agent id for user input, or a CliError with a "did you mean". */
function resolveAgentOrThrow(input, { allowOther = true } = {}) {
  const id = resolveAgentId(input);
  if (id && (allowOther || id !== "other")) return id;
  const ids = AGENT_IDS().filter((a) => allowOther || a !== "other");
  const guess = closest(String(input).toLowerCase(), ids);
  throw new CliError(`Unknown agent '${input}'.` + (guess ? ` Did you mean '${guess}'?` : "") + `\nAgents: ${ids.join(", ")}`);
}

/** How to run another bothread command the way this one was installed. */
function selfCmd(sub) {
  const channel = detectChannel();
  if (channel === "dev-clone") return `node bin/bothread.mjs ${sub}`;
  if (channel === "global") return `bothread ${sub}`;
  return `npx bothread ${sub}`;
}

/**
 * Auth on but no hub running and no token yet: mint the hub's install token now
 * (the same file the hub reads at boot), so the configs written here keep working.
 */
function ensureInstallToken() {
  if (process.env.BOTHREAD_TOKEN) return process.env.BOTHREAD_TOKEN;
  const file = path.join(dataDir(), "install-token");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    /* none yet */
  }
  const token = randomBytes(18).toString("base64url");
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(file, token, { encoding: "utf8", mode: 0o600 });
  return token;
}

/** The MCP URL + token agents should use: the running hub's own, else the port's. */
async function setupContext(port, flags) {
  const probe = await probeHub(port, 800);
  if (probe.state === "bothread") {
    let info = null;
    try {
      const r = await hubRequest(port, "GET", "/api/connect-info", undefined, 1500);
      info = r.json;
    } catch {
      /* fall back to the port's URL */
    }
    const authRequired = !!(info?.authRequired ?? probe.health.authRequired);
    let mcpUrl = typeof info?.mcpUrl === "string" ? info.mcpUrl : mcpUrlFor(port);
    mcpUrl = mcpUrl.replace("://0.0.0.0:", "://127.0.0.1:").replace("://[::]:", "://127.0.0.1:");
    const token = authRequired ? (typeof info?.token === "string" && info.token ? info.token : null) : null;
    if (authRequired && !token) throw new CliError(`The hub on port ${port} requires a token but didn't share it — set BOTHREAD_TOKEN and try again.`);
    return { hubRunning: true, health: probe.health, mcpUrl, token, authRequired };
  }
  const authRequired = !!flags.auth || process.env.BOTHREAD_AUTH === "on";
  return { hubRunning: false, health: null, mcpUrl: mcpUrlFor(port), token: authRequired ? ensureInstallToken() : null, authRequired };
}

/** `npx -y skills add AdamACE9/bothread -y`, captured, with a timeout. Never throws. */
function installSkill(timeoutMs = 180_000) {
  return new Promise((resolve) => {
    const args = ["-y", "skills", "add", "AdamACE9/bothread", "-y"];
    let out = "";
    let child;
    try {
      child = spawn(isWin ? "npx.cmd" : "npx", args, { stdio: ["ignore", "pipe", "pipe"], shell: isWin, windowsHide: true });
    } catch (err) {
      resolve({ ok: false, error: err.message });
      return;
    }
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, error: `timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const last = out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim().split("\n").filter(Boolean).pop() ?? "";
      resolve(code === 0 ? { ok: true } : { ok: false, error: last || `exit ${code}` });
    });
  });
}

function parseOnly(flags, positionals) {
  const raw = [...(flags.only ? String(flags.only).split(",") : []), ...positionals.flatMap((p) => p.split(","))].map((s) => s.trim()).filter(Boolean);
  if (!raw.length) return null;
  return [...new Set(raw.map((r) => resolveAgentOrThrow(r, { allowOther: false })))];
}

/**
 * The whole setup flow, shared by `bothread setup`, the `s` key in a running
 * `bothread start`, and start's first-run question.
 *   mode "setup" (default) | "remove";  `only` = agent ids or null;
 *   `nudge` = coming from start's first-run question (hub about to start).
 * Returns an exit code.
 */
async function setupFlow({ flags, only = null, nudge = false, inline = false }) {
  const json = !!flags.json;
  const dryRun = !!flags["dry-run"];
  const remove = !!flags.remove;
  const ui = createUi();
  const k = ui.c;
  const interactive = !json && !flags.yes && ui.interactive;
  const port = resolvePort(flags);

  if (!json) ui.intro(k.bold(remove ? "Remove Bothread from your AI agents" : nudge ? "Connecting your AI agents" : "Connect your AI agents to Bothread") + (dryRun ? k.dim("  (dry run — nothing is written)") : ""));

  const spin = json ? null : ui.spinner();
  spin?.start("Looking for AI coding agents");
  let ctx;
  let agents;
  try {
    ctx = await setupContext(port, flags);
    agents = detectAgents({ mcpUrl: ctx.mcpUrl, token: ctx.token });
  } catch (err) {
    spin?.stop("Couldn't look for agents", 1);
    throw err;
  }
  const found = agents.filter((a) => a.detected || a.hasEntry);
  const pool = remove
    ? agents.filter((a) => a.hasEntry && (!only || only.includes(a.id)))
    : only
      ? agents.filter((a) => only.includes(a.id))
      : found;
  const preselected = remove ? pool.map((a) => a.id) : pool.filter((a) => !a.configured && (a.canAutoSetup || only)).map((a) => a.id);

  if (!json) {
    spin.stop(found.length ? `Found ${found.length} AI coding agent${found.length === 1 ? "" : "s"} on this computer` : "No AI coding agents found on this computer", found.length ? 0 : 2);
    if (!nudge) {
      const w = Math.max(...agents.map((a) => a.label.length)) + 2;
      const rows = agents.map((a) => {
        if (a.configured) return `${k.green("✓")} ${a.label.padEnd(w)}${k.dim("already connected")}`;
        if (a.hasEntry) return `${k.yellow("●")} ${a.label.padEnd(w)}${k.dim(remove ? a.target : "set up for a different URL — will update")}`;
        if (a.detected && !a.canAutoSetup) return `${k.yellow("●")} ${a.label.padEnd(w)}${k.dim("found — needs a manual step")}`;
        if (a.detected) return `${k.cyan("●")} ${a.label.padEnd(w)}${k.dim(a.target ?? "")}`;
        return k.dim(`· ${a.label.padEnd(w)}not found`);
      });
      ui.detail(rows);
    }
  }

  const summary = { ok: true, dryRun, remove, mcpUrl: ctx.mcpUrl, hubRunning: ctx.hubRunning, authRequired: ctx.authRequired, agents, selected: [], results: [], skill: null, nextSteps: [] };
  const done = (code, msg) => {
    if (json) printJson({ ...summary, ok: code === 0 });
    else if (msg) ui.outro(msg);
    return code;
  };

  if (!pool.length) {
    if (remove) return done(0, "Bothread isn't in any agent's config — nothing to remove.");
    if (!json) {
      ui.step("Nothing to set up automatically", [
        `Install an AI coding agent (Claude Code, Cursor, Codex, …) and run ${k.bold(selfCmd("setup"))} again,`,
        `or connect any MCP client by hand: ${k.bold(selfCmd("connect"))}`,
      ], "warn");
    }
    return done(0, "See you soon.");
  }

  // Choose. Unattended runs also try agents that need a manual step, so the
  // output carries the exact snippet to paste.
  let selected = remove || only ? preselected : pool.filter((a) => !a.configured).map((a) => a.id);
  if (interactive) {
    const options = [...pool]
      .sort((a, b) => Number(a.configured) - Number(b.configured))
      .map((a) => ({
        value: a.id,
        label: a.label,
        hint: remove ? a.target : a.configured ? "already connected" : !a.canAutoSetup ? "manual step — Bothread shows you what to paste" : a.hasEntry ? `update ${a.target}` : a.target,
      }));
    if (!remove && !preselected.length && pool.every((a) => a.configured)) {
      ui.step(`${k.green("✓")} Everything found is already connected to Bothread`);
      selected = [];
    } else {
      const picked = await ui.multiselect({
        message: remove ? "Remove Bothread from which agents?" : "Which agents should Bothread connect?",
        options,
        initialValues: preselected,
      });
      if (picked === CANCEL) {
        ui.cancelled(remove ? "Removal cancelled" : "Setup cancelled");
        return 130;
      }
      selected = picked;
      if (!selected.length) return done(0, "Nothing selected — no changes made.");
      if (!dryRun) {
        const chosen = pool.filter((a) => selected.includes(a.id));
        const w = Math.max(...chosen.map((a) => a.label.length)) + 2;
        ui.note(remove ? "Here's what will be removed" : "Here's the plan", [
          ...chosen.map((a) => `${a.label.padEnd(w)}${k.dim("→")} ${a.target ?? ""}`),
          "",
          k.dim(remove ? "Only the bothread entry is removed; a backup is saved first." : "Only the bothread entry is added; existing files are backed up first."),
        ]);
        const go = await ui.confirm({ message: remove ? "Remove it now?" : "Apply these changes?" });
        if (go === CANCEL || go === false) {
          ui.cancelled(remove ? "Removal cancelled — nothing changed" : "Setup cancelled — nothing changed");
          return go === CANCEL ? 130 : 0;
        }
      }
    }
  } else if (!json && !selected.length && !remove) {
    ui.step(`${k.green("✓")} Everything found is already connected to Bothread`);
  }
  summary.selected = selected;

  // Apply.
  const opts = { mcpUrl: ctx.mcpUrl, token: ctx.token, dryRun };
  for (const id of selected) {
    const meta = agents.find((a) => a.id === id);
    spin?.start(`${remove ? "Removing Bothread from" : dryRun ? "Checking" : "Connecting"} ${meta.label}`);
    let r;
    try {
      r = remove ? await removeAgent(id, opts) : await setupAgent(id, opts);
    } catch (err) {
      r = { id, label: meta.label, ok: false, changed: false, action: "failed", backup: null, message: String(err?.message ?? err) };
    }
    summary.results.push(r);
    if (json) continue;
    const arrow = r.target ? ` ${k.dim("→")} ${r.target}` : "";
    if (!r.ok) {
      spin.stop(`${meta.label} ${k.dim("—")} ${r.message}`, r.action === "manual" ? 2 : 1);
      if (r.snippet) ui.detail(["", ...r.snippet.split("\n").map((l) => `  ${k.cyan(l)}`), ""]);
    } else if (!r.changed) {
      spin.stop(`${meta.label} ${k.dim(remove ? "— nothing to remove" : "— already connected")}`);
    } else if (dryRun) {
      spin.stop(`${meta.label} ${k.dim("— would change")}${arrow}`);
      ui.detail([k.dim(r.message), ...(r.snippet ? r.snippet.split("\n").map((l) => `  ${k.cyan(l)}`) : [])]);
    } else {
      spin.stop(`${k.green("✓")} ${meta.label} ${remove ? "disconnected" : "connected"}${arrow}`);
      if (r.backup) ui.detail([k.dim(`backup: ${tildify(r.backup)}`)]);
    }
  }
  const failed = summary.results.filter((r) => !r.ok && r.action !== "manual");
  const byHand = summary.results.filter((r) => !r.ok);
  const changed = summary.results.filter((r) => r.ok && r.changed);

  // The room-etiquette skill.
  if (!remove && !dryRun && !flags["no-skill"]) {
    let want = !!flags.skill;
    if (!want && !json && ui.interactive && (!flags.yes || nudge)) {
      const a = await ui.confirm({ message: `Also install the room-etiquette skill? ${k.dim("(recommended)")}` });
      if (a === CANCEL) {
        ui.cancelled("Skipped the rest of setup");
        return 130;
      }
      want = a;
    }
    if (want) {
      spin?.start(`Installing the skill ${k.dim(`(${SKILL_INSTALL})`)}`);
      const r = await installSkill();
      summary.skill = { installed: r.ok, command: SKILL_INSTALL, ...(r.ok ? {} : { error: r.error }) };
      if (!json) {
        if (r.ok) spin.stop(`${k.green("✓")} Room-etiquette skill installed`);
        else spin.stop(`Couldn't install the skill (${r.error}) — run it later: ${k.bold(SKILL_INSTALL)}`, 2);
      }
    } else summary.skill = { installed: false, skipped: true, command: SKILL_INSTALL };
  }

  // Next steps.
  const restartable = changed.map((r) => agents.find((a) => a.id === r.id)).filter(Boolean);
  const next = [];
  if (!dryRun && restartable.length)
    next.push({ text: `Restart ${listJoin(restartable.map((a) => a.label))}`, after: remove ? "(so the change takes effect)" : "(the bothread tools appear after a restart)" });
  if (!remove && !nudge) {
    if (!ctx.hubRunning && !inline) next.push({ text: "Start the hub:", cmd: selfCmd("start") });
    next.push({ text: "Open the room and create a room:", cmd: `${hubUrl(port)}/` });
    next.push({ text: "In each agent, say:", cmd: "This is a Bothread session: <id>", after: `(the ID is in the room — or use its "Connect an agent" panel)` });
  }
  summary.nextSteps = next.map((n) => [n.text, n.cmd].filter(Boolean).join(" "));

  if (json) return done(failed.length ? 1 : 0);
  if (next.length && !dryRun) {
    const lines = [];
    next.forEach((n, i) => {
      lines.push(`${k.accent(`${i + 1}.`)} ${n.text}`);
      if (n.cmd) lines.push(`     ${k.cyan(n.cmd)}`);
      if (n.after) lines.push(`   ${k.dim(n.after)}`);
      if (i < next.length - 1) lines.push("");
    });
    ui.note("Next steps", lines);
  }
  if (restartable.some((a) => a.id === "claude-desktop") && !dryRun) ui.detail([k.dim("Claude (desktop app): fully quit it (not just close the window), then reopen.")]);
  const end = dryRun
    ? "Dry run — nothing was written."
    : byHand.length
      ? k.yellow(`Done, with ${byHand.length} agent${byHand.length === 1 ? "" : "s"} to finish by hand (see above).`)
      : nudge
        ? "Starting Bothread…"
        : remove
          ? "Bothread removed."
          : "You're all set — happy building!";
  ui.outro(end);
  return failed.length && !nudge ? 1 : 0;
}

async function cmdSetup({ flags, positionals }) {
  const only = parseOnly(flags, positionals);
  if (flags.skill && flags["no-skill"]) throw new CliError("Pick one of --skill or --no-skill.");
  if (flags.json && !flags["dry-run"]) flags = { ...flags, yes: true };
  return setupFlow({ flags, only });
}

/** Best-effort copy to the system clipboard. */
function copyToClipboard(text) {
  const cands =
    process.platform === "darwin"
      ? [["pbcopy", []]]
      : isWin
        ? [["clip", []]]
        : [...(process.env.WAYLAND_DISPLAY ? [["wl-copy", []]] : []), ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];
  for (const [cmd, args] of cands) {
    const r = spawnSync(cmd, args, { input: text, stdio: ["pipe", "ignore", "ignore"], timeout: 2000 });
    if (!r.error && r.status === 0) return true;
  }
  return false;
}

/* doctor */

function sqliteFix() {
  const channel = detectChannel();
  const reinstall = channel === "dev-clone" ? "npm install" : channel === "npx" ? "npx bothread@latest start" : "npm install -g bothread@latest";
  if (process.platform === "darwin") return `Install Xcode's command-line tools so it can compile, then reinstall:  xcode-select --install  &&  ${reinstall}`;
  if (process.platform === "linux") return `Install build tools (Debian/Ubuntu shown), then reinstall:  sudo apt-get install -y build-essential python3  &&  ${reinstall}`;
  return `Reinstall (on a Node LTS version, which has a prebuilt binary):  ${reinstall}`;
}

function checkWritable(dir) {
  mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.bothread-doctor-${process.pid}`);
  writeFileSync(probe, "ok");
  unlinkSync(probe);
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", (err) => resolve({ free: false, code: err.code }));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve({ free: true })));
  });
}

async function cmdDoctor({ flags }) {
  const port = resolvePort(flags);
  const checks = [];
  const add = (status, name, message, fix) => checks.push({ name, status, message, ...(fix ? { fix } : {}) });

  // Node
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor >= 20) add("pass", "node", `Node.js ${process.versions.node}`);
  else add("fail", "node", `Node.js ${process.versions.node} is too old — Bothread needs 20 or newer`, "Install the latest LTS from https://nodejs.org");

  // Install layout
  const channel = detectChannel();
  if (isDevClone) {
    const tsx = existsSync(path.join(root, "node_modules", "tsx", "dist", "cli.mjs"));
    if (tsx) add("pass", "install", `Dev clone at ${root} (runs from TypeScript source)`);
    else add("warn", "install", "Dev clone, dependencies not installed yet", "'bothread start' runs npm install on first run, or run: npm install");
  } else if (existsSync(prodBundle)) {
    add("pass", "install", `bothread ${pkgVersion()} (${channel}) at ${root}`);
  } else {
    add("fail", "install", "The hub bundle (dist-server/server.js) is missing from this install", "Reinstall: npm install -g bothread@latest");
  }

  // SQLite (native module)
  try {
    const Database = createRequire(path.join(root, "package.json"))("better-sqlite3");
    const db = new Database(":memory:");
    const { v } = db.prepare("select sqlite_version() as v").get();
    db.close();
    add("pass", "sqlite", `better-sqlite3 loads (SQLite ${v})`);
  } catch (err) {
    add("fail", "sqlite", `better-sqlite3 can't load: ${String(err?.message ?? err).split("\n")[0]}`, sqliteFix());
  }

  // Data dir (and a custom DB's folder, if different)
  const dirs = [dataDir()];
  const dbRaw = flags.db ?? process.env.BOTHREAD_DB;
  if (dbRaw && dbRaw !== ":memory:") {
    const dbDir = path.dirname(resolveDb(dbRaw));
    if (dbDir !== dirs[0]) dirs.push(dbDir);
  }
  for (const dir of dirs) {
    const label = dir === dirs[0] ? "Data dir" : "Database folder";
    try {
      checkWritable(dir);
      add("pass", dir === dirs[0] ? "data-dir" : "db-dir", `${label} writable: ${dir}`);
    } catch (err) {
      add("fail", dir === dirs[0] ? "data-dir" : "db-dir", `${label} not writable: ${dir} (${err.code ?? err.message})`, "Fix its permissions, or point BOTHREAD_HOME / --db somewhere writable");
    }
  }
  if (dbRaw === ":memory:") add("pass", "db", "Database: in-memory (:memory:) — rooms vanish when the hub stops");

  // Port
  const portState = await portIsFree(port);
  if (portState.free) add("pass", "port", `Port ${port} is free`);
  else {
    const probe = await probeHub(port);
    if (probe.state === "bothread")
      add("pass", "port", `Port ${port}: Bothread ${ver(probe.health)} is already running (${probe.health.sessions ?? 0} MCP sessions)`);
    else if (portState.code === "EADDRINUSE")
      add("fail", "port", `Port ${port} is in use by another program`, `Start on a free port: bothread start --port ${port === 65535 ? port - 1 : port + 1}`);
    else add("fail", "port", `Can't listen on 127.0.0.1:${port} (${portState.code})`, "Pick another port with --port <n>");
  }

  // Host safety (only when someone set one)
  const host = process.env.BOTHREAD_HOST;
  if (host && !/^(localhost|::1|127\.\d+\.\d+\.\d+)$/i.test(host.replace(/^\[|\]$/g, "")) && process.env.BOTHREAD_AUTH !== "on" && !process.env.BOTHREAD_ALLOW_INSECURE_HOST)
    add("fail", "host", `BOTHREAD_HOST=${host} is off-loopback with auth off — start will refuse`, "Unset BOTHREAD_HOST, or set BOTHREAD_AUTH=on");

  // Room UI
  if (!isDevClone) {
    if (existsSync(uiIndex)) add("pass", "ui", "Room UI is built");
    else add("fail", "ui", "Room UI build (apps/room-ui/dist) is missing from this install", "Reinstall: npm install -g bothread@latest");
  } else if (!existsSync(uiIndex)) add("pass", "ui", "Room UI not built yet — 'bothread start' builds it automatically");
  else if (uiNeedsBuild()) add("pass", "ui", "Room UI source changed since last build — 'bothread start' rebuilds it");
  else add("pass", "ui", "Room UI is built and up to date");

  // Commit guard (informational — optional feature)
  const guardRepo = repoInfo(process.cwd());
  if (!guardRepo) add("info", "guard", "Commit guard: n/a (this folder isn't a git repo)");
  else if (isGuardHook(guardRepo.hookPath)) add("info", "guard", `Commit guard installed in ${guardRepo.toplevel}`);
  else add("info", "guard", `Commit guard not installed in ${guardRepo.toplevel} (optional: bothread guard install)`);

  // AI agents on this machine (informational: connecting them is `bothread setup`)
  try {
    const auth = await resolveConnectAuth(port, flags);
    const agents = detectAgents({ mcpUrl: mcpUrlFor(port), token: auth.authRequired ? auth.token : null });
    const found = agents.filter((a) => a.detected || a.hasEntry);
    if (!found.length) add("info", "agents", "No AI coding agents found on this computer", `Connect any MCP client by hand: bothread connect`);
    for (const a of found) {
      const name = `agent:${a.id}`;
      if (a.configured) add("pass", name, `${a.label}: connected (${a.target})`);
      else if (a.hasEntry) add("info", name, `${a.label}: set up for a different URL (${a.target})`, `Update it: bothread setup --only ${a.id}`);
      else if (!a.canAutoSetup) add("info", name, `${a.label}: found, not connected — ${a.note ?? "needs a manual step"}`);
      else add("info", name, `${a.label}: found, not connected`, `Connect it: bothread setup --only ${a.id}`);
    }
  } catch (err) {
    add("info", "agents", `Couldn't look for AI agents: ${err?.message ?? err}`);
  }

  // Telemetry (informational)
  if (process.env.BOTHREAD_NO_TELEMETRY) add("pass", "telemetry", "Telemetry off (BOTHREAD_NO_TELEMETRY is set)");
  else add("pass", "telemetry", "Telemetry on — anonymous usage counters only; opt out with BOTHREAD_NO_TELEMETRY=1");

  const fails = checks.filter((k) => k.status === "fail").length;
  const warns = checks.filter((k) => k.status === "warn").length;
  const running = checks.some((k) => k.name === "port" && k.message.includes("already running"));
  const next = running ? `Bothread is running: ${hubUrl(port)}` : "Start with: bothread start";
  const verdict = fails
    ? `${fails} problem${fails === 1 ? "" : "s"} found — fix the ✗ items above, then run 'bothread doctor' again.`
    : warns
      ? `Ready, with ${warns} warning${warns === 1 ? "" : "s"}. ${next}`
      : `All good. ${next}`;

  if (flags.json) {
    printJson({ ok: fails === 0, verdict, checks });
    return fails ? 1 : 0;
  }
  const mark = { pass: c.green("✓"), info: c.dim("·"), warn: c.yellow("!"), fail: c.red("✗") };
  console.log("");
  console.log(`  ${c.bold("bothread doctor")} ${c.dim(`v${pkgVersion()} · ${process.platform}-${process.arch}`)}`);
  console.log("");
  for (const k of checks) {
    console.log(`  ${mark[k.status]} ${k.message}`);
    if (k.fix) console.log(`      ${c.dim("→")} ${k.fix}`);
  }
  console.log("");
  const vmark = fails ? c.red("✗") : warns ? c.yellow("!") : c.green("✓");
  console.log(`  ${vmark} ${c.bold(verdict)}`);
  console.log("");
  return fails ? 1 : 0;
}

/* guard — the commit guard (a git pre-commit hook backed by POST /api/guard/check) */

const GUARD_MARKER = "bothread-guard";
const GUARD_PREV = "pre-commit.bothread-prev";
const GUARD_ACTIONS = ["install", "uninstall", "status", "check"];

/** Run git; never throws. */
function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { ok: !r.error && r.status === 0, out: (r.stdout ?? "").replace(/\r?\n$/, ""), err: (r.stderr ?? "").trim() || r.error?.message || "" };
}

/** The repo top-level + its (core.hooksPath / worktree-aware) hooks folder, or null outside a repo. */
function repoInfo(dir) {
  const top = git(dir, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.out) return null;
  const toplevel = path.resolve(top.out);
  const hooks = git(toplevel, ["rev-parse", "--git-path", "hooks"]);
  const hooksDir = path.resolve(toplevel, hooks.ok && hooks.out ? hooks.out : path.join(".git", "hooks"));
  const hookPath = path.join(hooksDir, "pre-commit");
  return { toplevel, hooksDir, hookPath, prevPath: path.join(hooksDir, GUARD_PREV) };
}

function requireRepo(flags) {
  const dir = path.resolve(flags.path ?? ".");
  if (!existsSync(dir)) throw new CliError(`--path folder not found: ${dir}`);
  const info = repoInfo(dir);
  if (!info) throw new CliError(`Not a git repository: ${dir}\nRun this inside a repo, or point at one with --path <repo>.`);
  return info;
}

const isGuardHook = (file) => {
  try {
    return /^(\/\/|#) ?bothread-guard\b/m.test(readFileSync(file, "utf8").split("\n").slice(0, 5).join("\n"));
  } catch {
    return false;
  }
};

/**
 * The hook body. Serialized with Function#toString into the pre-commit file, so it
 * must be fully self-contained: no references to anything else in this CLI. Dynamic
 * imports keep it valid whether Node loads the extensionless hook as CJS or ESM.
 */
async function guardHookMain() {
  const { spawnSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const http = await import("node:http");
  const isWin = process.platform === "win32";
  const tty = !!process.stderr.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
  const paint = (open, close) => (s) => (tty ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
  const dim = paint("2", "22");
  const bold = paint("1", "22");
  const red = paint("31", "39");
  const cyan = paint("36", "39");
  const say = (s) => process.stderr.write(s + "\n");

  // 1. A pre-existing hook we chained at install time runs first; its verdict stands.
  const self = path.resolve(process.argv[1] ?? "");
  const prev = path.join(path.dirname(self), "pre-commit.bothread-prev");
  if (fs.existsSync(prev)) {
    const args = process.argv.slice(2);
    const r = isWin ? spawnSync("sh", [prev, ...args], { stdio: "inherit" }) : spawnSync(prev, args, { stdio: "inherit" });
    if (r.error && r.error.code !== "EACCES") {
      say(red("✗") + ` bothread guard: couldn't run the chained pre-commit hook (${prev}): ${r.error.message}`);
      return 1;
    }
    if (!r.error && r.status !== 0) return r.status ?? 1;
  }

  // 2. The guard itself.
  if (String(process.env.BOTHREAD_GUARD ?? "").toLowerCase() === "off") return 0;
  const failOpen = (why) => {
    say(dim(`bothread guard: ${why} — commit not checked.`));
    return 0;
  };
  const gitOut = (args) => spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  const top = gitOut(["rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || !top.stdout.trim()) return failOpen("couldn't find the repo top-level");
  const staged = gitOut(["diff", "--cached", "--name-only", "--diff-filter=ACMRD", "-z"]);
  if (staged.status !== 0) return failOpen("couldn't list staged files");
  const files = staged.stdout.split("\0").filter(Boolean);
  if (!files.length) return 0;

  const rawPort = String(process.env.BOTHREAD_PORT ?? "").trim();
  const port = /^\d+$/.test(rawPort) && Number(rawPort) >= 1 && Number(rawPort) <= 65535 ? Number(rawPort) : 4889;
  const agent = (process.env.BOTHREAD_AGENT ?? "").trim() || undefined;
  const body = Buffer.from(JSON.stringify({ projectPath: top.stdout.trim(), files: files.slice(0, 5000), ...(agent ? { agent } : {}) }));
  const headers = { "content-type": "application/json", "content-length": body.length, accept: "application/json" };
  if (process.env.BOTHREAD_TOKEN) headers.authorization = `Bearer ${process.env.BOTHREAD_TOKEN}`;

  let res;
  try {
    res = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/api/guard/check", method: "POST", agent: false, headers },
        (r) => {
          const chunks = [];
          r.on("data", (d) => chunks.push(d));
          r.on("error", reject);
          r.on("end", () => {
            clearTimeout(timer);
            resolve({ status: r.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") });
          });
        }
      );
      const timer = setTimeout(() => req.destroy(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })), 1500);
      req.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      req.end(body);
    });
  } catch (err) {
    return failOpen(err && err.code === "ECONNREFUSED" ? `no Bothread hub on port ${port}` : `hub on port ${port} didn't answer (${(err && err.code) || err})`);
  }
  let result = null;
  try {
    result = JSON.parse(res.text);
  } catch {
    /* not JSON */
  }
  if (res.status === 401) return failOpen(`the hub on port ${port} wants its token (set BOTHREAD_TOKEN)`);
  if (res.status !== 200 || !result || !Array.isArray(result.blocked)) return failOpen(`hub on port ${port} answered HTTP ${res.status}`);
  if (!result.blocked.length) return 0;

  const n = result.blocked.length;
  const width = Math.min(48, Math.max(...result.blocked.map((b) => b.file.length)));
  say("");
  say(`${red("✗")} ${bold(`Commit blocked by Bothread: ${n} staged file${n === 1 ? " is" : "s are"} claimed by another agent`)}`);
  say("");
  for (const b of result.blocked) say(`    ${bold(b.file.padEnd(width))}  held by ${cyan(b.heldByName)}  ${dim(`(room "${b.roomName}")`)}`);
  say("");
  say("  How to proceed:");
  say(`    • Ask the holder in the room (agents: ${bold("request_handoff({ path })")}), or wait until they release it.`);
  if (!agent) say(`    • Committing as an agent? Set your room display name: ${bold('BOTHREAD_AGENT="<your name>" git commit ...')}`);
  say(`    • Sure it's safe? Bypass once: ${bold("BOTHREAD_GUARD=off git commit ...")}  ${dim("or")}  ${bold("git commit --no-verify")}`);
  say("");
  return 1;
}

function guardHookSource() {
  return (
    "#!/usr/bin/env node\n" +
    `// ${GUARD_MARKER} — pre-commit hook written by \`bothread guard install\` (bothread ${pkgVersion()}).\n` +
    "// Blocks a commit that touches files another agent holds EXCLUSIVELY in a Bothread room.\n" +
    "// Fails open: no hub running (or any error) means the commit goes through.\n" +
    '// Agents commit with BOTHREAD_AGENT="<room display name>"; bypass once with BOTHREAD_GUARD=off\n' +
    "// (or git commit --no-verify). Remove with: bothread guard uninstall\n" +
    `(${guardHookMain.toString()})().then(\n` +
    "  (code) => { process.exitCode = code; },\n" +
    "  (err) => { process.stderr.write(`bothread guard: ${(err && err.message) || err} — commit not checked.\\n`); process.exitCode = 0; }\n" +
    ");\n"
  );
}

function hookState(info) {
  const exists = existsSync(info.hookPath);
  const ours = exists && isGuardHook(info.hookPath);
  return { exists, ours, foreign: exists && !ours, chained: existsSync(info.prevPath) };
}

async function guardInstall(flags) {
  const info = requireRepo(flags);
  const st = hookState(info);
  let chained = false;
  if (st.foreign) {
    if (!flags.force) {
      throw new CliError(
        `A pre-commit hook that isn't Bothread's already exists: ${info.hookPath}\n` +
          `Nothing was changed. Re-run with --force to chain it: it moves to ${GUARD_PREV}\n` +
          `and runs first on every commit (if it fails, the commit fails); 'bothread guard uninstall' restores it.`
      );
    }
    if (st.chained) {
      throw new CliError(
        `Can't chain: ${info.prevPath} already exists.\nMove or delete one of the two hooks by hand, then run 'bothread guard install' again.`
      );
    }
    renameSync(info.hookPath, info.prevPath);
    chained = true;
  }
  mkdirSync(info.hooksDir, { recursive: true });
  writeFileSync(info.hookPath, guardHookSource(), { mode: 0o755 });
  try {
    chmodSync(info.hookPath, 0o755);
  } catch {
    /* Windows: git runs it through sh regardless */
  }
  const out = { installed: true, updated: st.ours, repo: info.toplevel, hookPath: info.hookPath, chainedHook: chained || st.chained ? info.prevPath : null };
  if (flags.json) {
    printJson(out);
    return 0;
  }
  console.log("");
  console.log(`  ${c.green("✓")} Commit guard ${st.ours ? "updated" : "installed"} in ${c.bold(info.toplevel)}`);
  console.log(`    ${c.dim("Hook".padEnd(10))}${info.hookPath}`);
  if (out.chainedHook) console.log(`    ${c.dim("Chained".padEnd(10))}${out.chainedHook} ${c.dim("(runs first)")}`);
  console.log("");
  console.log(`  Commits that touch a file another agent holds exclusively are now blocked.`);
  console.log(`  ${c.dim('Agents commit with BOTHREAD_AGENT="<room display name>" git commit ...')}`);
  console.log(`  ${c.dim("No hub running → commits go through. Bypass once: BOTHREAD_GUARD=off git commit ...")}`);
  console.log("");
  return 0;
}

async function guardUninstall(flags) {
  const info = requireRepo(flags);
  const st = hookState(info);
  if (st.foreign) {
    throw new CliError(`The pre-commit hook at ${info.hookPath} isn't Bothread's — left it alone.`);
  }
  let restored = null;
  if (st.ours) unlinkSync(info.hookPath);
  if (st.ours && st.chained) {
    renameSync(info.prevPath, info.hookPath);
    restored = info.hookPath;
  }
  const out = { removed: st.ours, repo: info.toplevel, hookPath: info.hookPath, restoredHook: restored };
  if (flags.json) {
    printJson(out);
    return 0;
  }
  if (!st.ours) console.log(`\n  ${c.dim("·")} The commit guard isn't installed in ${info.toplevel} — nothing to remove.\n`);
  else {
    console.log(`\n  ${c.green("✓")} Commit guard removed from ${c.bold(info.toplevel)}`);
    if (restored) console.log(`    ${c.dim("Restored your previous pre-commit hook:")} ${restored}`);
    console.log("");
  }
  return 0;
}

async function guardStatus(flags) {
  const info = requireRepo(flags);
  const st = hookState(info);
  const port = resolvePort(flags);
  const probe = await probeHub(port, 800);
  const hub = { port, running: probe.state === "bothread", version: probe.state === "bothread" ? probe.health.version ?? null : null };
  const disabled = String(process.env.BOTHREAD_GUARD ?? "").toLowerCase() === "off";
  if (flags.json) {
    printJson({
      installed: st.ours,
      repo: info.toplevel,
      hookPath: info.hookPath,
      foreignHook: st.foreign,
      chainedHook: st.ours && st.chained ? info.prevPath : null,
      disabledByEnv: disabled,
      hub,
    });
    return 0;
  }
  const kv = (k, v) => `    ${c.dim(k.padEnd(10))}${v}`;
  console.log("");
  if (st.ours) console.log(`  ${c.green("●")} ${c.bold("Commit guard is installed")} in ${info.toplevel}`);
  else console.log(`  ${c.dim("○")} ${c.bold("Commit guard is not installed")} in ${info.toplevel}`);
  console.log(kv("Hook", info.hookPath + (st.foreign ? c.yellow("  (another tool's hook is here)") : st.exists ? "" : c.dim("  (none)"))));
  if (st.ours && st.chained) console.log(kv("Chained", info.prevPath));
  console.log(kv("Hub", hub.running ? c.green(`running on port ${port} (${ver(probe.health)})`) : c.yellow(`not running on port ${port} — commits go through unchecked`)));
  if (disabled) console.log(kv("Env", c.yellow("BOTHREAD_GUARD=off — the hook is skipped in this shell")));
  console.log("");
  if (!st.ours) console.log(`  Install it:  ${c.bold("bothread guard install")}${st.foreign ? c.dim("  (add --force to chain the existing hook)") : ""}\n`);
  return 0;
}

/** A file argument (relative to the cwd) → repo-relative, forward slashes. */
function repoRelative(toplevel, file) {
  const abs = path.resolve(file);
  let real = abs;
  try {
    real = realpathSync(abs);
  } catch {
    try {
      real = path.join(realpathSync(path.dirname(abs)), path.basename(abs));
    } catch {
      /* keep abs */
    }
  }
  let top = toplevel;
  try {
    top = realpathSync(toplevel);
  } catch {
    /* keep */
  }
  const rel = path.relative(top, real);
  return (rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : file).split(path.sep).join("/");
}

async function guardCheck(flags, files) {
  const info = requireRepo(flags);
  const port = resolvePort(flags);
  const agent = (flags.agent ?? process.env.BOTHREAD_AGENT ?? "").trim() || undefined;
  let list;
  if (files.length) list = files.map((f) => repoRelative(info.toplevel, f));
  else {
    const staged = git(info.toplevel, ["diff", "--cached", "--name-only", "--diff-filter=ACMRD", "-z"]);
    if (!staged.ok) throw new CliError(`Couldn't list staged files: ${staged.err}`);
    list = staged.out.split("\0").filter(Boolean);
  }
  if (list.length > 5000) throw new CliError(`Too many files to check at once (${list.length}; max 5000).`);
  await requireHub(port);
  const headers = process.env.BOTHREAD_TOKEN ? { authorization: `Bearer ${process.env.BOTHREAD_TOKEN}` } : {};
  const r = await hubRequest(port, "POST", "/api/guard/check", { projectPath: info.toplevel, files: list, ...(agent ? { agent } : {}) }, 3000, headers).catch((err) => {
    throw new CliError(`Lost contact with the hub on port ${port}: ${err.message}`, 2);
  });
  if (r.status >= 400 || !Array.isArray(r.json?.blocked)) throw new CliError(`The hub refused the guard check: ${r.json?.error ?? `HTTP ${r.status}`}`);
  const res = r.json;
  if (flags.json) {
    printJson({ ok: res.blocked.length === 0, repo: info.toplevel, agent: agent ?? null, files: list, ...res });
    return res.blocked.length ? 1 : 0;
  }
  const where = res.rooms.length ? `room${res.rooms.length === 1 ? "" : "s"}: ${res.rooms.join(", ")}` : "no open room points at this repo";
  if (!list.length) {
    console.log(`\n  ${c.dim("·")} Nothing staged to check. ${c.dim("Pass files to check them: bothread guard check <file>...")}\n`);
    return 0;
  }
  if (!res.blocked.length) {
    console.log(`\n  ${c.green("✓")} ${res.checked} file${res.checked === 1 ? "" : "s"} clear${agent ? ` for ${c.bold(agent)}` : ""} ${c.dim(`(${where})`)}\n`);
    return 0;
  }
  const width = Math.min(48, Math.max(...res.blocked.map((b) => b.file.length)));
  console.log("");
  console.log(`  ${c.red("✗")} ${c.bold(`${res.blocked.length} of ${res.checked} file${res.checked === 1 ? "" : "s"} held by another agent`)}${agent ? c.dim(` (checked as ${agent})`) : ""}`);
  console.log("");
  for (const b of res.blocked) console.log(`    ${c.bold(b.file.padEnd(width))}  held by ${c.cyan(b.heldByName)}  ${c.dim(`(room "${b.roomName}", claim ${b.pattern})`)}`);
  console.log("");
  console.log(`  Ask the holder in the room (agents: ${c.bold("request_handoff({ path })")}) or wait for them to release it.`);
  if (!agent) console.log(`  ${c.dim('Checking as an agent? Add --agent "<room display name>" (or set BOTHREAD_AGENT).')}`);
  console.log("");
  return 1;
}

async function cmdGuard({ flags, positionals }) {
  const action = positionals[0]?.toLowerCase();
  if (!action) throw new CliError(`Which guard action? One of: ${GUARD_ACTIONS.join(", ")}\nUsage: bothread guard <install|uninstall|status|check> — see: bothread help guard`);
  if (!GUARD_ACTIONS.includes(action)) {
    const guess = closest(action, GUARD_ACTIONS);
    throw new CliError(`Unknown guard action '${positionals[0]}'.` + (guess ? ` Did you mean '${guess}'?` : "") + `\nActions: ${GUARD_ACTIONS.join(", ")}`);
  }
  const rest = positionals.slice(1);
  if (action !== "check" && rest.length) throw new CliError(`'bothread guard ${action}' takes no file arguments (got '${rest[0]}'). See: bothread help guard`);
  if (action !== "check" && flags.agent !== undefined) throw new CliError(`--agent only applies to 'bothread guard check'.`);
  if (action !== "install" && flags.force) throw new CliError(`--force only applies to 'bothread guard install'.`);
  if (action === "install") return guardInstall(flags);
  if (action === "uninstall") return guardUninstall(flags);
  if (action === "status") return guardStatus(flags);
  return guardCheck(flags, rest);
}

/* help */

function mainHelp() {
  const h = (s) => c.bold(c.accent(s));
  const row = (left, right, w = 22) => `    ${c.bold(left.padEnd(w))}${right}`;
  const cmds = Object.entries(COMMANDS).map(([name, spec]) => row(`${name}${spec.args ? " " + spec.args : ""}`, spec.summary));
  const flagRows = ["port", "host", "db", "auth", "no-open", "no-setup", "project", "json", "help", "version"].map((f) => row(FLAGS[f].usage, FLAGS[f].desc));
  const env = [
    ["BOTHREAD_PORT=4889", "Hub port"],
    ["BOTHREAD_HOST=127.0.0.1", "Bind address (off-loopback requires auth)"],
    ["BOTHREAD_AUTH=on", "Require a bearer token (auth is OFF by default)"],
    ["BOTHREAD_TOKEN=<token>", "Use this token instead of the generated one"],
    ["BOTHREAD_DB=<path>", "SQLite file or :memory: (default: data dir)"],
    ["BOTHREAD_NO_OPEN=1", "Don't auto-open the browser"],
    ["BOTHREAD_NO_SETUP=1", "Don't ask to connect agents on first start"],
    ["BOTHREAD_NO_TELEMETRY=1", "Disable anonymous usage counters"],
    ["BOTHREAD_AGENT=<name>", "Commit guard: who is committing (room display name)"],
    ["BOTHREAD_GUARD=off", "Commit guard: skip the pre-commit check once"],
    ["NO_COLOR=1", "Plain output (FORCE_COLOR=1 forces color)"],
  ].map(([k, v]) => `    ${k.padEnd(26)}${c.dim(v)}`);
  const examples = [
    ["bothread setup", "Connect every AI agent on this computer"],
    ["bothread", "Start on 4889, open the room"],
    ["bothread start --port 4890 --no-open", "Another port, no browser"],
    ['bothread new "auth refactor" --project .', "Create a room for this folder"],
    ["bothread connect claude", "MCP setup for Claude Code"],
    ["bothread status", "What's running, who's in each room"],
    ["bothread guard install", "Block commits of files another agent holds"],
  ].map(([k, v]) => `    ${k.padEnd(42)}${c.dim(v)}`);
  console.log(`
  ${c.bold("bothread")} ${c.dim(`v${pkgVersion()}`)} — a local room where your AI agents work together.

  ${h("USAGE")}
    bothread [command] [flags]        ${c.dim("(no command = start)")}

  ${h("COMMANDS")}
${cmds.join("\n")}

  ${h("KEYS")} ${c.dim("(while bothread start runs in a terminal)")}
    ${c.bold("o")} open the room · ${c.bold("s")} set up agents · ${c.bold("c")} copy the MCP URL · ${c.bold("h")} help · ${c.bold("q")} quit

  ${h("FLAGS")}
${flagRows.join("\n")}
    ${c.dim("Flags win over env vars. Per-command flags: bothread help <command>")}

  ${h("ENV")}
${env.join("\n")}

  ${h("EXAMPLES")}
${examples.join("\n")}

  ${h("FOR AI AGENTS")}
    status, rooms, new, connect, setup, doctor and guard take ${c.bold("--json")} (pure JSON on stdout).
    ${c.bold("bothread setup --yes --json")} connects every agent found, without prompts.
    Exit codes: 0 ok · 1 error or bad usage · 2 no hub running on the port.
    Committing in a repo with the commit guard? Set your room display name so your
    own claims pass:  ${c.bold('BOTHREAD_AGENT="<your room name>" git commit -m "..."')}
    Preview first with ${c.bold('bothread guard check --agent "<your room name>" --json')} (exit 1 = blocked).
    Blocked? Don't bypass — call request_handoff for the file, or wait for its release.
`);
}

function commandHelp(name) {
  const spec = COMMANDS[name];
  const h = (s) => c.bold(c.accent(s));
  const usageFlags = spec.flags.map((f) => `[${FLAGS[f].usage}]`).join(" ");
  const lines = [
    "",
    `  ${c.bold(`bothread ${name}`)} — ${spec.summary}`,
    "",
    `  ${h("USAGE")}`,
    `    bothread ${name}${spec.args ? " " + spec.args : ""}${usageFlags ? " " + usageFlags : ""}`,
  ];
  if (spec.details) lines.push("", ...spec.details.split("\n").map((l) => `  ${l}`));
  if (name === "connect" || name === "setup")
    lines.push("", `  ${h("AGENTS")}`, ...AGENTS.filter((a) => name === "connect" || a.id !== "other").map((a) => `    ${c.bold(a.id.padEnd(16))}${a.label}`));
  if (spec.flags.length) {
    lines.push("", `  ${h("FLAGS")}`, ...[...spec.flags, "help"].map((f) => `    ${c.bold(FLAGS[f].usage.padEnd(20))}${FLAGS[f].desc}`));
    if (name === "setup") lines.push(`    ${c.dim("--json implies --yes (unless --dry-run).")}`);
  }
  lines.push("", `  ${h("EXAMPLES")}`, ...spec.examples.map((e) => `    ${e}`), "");
  console.log(lines.join("\n"));
}

async function cmdHelp({ positionals }) {
  const topic = positionals[0]?.toLowerCase();
  if (!topic) {
    mainHelp();
    return 0;
  }
  if (!COMMANDS[topic]) throw unknownCommand(topic);
  commandHelp(topic);
  return 0;
}

function unknownCommand(name) {
  const guess = closest(name, Object.keys(COMMANDS));
  return new CliError(
    `Unknown command '${name}'.` + (guess ? ` Did you mean '${guess}'?` : "") + `\nRun 'bothread help' to see all commands.`
  );
}

/* ──────────────────────────────── start ──────────────────────────────── */

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
  if (!existsSync(uiIndex)) return true;
  const builtAt = statSync(uiIndex).mtimeMs;
  const sourceAt = Math.max(
    newestMtime(path.join(root, "apps", "room-ui", "src")),
    newestMtime(path.join(root, "packages", "shared", "src"))
  );
  return sourceAt > builtAt;
}

/**
 * First run at a terminal: agents are installed, none is connected, and we've
 * never asked → ask once. Returns an exit code to stop with, or null to go on.
 */
async function firstRunNudge(port, flags) {
  const marker = path.join(dataDir(), "setup-offered");
  if (existsSync(marker)) return null;
  let candidates;
  try {
    const ctx = await setupContext(port, flags);
    const agents = detectAgents({ mcpUrl: ctx.mcpUrl, token: ctx.token });
    if (agents.some((a) => a.configured)) return null;
    candidates = agents.filter((a) => a.detected && a.canAutoSetup);
  } catch {
    return null;
  }
  if (!candidates.length) return null;
  const ui = createUi();
  const names = listJoin(candidates.map((a) => a.label));
  const answer = await ui.yesNo(`Found ${names}. Connect ${candidates.length === 1 ? "it" : "them"} to Bothread now?`);
  try {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(marker, `${new Date().toISOString()}\n`);
  } catch {
    /* worst case we ask again next time */
  }
  if (answer === CANCEL) {
    console.log("");
    return 130;
  }
  if (!answer) {
    console.log(`    ${c.dim(`No problem — run ${selfCmd("setup")} any time (or press s once it's running).`)}\n`);
    return null;
  }
  console.log("");
  try {
    await setupFlow({ flags: { ...flags, yes: true }, only: candidates.map((a) => a.id), nudge: true });
  } catch (err) {
    console.error(`  ${ce.yellow("!")} Setup didn't finish: ${err?.message ?? err} — starting anyway.\n`);
  }
  return null;
}

/**
 * Live keys while the hub runs (TTY only): o open · s setup · c copy MCP URL ·
 * h help · q / Ctrl-C / Ctrl-D stop. The hub was spawned with stdin ignored, so
 * Ctrl-C arrives here as a key (raw mode) and is forwarded as SIGINT.
 */
function hubKeys(hub, { port, host, flags }) {
  const stdin = process.stdin;
  const shownHost = !host || ["0.0.0.0", "::", "[::]"].includes(host) ? "127.0.0.1" : host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const base = `http://${shownHost}:${port}`;
  let stopping = false;
  let busy = false;

  const restore = () => {
    try {
      if (stdin.isTTY) stdin.setRawMode(false);
    } catch {
      /* terminal already gone */
    }
    process.stdout.write("\x1b[?25h");
  };
  process.on("exit", restore);

  const stop = (signal = "SIGINT") => {
    if (stopping) {
      hub.kill("SIGKILL"); // second press: don't wait
      return;
    }
    stopping = true;
    console.log(`\n  ${c.dim("Stopping Bothread…")}`);
    hub.kill(signal);
    setTimeout(() => hub.kill("SIGKILL"), 6000).unref();
  };
  hub.on("exit", (code, signal) => {
    stdin.off("data", onData);
    restore();
    stdin.pause();
    if (stopping) console.log(`  ${c.green("✓")} Bothread stopped.\n`);
    process.exit(code ?? (signal && !stopping ? 1 : 0));
  });
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGHUP", () => stop("SIGTERM"));

  const keyHelp = () => {
    const k = (key, what) => `    ${c.cyan(key)}  ${what}`;
    console.log(
      ["", `  ${c.bold("Keys")}`, k("o", "open the room in your browser"), k("s", "set up agents (connect Claude Code, Cursor, …)"), k("c", "copy the MCP URL"), k("h", "show these keys"), k("q", "stop Bothread (also Ctrl-C)"), ""].join("\n")
    );
  };
  const hint = () => console.log(`  ${c.dim("press")} ${c.cyan("h")} ${c.dim("for keys ·")} ${c.cyan("q")} ${c.dim("to quit")}\n`);

  const runSetup = async () => {
    busy = true;
    stdin.off("data", onData);
    console.log("");
    try {
      await setupFlow({ flags: { port: String(port), ...(flags.auth ? { auth: true } : {}) }, inline: true });
    } catch (err) {
      console.error(`  ${ce.red("✗")} ${err?.message ?? err}\n`);
    } finally {
      if (!stopping) {
        try {
          stdin.setRawMode(true);
        } catch {
          /* ignore */
        }
        stdin.resume();
        stdin.on("data", onData);
        hint();
      }
      busy = false;
    }
  };

  const onKey = (key) => {
    if (busy) return;
    if (key === "\x03" || key === "\x04" || key === "q" || key === "Q") return stop("SIGINT");
    if (stopping) return;
    switch (key.toLowerCase()) {
      case "o":
        console.log(`  ${c.dim("Opening")} ${c.cyan(`${base}/`)}`);
        openBrowser(`${base}/`, true);
        return;
      case "s":
        void runSetup();
        return;
      case "c": {
        const url = `${base}/mcp`;
        if (copyToClipboard(url)) console.log(`  ${c.green("✓")} Copied the MCP URL: ${c.cyan(url)}`);
        else console.log(`  ${c.dim("MCP URL (copy it from here):")}\n  ${c.cyan(url)}`);
        return;
      }
      case "h":
      case "?":
        keyHelp();
        return;
      case "\r":
      case "\n":
        process.stdout.write("\n");
        return;
      default:
    }
  };
  const onData = (chunk) => {
    for (const key of splitKeys(chunk)) onKey(key);
  };

  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  stdin.on("data", onData);
}

async function cmdStart({ flags }) {
  // Friendly preflight: Node version.
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 20) {
    console.error(
      `\n  Bothread needs Node.js 20 or newer — you're on ${process.versions.node}.\n` +
        `  Install the latest LTS from https://nodejs.org, then run 'bothread start' again.\n`
    );
    return 1;
  }

  const port = resolvePort(flags);
  const runEnv = { ...process.env, BOTHREAD_CHANNEL: detectChannel(), BOTHREAD_VERSION: pkgVersion() };
  if (flags.port !== undefined) runEnv.BOTHREAD_PORT = String(port);
  if (flags.host !== undefined) runEnv.BOTHREAD_HOST = flags.host;
  if (flags["no-open"]) runEnv.BOTHREAD_NO_OPEN = "1";
  if (flags.auth) runEnv.BOTHREAD_AUTH = "on";
  const db = flags.db ?? process.env.BOTHREAD_DB;
  if (db) runEnv.BOTHREAD_DB = resolveDb(db);

  // Already running? Then just reopen it — two hubs can't share a port anyway.
  // Anything else on the port falls through to the hub's own EADDRINUSE message.
  const probe = await probeHub(port);
  if (probe.state === "bothread") {
    const url = `${hubUrl(port)}/`;
    console.log(`\n  ${c.green("●")} Bothread is already running at ${c.cyan(hubUrl(port))} (${ver(probe.health)})`);
    console.log(`    ${c.dim("Agents connect to")} ${mcpUrlFor(port)}   ${c.dim("·  see: bothread status")}`);
    if (runEnv.BOTHREAD_NO_OPEN) console.log("");
    else {
      console.log(`    ${c.dim("Opening the room in your browser…")}\n`);
      openBrowser(url);
    }
    return 0;
  }

  printBanner();

  // A person at a terminal gets the first-run question and live keys; CI, tests
  // and piped runs get exactly the old behavior (no raw mode, no questions).
  const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY && typeof process.stdin.setRawMode === "function";
  if (interactive && !flags["no-setup"] && !process.env.BOTHREAD_NO_SETUP) {
    const code = await firstRunNudge(port, flags);
    if (code !== null) return code;
  }
  if (interactive) runEnv.BOTHREAD_KEYS = "1";

  const run = (cmdArgs) => {
    if (interactive) {
      // stdin stays with us (the keys); the hub's output goes straight to the terminal.
      const hub = spawn(process.execPath, cmdArgs, { stdio: ["ignore", "inherit", "inherit"], cwd: root, env: runEnv });
      hubKeys(hub, { port, host: flags.host ?? process.env.BOTHREAD_HOST, flags });
      return;
    }
    const hub = spawn(process.execPath, cmdArgs, { stdio: "inherit", cwd: root, env: runEnv });
    hub.on("exit", (code) => process.exit(code ?? 0));
    process.on("SIGINT", () => hub.kill("SIGINT"));
    process.on("SIGTERM", () => hub.kill("SIGTERM"));
  };

  if (!isDevClone && existsSync(prodBundle)) {
    // ── Production mode (npm install / npx): use the pre-built bundle. ──
    run([prodBundle]);
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
    run([tsxCli, path.join(root, "packages", "server", "src", "index.ts")]);
  }
  return null; // keep running: the hub's exit ends this process
}

/* ──────────────────────────────── main ──────────────────────────────── */

const HANDLERS = {
  start: cmdStart,
  status: cmdStatus,
  rooms: cmdRooms,
  new: cmdNew,
  connect: cmdConnect,
  setup: cmdSetup,
  doctor: cmdDoctor,
  guard: cmdGuard,
  help: cmdHelp,
  version: cmdVersion,
};
const NO_POSITIONALS = new Set(["start", "status", "rooms", "doctor", "version"]);

async function main(argv) {
  let name = "start";
  let rest = argv;
  if (argv.length && !argv[0].startsWith("-")) {
    name = argv[0].toLowerCase();
    rest = argv.slice(1);
  } else if (argv.some((a) => a === "-v" || a === "--version")) {
    // `bothread --version [--json]`
    name = "version";
    rest = argv.filter((a) => a !== "-v" && a !== "--version");
  } else if (argv.some((a) => a === "-h" || a === "--help")) {
    // Bare `bothread --help` is the main help, not start's.
    mainHelp();
    return 0;
  }
  if (!HANDLERS[name]) throw unknownCommand(name);

  const { flags, positionals } = parseArgs(rest, COMMANDS[name].flags);
  if (flags.help) {
    if (name === "help") mainHelp();
    else commandHelp(name);
    return 0;
  }
  if (NO_POSITIONALS.has(name) && positionals.length) {
    throw new CliError(`'bothread ${name}' takes no arguments (got '${positionals[0]}'). See: bothread help ${name}`);
  }
  return HANDLERS[name]({ flags, positionals });
}

main(process.argv.slice(2)).then(
  (code) => {
    // Set, don't exit: process.exit() can truncate large output still flushing to a pipe.
    if (typeof code === "number") process.exitCode = code;
  },
  (err) => {
    if (err instanceof CliError) {
      const [first, ...more] = err.message.split("\n");
      console.error(`${ce.red("✗")} ${first}${more.length ? "\n" + more.map((l) => `  ${l}`).join("\n") : ""}`);
      process.exitCode = err.exitCode;
    } else {
      console.error(err);
      process.exitCode = 1;
    }
  }
);
