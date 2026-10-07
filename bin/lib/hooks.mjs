/**
 * `bothread hooks` — Claude Code hooks that keep an agent inside the room's rules.
 *
 *   bothread hooks install   [--agent "<room name>"] [--user] [--path <project>] [--json]
 *   bothread hooks uninstall [--user] [--path <project>] [--json]
 *   bothread hooks status    [--user] [--path <project>] [--json]
 *   bothread hooks run <pre-edit|stop|context|notify> --agent "<room name>"   (called BY Claude Code)
 *
 * install merges five handlers into `.claude/settings.json` (project) or the user's
 * `~/.claude/settings.json` (--user, honoring CLAUDE_CONFIG_DIR):
 *   PreToolUse  Edit|Write|MultiEdit|NotebookEdit → run pre-edit  (exit 2 = edit blocked)
 *   PostToolUse (every tool)                      → run notify    (JSON additionalContext =
 *                                                   new @mentions / interrupts, once each)
 *   Stop                                          → run stop      (exit 2 = keep working)
 *   UserPromptSubmit, SessionStart                → run context   (stdout = extra context)
 * install --channel also registers `bothread channel` as "bothread-channel" in the
 * project's .mcp.json (a Claude Code channel: push into an idle session).
 * Other hooks in the file are never touched; the file is backed up before any write;
 * running it twice changes nothing; uninstall removes only handlers whose command
 * contains "hooks run pre-edit|stop|context|notify" and "bothread".
 *
 * `run` never fails the agent: it exits 0 (allow) on any error, when the hub is down,
 * or with BOTHREAD_HOOKS=off, and 2 only for a deliberate block. It honors
 * BOTHREAD_PORT, BOTHREAD_TOKEN and BOTHREAD_AGENT (which overrides the installed
 * --agent, so two Claude Code sessions in one project can run under different names).
 *
 * Hook format: https://code.claude.com/docs/en/hooks
 *
 * Zero dependencies, like the rest of the CLI.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { backupFile } from "./agents.mjs";

export const HOOK_ACTIONS = ["install", "uninstall", "status", "run"];
export const RUN_KINDS = ["pre-edit", "stop", "context", "notify"];
const EDIT_MATCHER = "Edit|Write|MultiEdit|NotebookEdit";
const DEFAULT_AGENT = "Claude Code";
/** The .mcp.json server name `install --channel` registers (and Claude Code's server:<name>). */
export const CHANNEL_SERVER_NAME = "bothread-channel";
export const CHANNEL_LAUNCH = `claude --dangerously-load-development-channels server:${CHANNEL_SERVER_NAME}`;
const DEFAULT_PORT = 4889;
const isWin = process.platform === "win32";

/* ─────────────────────────── shared helpers ─────────────────────────── */

export function portFromEnv(flags = {}) {
  const raw = String(flags.port ?? process.env.BOTHREAD_PORT ?? "").trim();
  const n = Number(raw);
  return /^\d+$/.test(raw) && n >= 1 && n <= 65535 ? n : DEFAULT_PORT;
}

/** JSON over node:http to the local hub (never a proxy). Rejects on network errors/timeouts. */
export function hubCall(port, method, urlPath, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const headers = { accept: "application/json" };
    if (data) Object.assign(headers, { "content-type": "application/json", "content-length": data.length });
    if (process.env.BOTHREAD_TOKEN) headers.authorization = `Bearer ${process.env.BOTHREAD_TOKEN}`;
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method, agent: false, headers }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("error", reject);
      res.on("end", () => {
        clearTimeout(timer);
        let json = null;
        try {
          json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          /* not JSON */
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })), timeoutMs);
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end(data);
  });
}

/** `p` with symlinks resolved as far as the path exists (a new file's folder may not yet). */
function realish(p) {
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** Nearest ancestor holding a `.git` entry (repo or worktree), else null. No subprocess. */
function gitRoot(start) {
  let cur = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(cur, ".git"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/** The project a hook invocation is about: repo root of the session's cwd, else the cwd. */
export function projectOf(input) {
  const cwd = (typeof input?.cwd === "string" && input.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return realish(gitRoot(cwd) ?? cwd);
}

/** Read all of stdin (Claude Code pipes one JSON object). Empty / TTY / bad JSON → {}. */
function readStdinJson(timeoutMs = 2000) {
  if (process.stdin.isTTY) return Promise.resolve({});
  return new Promise((resolve) => {
    const chunks = [];
    const finish = () => {
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      process.stdin.destroy();
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        resolve(v && typeof v === "object" ? v : {});
      } catch {
        resolve({});
      }
    };
    const timer = setTimeout(finish, timeoutMs);
    process.stdin.on("data", (d) => chunks.push(d));
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const hooksOff = () => String(process.env.BOTHREAD_HOOKS ?? "").trim().toLowerCase() === "off";
const agentFor = (flags) => (process.env.BOTHREAD_AGENT ?? "").trim() || String(flags.agent ?? "").trim() || DEFAULT_AGENT;

/* ─────────────────────────── hooks run ─────────────────────────── */

/** PreToolUse on Edit|Write|MultiEdit|NotebookEdit. → 0 allow · 2 block. */
async function runPreEdit(flags, input, err) {
  const ti = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const raw = [ti.file_path, ti.notebook_path, ti.path].find((v) => typeof v === "string" && v.trim());
  if (!raw) return 0;
  const cwd = (typeof input.cwd === "string" && input.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const abs = realish(path.resolve(cwd, raw));
  const project = realish(gitRoot(path.dirname(abs)) ?? gitRoot(cwd) ?? cwd);
  const rel = path.relative(project, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return 0;
  const file = rel.split(path.sep).join("/");
  const agent = agentFor(flags);
  const port = portFromEnv(flags);
  const r = await hubCall(port, "POST", "/api/guard/check", { projectPath: project, files: [file], agent, source: "edit" }, 1500);
  const blocked = r.status === 200 && Array.isArray(r.json?.blocked) ? r.json.blocked : [];
  if (!blocked.length) return 0;
  const b = blocked[0];
  err(
    `Bothread: ${b.file} is claimed exclusively by ${b.heldByName} in the room "${b.roomName}" — you (${agent}) must not edit it.\n` +
      `Next: call the bothread tool request_handoff({ path: "${b.file}", message: "<why you need it>" }) so ${b.heldByName} is asked to release it, ` +
      `then work on something else (claim_next_task, or wait_for_update) and claim_files it once it's free. Don't retry this edit or work around it.`
  );
  return 2;
}

/** GET /api/agent-status → rooms where this agent is a live participant. */
async function liveRooms(flags, input, timeoutMs) {
  const agent = agentFor(flags);
  const project = projectOf(input);
  const q = `/api/agent-status?project=${encodeURIComponent(project)}&agent=${encodeURIComponent(agent)}`;
  const r = await hubCall(portFromEnv(flags), "GET", q, undefined, timeoutMs);
  if (r.status !== 200 || !Array.isArray(r.json?.rooms)) return { agent, rooms: [] };
  const rooms = r.json.rooms.filter(
    (x) => x && x.joined && x.roomStatus !== "closed" && x.participant && (x.participant.status === "active" || x.participant.status === "idle")
  );
  return { agent, rooms };
}

/** What each room still needs from the agent, as short phrases. */
function needs(room, { withTasks }) {
  const out = [];
  if (room.unreadMentions) out.push(`${plural(room.unreadMentions, "unread @mention")} of you`);
  if (room.unreadInterrupts) out.push(`${plural(room.unreadInterrupts, "unread interrupt")}`);
  for (const h of (room.handoffsWaiting ?? []).slice(0, 3)) out.push(`${h.requestedBy} is waiting on ${h.path} (hand-off ${h.id})`);
  if (withTasks && room.openTasks?.length && room.activeTeammates?.length) {
    const t = room.openTasks[0];
    const others = room.activeTeammates.slice(0, 3).join(", ");
    out.push(`your task "${t.title}" (${t.id}) is still in progress while ${others} ${room.activeTeammates.length === 1 ? "is" : "are"} active`);
  }
  return out;
}

/** Stop. → 0 let Claude stop · 2 keep working (reason on stderr). */
async function runStop(flags, input, err) {
  if (input.stop_hook_active === true) return 0; // already continuing because of a Stop hook — never loop
  const { rooms } = await liveRooms(flags, input, 1500);
  const lines = [];
  for (const room of rooms) {
    if (room.paused) continue; // nothing to do in a paused room but wait — let it stop
    const n = needs(room, { withTasks: true });
    if (n.length) lines.push(`Bothread room "${room.roomName}": ${n.join("; ")}.`);
  }
  if (!lines.length) return 0;
  err(
    `${lines.join("\n")}\n` +
      "Before you stop: call wait_for_update (or read_messages with unreadOnly: true), reply in the room, then keep going — " +
      "or, if your part is done, update_task / release_files and say so. If you need the human's input, say that in the room and then stop."
  );
  return 2;
}

/** UserPromptSubmit / SessionStart. Prints 1–3 lines of context, or nothing. Always 0. */
async function runContext(flags, input, out) {
  const { rooms } = await liveRooms(flags, input, 800);
  const lines = [];
  for (const room of rooms) {
    const n = needs(room, { withTasks: false });
    if (room.paused) lines.push(`Bothread room "${room.roomName}" is PAUSED by the human — don't edit files until it resumes.`);
    if (n.length) {
      const seqs = room.unreadMentionSeqs?.length ? ` (seq ${room.unreadMentionSeqs.slice(-5).join(", ")})` : "";
      lines.push(`Bothread room "${room.roomName}": ${n.join("; ")}${seqs}. Call read_messages with unreadOnly: true and respond before other work.`);
    }
  }
  if (lines.length) out(lines.slice(0, 3).join("\n") + "\n");
  return 0;
}

/**
 * One line per new interrupt, for Claude's context (same wording as the tool-result banner).
 * Shows the newest 3 per room; the rest are counted.
 */
export function notifyText(rooms) {
  const lines = [];
  for (const room of rooms) {
    const items = Array.isArray(room.interrupts) ? room.interrupts : [];
    if (!items.length) continue;
    const shown = items.slice(-3);
    const more = items.length - shown.length;
    if (more > 0) lines.push(`📣 ${plural(more, "more interrupt")} for you in Bothread room "${room.roomName}" — read_messages({ unreadOnly: true }) to see them all.`);
    for (const i of shown) {
      const who = i.authorKind === "human" ? `${i.author} (human)` : i.authorKind === "system" ? "Bothread" : i.author;
      const what = i.mentioned ? "@mentioned you" : "sent an interrupt";
      const text = String(i.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      lines.push(
        `📣 INTERRUPT from Bothread room "${room.roomName}" — ${who} ${what} [#${i.seq}]: "${text}" → read and respond before continuing ` +
          `(bothread send_message with replyToSeq: ${i.seq}); if it says stop or change course, do that first.`
      );
    }
  }
  return lines.join("\n");
}

/**
 * PostToolUse (every tool): new @mentions / interrupts → injected into Claude's context as
 * JSON `hookSpecificOutput.additionalContext`, and marked notified so neither this hook nor
 * the tool-result banner repeats them. Silent (no output) when there's nothing. Always 0.
 */
async function runNotify(flags, input, out) {
  const agent = agentFor(flags);
  const projectPath = projectOf(input);
  const r = await hubCall(portFromEnv(flags), "POST", "/api/agent-inbox", { projectPath, agent, mark: true }, 500);
  if (r.status !== 200 || !Array.isArray(r.json?.rooms)) return 0;
  const text = notifyText(r.json.rooms);
  if (text) out(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } }) + "\n");
  return 0;
}

export async function runHook(kind, flags, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(s));
  const err = io.err ?? ((s) => process.stderr.write(s.endsWith("\n") ? s : s + "\n"));
  if (hooksOff()) return 0;
  try {
    const input = await readStdinJson();
    if (kind === "pre-edit") return await runPreEdit(flags, input, err);
    if (kind === "stop") return await runStop(flags, input, err);
    if (kind === "context") return await runContext(flags, input, out);
    if (kind === "notify") return await runNotify(flags, input, out);
    return 0;
  } catch {
    return 0; // fail open: hub down, timeout, bad input — never get in the agent's way
  }
}

/* ─────────────────────────── settings.json ─────────────────────────── */

const OUR_CMD = /\bhooks run (pre-edit|stop|context|notify)\b/;
export const isOurHandler = (h) => !!h && typeof h === "object" && typeof h.command === "string" && OUR_CMD.test(h.command) && /bothread/i.test(h.command);

/** Where hooks go: project `.claude/settings.json` (repo root of --path / cwd), or the user's. */
export function settingsTarget(flags) {
  if (flags.user) {
    const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
    return { scope: "user", project: null, file: path.join(dir, "settings.json") };
  }
  const base = path.resolve(flags.path ?? ".");
  const project = flags.path ? base : (gitRoot(base) ?? base);
  return { scope: "project", project, file: path.join(project, ".claude", "settings.json") };
}

/** Shell-safe double-quoted string (POSIX sh and cmd both accept "..." for plain names). */
const q = (s) => `"${s}"`;

/**
 * How Claude Code should invoke this bothread, most robust first:
 *  • global install whose `bothread` on PATH is this very file → `bothread`
 *  • dev clone / other global install → `node "<abs>/bin/bothread.mjs"` (stable path)
 *  • npx run (the package lives in a disposable cache) → `npx -y bothread@<version>`
 */
export function hookInvocation({ root, channel, version }) {
  const binAbs = path.join(root, "bin", "bothread.mjs");
  if (channel === "npx") return `npx -y bothread@${version || "latest"}`;
  if (channel === "global") {
    const w = spawnSync(isWin ? "where" : "which", ["bothread"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const found = (w.stdout ?? "").split(/\r?\n/).find(Boolean);
    try {
      if (found && fs.realpathSync(found) === fs.realpathSync(binAbs)) return "bothread";
    } catch {
      /* fall through */
    }
  }
  return `node ${q(binAbs)}`;
}

export function ourHooks(agent, invocation) {
  const cmd = (kind, timeout) => ({ type: "command", command: `${invocation} hooks run ${kind} --agent ${q(agent)}`, timeout });
  return {
    PreToolUse: [{ matcher: EDIT_MATCHER, hooks: [cmd("pre-edit", 10)] }],
    // No matcher = every tool (Edit, Bash, Read, MCP tools …): the mid-task interrupt.
    PostToolUse: [{ hooks: [cmd("notify", 5)] }],
    Stop: [{ hooks: [cmd("stop", 10)] }],
    UserPromptSubmit: [{ hooks: [cmd("context", 5)] }],
    SessionStart: [{ hooks: [cmd("context", 5)] }],
  };
}

/** Deep copy of `settings` with every Bothread handler removed (and groups/events we emptied). */
export function withoutOurs(settings) {
  const next = JSON.parse(JSON.stringify(settings ?? {}));
  const hooks = next.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return next;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = [];
    let touched = false;
    for (const g of groups) {
      if (!g || typeof g !== "object" || !Array.isArray(g.hooks)) {
        kept.push(g);
        continue;
      }
      const hs = g.hooks.filter((h) => !isOurHandler(h));
      if (hs.length === g.hooks.length) kept.push(g);
      else {
        touched = true;
        if (hs.length) kept.push({ ...g, hooks: hs });
      }
    }
    if (touched && !kept.length) delete hooks[event];
    else hooks[event] = kept;
  }
  if (!Object.keys(hooks).length) delete next.hooks;
  return next;
}

export function withOurs(settings, agent, invocation) {
  const next = withoutOurs(settings);
  if (!next.hooks || typeof next.hooks !== "object" || Array.isArray(next.hooks)) next.hooks = {};
  for (const [event, groups] of Object.entries(ourHooks(agent, invocation))) {
    next.hooks[event] = [...(Array.isArray(next.hooks[event]) ? next.hooks[event] : []), ...groups];
  }
  return next;
}

/** Which events carry a Bothread handler, and the agent name it runs as. */
export function inspect(settings) {
  const events = [];
  let agent = null;
  let command = null;
  const hooks = settings?.hooks && typeof settings.hooks === "object" ? settings.hooks : {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
        if (!isOurHandler(h)) continue;
        if (!events.includes(event)) events.push(event);
        command ??= h.command;
        agent ??= h.command.match(/--agent\s+"([^"]*)"/)?.[1] ?? null;
      }
    }
  }
  return { installed: events.length > 0, events, agent, command };
}

function readSettings(file, CliError) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { exists: false, settings: {} };
    throw new CliError(`Couldn't read ${file}: ${err.message}`);
  }
  if (!text.trim()) return { exists: true, settings: {} };
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not a JSON object");
    return { exists: true, settings: v };
  } catch (err) {
    throw new CliError(`${file} isn't plain JSON (${err.message}) — not rewriting it.\nFix it, or add the hooks by hand (see: bothread help hooks).`);
  }
}

function writeSettings(file, exists, settings) {
  const backup = exists ? backupFile(file) : null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", "utf8");
  return backup;
}

const SAFE_NAME = /^[^"`$\\\r\n]{1,64}$/;

/** The .mcp.json entry that runs `bothread channel --agent <name>` the same way the hooks run. */
export function channelEntry({ root, channel, version, agent }) {
  const tail = ["channel", "--agent", agent];
  const inv = hookInvocation({ root, channel, version });
  if (inv === "bothread") return { command: "bothread", args: tail };
  if (inv.startsWith("npx ")) return { command: "npx", args: ["-y", `bothread@${version || "latest"}`, ...tail] };
  return { command: "node", args: [path.join(root, "bin", "bothread.mjs"), ...tail] };
}

const mcpJsonOf = (target) => (target.project ? path.join(target.project, ".mcp.json") : null);

/** Add / update "bothread-channel" in the project's .mcp.json (merged, backed up, idempotent). */
function installChannel(target, agent, ctx, dryRun) {
  const entry = channelEntry({ ...ctx, agent });
  const file = mcpJsonOf(target);
  if (!file) {
    const cmd = [entry.command, ...entry.args].map((a) => (/\s/.test(a) ? q(a) : a)).join(" ");
    return { file: null, changed: false, manual: `claude mcp add --scope user ${CHANNEL_SERVER_NAME} -- ${cmd}`, launch: CHANNEL_LAUNCH };
  }
  const { exists, settings } = readSettings(file, ctx.CliError);
  const servers = settings.mcpServers && typeof settings.mcpServers === "object" && !Array.isArray(settings.mcpServers) ? settings.mcpServers : {};
  const next = { ...settings, mcpServers: { ...servers, [CHANNEL_SERVER_NAME]: entry } };
  const changed = JSON.stringify(next) !== JSON.stringify(settings);
  const backup = changed && !dryRun ? writeSettings(file, exists, next) : null;
  return { file, changed, backup, entry, launch: CHANNEL_LAUNCH };
}

/** Remove "bothread-channel" from the project's .mcp.json, if it's there. */
function uninstallChannel(target, CliError) {
  const file = mcpJsonOf(target);
  if (!file || !fs.existsSync(file)) return { file, changed: false };
  const { exists, settings } = readSettings(file, CliError);
  if (!settings.mcpServers || typeof settings.mcpServers !== "object" || !(CHANNEL_SERVER_NAME in settings.mcpServers)) return { file, changed: false };
  const next = { ...settings, mcpServers: { ...settings.mcpServers } };
  delete next.mcpServers[CHANNEL_SERVER_NAME];
  return { file, changed: true, backup: writeSettings(file, exists, next) };
}

function channelInstalled(target) {
  const file = mcpJsonOf(target);
  try {
    return !!file && !!JSON.parse(fs.readFileSync(file, "utf8"))?.mcpServers?.[CHANNEL_SERVER_NAME];
  } catch {
    return false;
  }
}

/** Install / update the hooks. Returns a result object (never prints). */
export function installHooks(flags, ctx) {
  const { root, channel, version, CliError } = ctx;
  const agent = String(flags.agent ?? process.env.BOTHREAD_AGENT ?? DEFAULT_AGENT).trim();
  if (!SAFE_NAME.test(agent)) throw new CliError(`--agent must be 1–64 characters without quotes, backslashes, $ or backticks (got '${agent}').`);
  const target = settingsTarget(flags);
  if (target.project && !fs.existsSync(target.project)) throw new CliError(`--path folder not found: ${target.project}`);
  const { exists, settings } = readSettings(target.file, CliError);
  const invocation = hookInvocation({ root, channel, version });
  const next = withOurs(settings, agent, invocation);
  const changed = JSON.stringify(next) !== JSON.stringify(settings);
  const backup = changed && !flags["dry-run"] ? writeSettings(target.file, exists, next) : null;
  const channelResult = flags.channel ? installChannel(target, agent, ctx, !!flags["dry-run"]) : undefined;
  return {
    ok: true,
    action: "install",
    changed,
    ...target,
    agent,
    invocation,
    backup,
    events: Object.keys(ourHooks(agent, invocation)),
    ...(channelResult ? { channel: channelResult } : {}),
  };
}

export function uninstallHooks(flags, { CliError }) {
  const target = settingsTarget(flags);
  const { exists, settings } = readSettings(target.file, CliError);
  const next = withoutOurs(settings);
  const changed = exists && JSON.stringify(next) !== JSON.stringify(settings);
  const backup = changed ? writeSettings(target.file, exists, next) : null;
  return { ok: true, action: "uninstall", changed, ...target, backup, channel: uninstallChannel(target, CliError) };
}

export async function hooksStatus(flags, { CliError }) {
  const target = settingsTarget(flags);
  const { exists, settings } = readSettings(target.file, CliError);
  const info = inspect(settings);
  const port = portFromEnv(flags);
  let running = false;
  try {
    const r = await hubCall(port, "GET", "/api/health", undefined, 1000);
    running = r.json?.app === "bothread";
  } catch {
    /* down */
  }
  return { ...target, exists, ...info, channel: { installed: channelInstalled(target), launch: CHANNEL_LAUNCH }, disabled: hooksOff(), hub: { running, port } };
}

/* ─────────────────────────── the command ─────────────────────────── */

/**
 * `bothread hooks <action>`. `ctx` = { CliError, printJson, c, root, channel, version }.
 * Returns an exit code.
 */
export async function cmdHooks({ flags, positionals }, ctx) {
  const { CliError, printJson, c } = ctx;
  const action = positionals[0]?.toLowerCase();
  if (action === "run") {
    const kind = positionals[1]?.toLowerCase();
    if (!RUN_KINDS.includes(kind)) return 0; // an unknown kind from a newer/older install: allow
    return runHook(kind, flags);
  }
  if (!action) throw new CliError(`Which hooks action? One of: install, uninstall, status\nUsage: bothread hooks <install|uninstall|status> — see: bothread help hooks`);
  if (!HOOK_ACTIONS.includes(action)) throw new CliError(`Unknown hooks action '${positionals[0]}'. Actions: install, uninstall, status`);
  if (positionals.length > 1) throw new CliError(`'bothread hooks ${action}' takes no arguments (got '${positionals[1]}').`);
  if (action !== "install" && flags.agent !== undefined) throw new CliError(`--agent only applies to 'bothread hooks install' (and run).`);
  if (action !== "install" && flags.channel) throw new CliError(`--channel only applies to 'bothread hooks install' (uninstall always removes it).`);
  if (flags.user && flags.path) throw new CliError("Pick one of --user or --path.");

  if (action === "status") {
    const st = await hooksStatus(flags, ctx);
    if (flags.json) {
      printJson(st);
      return 0;
    }
    console.log("");
    if (st.installed) console.log(`  ${c.green("●")} ${c.bold("Bothread hooks are installed")} in ${st.file}  ${c.dim(`(as "${st.agent}")`)}`);
    else console.log(`  ${c.dim("○")} ${c.bold("Bothread hooks are not installed")} in ${st.file}`);
    if (st.installed) console.log(`    events: ${st.events.join(", ")}`);
    if (st.channel.installed) console.log(`    push channel: registered in .mcp.json — start Claude Code with ${c.bold(st.channel.launch)}`);
    if (st.disabled) console.log(`    ${c.yellow("!")} BOTHREAD_HOOKS=off in this shell — the hooks do nothing here.`);
    console.log(`    hub: ${st.hub.running ? c.green(`running on port ${st.hub.port}`) : c.dim(`not running on port ${st.hub.port} (hooks allow everything until it is)`)}`);
    if (!st.installed) console.log(`\n  Install them:  ${c.bold('bothread hooks install --agent "<your room name>"')}`);
    console.log("");
    return 0;
  }

  const r = action === "install" ? installHooks(flags, ctx) : uninstallHooks(flags, ctx);
  if (flags.json) {
    printJson(r);
    return 0;
  }
  console.log("");
  if (action === "install") {
    console.log(`  ${c.green("✓")} Claude Code hooks ${r.changed ? "installed" : "already installed"} in ${c.bold(r.file)}  ${c.dim(`(as "${r.agent}")`)}`);
    console.log(`    ${c.dim("Edits of files another agent holds are blocked; Claude keeps going while the room needs it.")}`);
    console.log(`    ${c.dim("After every tool call Claude is told about new @mentions and interrupts from the room.")}`);
    console.log(`    ${c.dim(`Runs: ${r.invocation} hooks run …`)}`);
    if (r.channel?.file) {
      console.log(`  ${c.green("✓")} Push channel ${r.channel.changed ? "registered" : "already registered"} in ${c.bold(r.channel.file)}  ${c.dim(`(${CHANNEL_SERVER_NAME})`)}`);
      console.log(`    Start Claude Code with: ${c.bold(r.channel.launch)}`);
      console.log(`    ${c.dim("Channels are a Claude Code research preview: claude.ai login or Console API key; Team/Enterprise admins must enable them.")}`);
    } else if (r.channel?.manual) {
      console.log(`  ${c.yellow("!")} The push channel lives in an MCP config, not settings.json. Add it with:`);
      console.log(`    ${c.bold(r.channel.manual)}`);
      console.log(`    then start Claude Code with: ${c.bold(r.channel.launch)}`);
    }
  } else if (r.changed) console.log(`  ${c.green("✓")} Bothread hooks removed from ${c.bold(r.file)}`);
  else console.log(`  ${c.dim("·")} No Bothread hooks in ${r.file} — nothing to remove.`);
  if (action === "uninstall" && r.channel?.changed) console.log(`  ${c.green("✓")} Push channel removed from ${c.bold(r.channel.file)}`);
  if (r.backup) console.log(`    ${c.dim(`backup: ${r.backup}`)}`);
  if (action === "install" && r.changed) console.log(`    ${c.dim("Open Claude Code's /hooks menu (or restart it) so it picks them up.")}`);
  console.log("");
  return 0;
}

/**
 * After `bothread setup`: offer the hooks when Claude Code is connected. Interactive runs
 * ask (default No); unattended runs only install with --hooks. `claudeConnected` may be a
 * function (only called when an offer could happen). Returns the install result or null; never throws.
 */
export async function offerHooksAfterSetup({ flags, claudeConnected, ui, ctx }) {
  try {
    if (flags.remove || flags["dry-run"]) return null;
    const mayAsk = !flags.json && !flags.yes && !!ui?.interactive;
    if (!flags.hooks && !mayAsk) return null;
    if (!(typeof claudeConnected === "function" ? claudeConnected() : claudeConnected)) return null;
    const inRepo = gitRoot(process.cwd());
    const f = inRepo ? { path: inRepo } : { user: true };
    let want = !!flags.hooks;
    if (!want) {
      const where = inRepo ? `this project (${inRepo})` : "all your projects (user settings)";
      const a = await ui.confirm({ message: `Also add Bothread's Claude Code hooks to ${where}? ${ui.c.dim("(blocks edits of claimed files, keeps Claude on task)")}`, initial: false });
      want = a === true;
    }
    if (!want) return null;
    const r = installHooks({ ...f, agent: flags.agent }, ctx);
    if (!flags.json) ui?.step?.(`${ui.c.green("✓")} Claude Code hooks ${r.changed ? "installed" : "already installed"} ${ui.c.dim(`→ ${r.file}`)}`);
    return r;
  } catch (err) {
    if (!flags.json) ui?.step?.(`Couldn't add the Claude Code hooks: ${err?.message ?? err}`, [], "warn");
    return null;
  }
}
