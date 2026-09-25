/**
 * Agent detection + MCP config writing, shared by the `bothread setup` CLI and
 * the hub's `/api/agents` endpoints (esbuild inlines this into the hub bundle).
 *
 * For every supported AI coding agent this knows: how to tell it's installed on
 * this machine, where its MCP config lives, the exact entry that points it at
 * the hub, and how to add/remove that entry safely:
 *
 *  • Only the "bothread" key is ever touched; everything else in the file is kept.
 *  • An existing file is copied to `<file>.bothread-backup-<YYYYMMDD-HHMMSS>` first.
 *  • Idempotent: when the entry is already right, nothing is written (no backup).
 *  • A JSON file with comments / trailing commas (JSONC) is never rewritten —
 *    the caller gets a note and the snippet to paste by hand.
 *  • Codex's TOML is edited as text: our `[mcp_servers.bothread]` table is
 *    replaced in place or appended; other tables are never touched.
 *
 * Zero dependencies, on purpose: the CLI must run before `npm install`.
 *
 * Tests point everything at a fake home with BOTHREAD_AGENT_HOME (or `home`);
 * then XDG_CONFIG_HOME / APPDATA / CODEX_HOME / CLAUDE_CONFIG_DIR are ignored
 * too, so nothing can reach the real home directory.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SERVER_NAME = "bothread";

/** Every agent Bothread knows how to connect, in display order. `other` is manual-only. */
export const AGENTS = [
  { id: "claude", label: "Claude Code", where: "Run once in your terminal:", restart: "Restart Claude Code (or run /mcp in an open session)" },
  {
    id: "claude-desktop",
    label: "Claude (desktop app)",
    where: "Settings → Developer → Edit Config, paste this, then fully quit & reopen Claude:",
    restart: "Fully quit Claude (desktop) and reopen it",
  },
  {
    id: "antigravity",
    label: "Antigravity",
    where: "Settings → Customizations → Open MCP Config (~/.gemini/config/mcp_config.json):",
    restart: "Restart Antigravity",
  },
  { id: "cursor", label: "Cursor", where: "Add to ~/.cursor/mcp.json (or a project's .cursor/mcp.json):", restart: "Restart Cursor" },
  { id: "gemini", label: "Gemini CLI", where: "Add to ~/.gemini/settings.json:", restart: "Restart Gemini CLI" },
  { id: "codex", label: "Codex", where: "Add to ~/.codex/config.toml:", restart: "Restart Codex" },
  { id: "opencode", label: "OpenCode", where: "Add to ~/.config/opencode/opencode.json:", restart: "Restart OpenCode" },
  { id: "windsurf", label: "Windsurf", where: "Add to ~/.codeium/windsurf/mcp_config.json:", restart: "Restart Windsurf (or refresh its MCP servers)" },
  { id: "vscode", label: "VS Code", where: "Command Palette → “MCP: Open User Configuration” (mcp.json), add:", restart: "Reload VS Code (Developer: Reload Window)" },
  { id: "zed", label: "Zed", where: "Zed → Settings → Open Settings (settings.json), add:", restart: "Restart Zed" },
  { id: "other", label: "Other", where: "Bridge any MCP client via mcp-remote:", restart: "Restart your MCP client" },
];

export const AGENT_ALIASES = {
  "claude-code": "claude",
  claudecode: "claude",
  "claude-app": "claude-desktop",
  desktop: "claude-desktop",
  "gemini-cli": "gemini",
  "vs-code": "vscode",
  code: "vscode",
  "mcp-remote": "other",
};

/** A known agent id for user input (case-insensitive, aliases resolved), or null. */
export function resolveAgentId(input) {
  const id = String(input ?? "").trim().toLowerCase();
  const real = AGENT_ALIASES[id] ?? id;
  return AGENTS.some((a) => a.id === real) ? real : null;
}

/* ─────────────────────────────── environment ─────────────────────────────── */

function context(opts = {}) {
  const override = opts.home ?? process.env.BOTHREAD_AGENT_HOME;
  const isolated = !!override;
  const home = isolated ? path.resolve(override) : os.homedir();
  const platform = opts.platform ?? process.platform;
  const env = process.env;
  const fromEnv = (name) => (!isolated && env[name] ? env[name] : null);
  return {
    home,
    platform,
    isolated,
    appData: platform === "win32" ? fromEnv("APPDATA") ?? path.join(home, "AppData", "Roaming") : null,
    macSupport: path.join(home, "Library", "Application Support"),
    xdgConfig: fromEnv("XDG_CONFIG_HOME") ?? path.join(home, ".config"),
    codexHome: fromEnv("CODEX_HOME") ?? path.join(home, ".codex"),
    claudeConfigDir: fromEnv("CLAUDE_CONFIG_DIR"),
    pathEnv: opts.pathEnv ?? env.PATH ?? env.Path ?? "",
  };
}

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** `which`: the full path of an executable on PATH, or null. */
function which(cmd, x) {
  const exts = x.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean) : [""];
  for (const dir of x.pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext.toLowerCase());
      const alt = path.join(dir, cmd + ext);
      for (const f of ext ? [full, alt] : [full]) {
        if (!isFile(f)) continue;
        if (x.platform === "win32") return f;
        try {
          fs.accessSync(f, fs.constants.X_OK);
          return f;
        } catch {
          /* not executable */
        }
      }
    }
  }
  return null;
}

/** `~/…` for display. */
export function tildify(p, home = context().home) {
  if (!p) return p;
  const rel = path.relative(home, p);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? `~${path.sep}${rel}` : p;
}

/* ─────────────────────────────── values ─────────────────────────────── */

const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** Two URLs point at the same hub? localhost / 127.x / ::1 are treated as one host. */
function sameUrl(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const loop = (h) => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/i.test(h);
    const hostOk = ua.hostname === ub.hostname || (loop(ua.hostname) && loop(ub.hostname));
    const trim = (p) => p.replace(/\/+$/, "") || "/";
    return ua.protocol === ub.protocol && ua.port === ub.port && hostOk && trim(ua.pathname) === trim(ub.pathname);
  } catch {
    return false;
  }
}

/** Is every key of `want` present in `have` with an equal value? (URLs compared loosely.) */
function covers(want, have) {
  if (typeof want === "string" && typeof have === "string") return want === have || (/^https?:/.test(want) && sameUrl(want, have));
  if (Array.isArray(want)) return Array.isArray(have) && want.length === have.length && want.every((v, i) => covers(v, have[i]));
  if (isPlainObject(want)) return isPlainObject(have) && Object.keys(want).every((k) => covers(want[k], have[k]));
  return want === have;
}

/**
 * Parse JSON that may carry comments and trailing commas (JSONC) — for READING
 * only (detection), never to write back: a rewrite would lose the comments.
 */
function parseLoose(text) {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += ch;
  }
  // Trailing commas: `,` followed only by whitespace before `}` or `]` (outside strings).
  let clean = "";
  inStr = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (inStr) {
      clean += ch;
      if (ch === "\\") clean += out[++i] ?? "";
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    if (ch === ",") {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j])) j++;
      if (out[j] === "}" || out[j] === "]") continue;
    }
    clean += ch;
  }
  return JSON.parse(clean);
}

/** Read a JSON config. strict = plain JSON we may rewrite; loose = what a JSONC read found. */
function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return { exists: false, strict: true, data: null, text: "" };
    return { exists: true, strict: false, data: null, error: err.message, text: "" };
  }
  const body = text.replace(/^﻿/, "");
  if (!body.trim()) return { exists: true, strict: true, data: {}, text };
  try {
    return { exists: true, strict: true, data: JSON.parse(body), text };
  } catch {
    try {
      return { exists: true, strict: false, data: null, loose: parseLoose(body), text };
    } catch {
      return { exists: true, strict: false, data: null, text, error: "not valid JSON" };
    }
  }
}

const eolOf = (text) => (/\r\n/.test(text) ? "\r\n" : "\n");
const withEol = (s, eol) => (eol === "\n" ? s : s.replace(/\n/g, eol));

/* ─────────────────────────────── backups & writes ─────────────────────────────── */

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Copy `file` to `<file>.bothread-backup-<stamp>` (never overwriting an older backup). */
export function backupFile(file) {
  let dest = `${file}.bothread-backup-${stamp()}`;
  for (let n = 1; fs.existsSync(dest); n++) dest = `${file}.bothread-backup-${stamp()}-${n}`;
  fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL);
  try {
    fs.chmodSync(dest, fs.statSync(file).mode & 0o777);
  } catch {
    /* best-effort: keep the same permissions as the original */
  }
  return dest;
}

/** Write in place (follows symlinks — dotfile managers keep working), creating the folder. */
function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

/* ─────────────────────────────── entries & snippets ─────────────────────────────── */

const bearerOf = (token) => (token ? `Bearer ${token}` : null);
const headersObj = (token) => (token ? { headers: { Authorization: bearerOf(token) } } : {});

/** Per-agent JSON config: where the file is, how to spot the agent, and our entry. */
const JSON_SPECS = {
  "claude-desktop": {
    dir: (x) =>
      x.platform === "darwin" ? path.join(x.macSupport, "Claude") : x.platform === "win32" ? path.join(x.appData, "Claude") : path.join(x.xdgConfig, "Claude"),
    file: (x, dir) => path.join(dir, "claude_desktop_config.json"),
    container: ["mcpServers"],
    // Claude Desktop's config file can't hold a remote URL: bridge through mcp-remote (stdio).
    entry: (url, token) => ({ command: "npx", args: ["-y", "mcp-remote", url, ...(token ? ["--header", `Authorization: ${bearerOf(token)}`] : [])] }),
  },
  cursor: {
    dir: (x) => path.join(x.home, ".cursor"),
    file: (x, dir) => path.join(dir, "mcp.json"),
    container: ["mcpServers"],
    entry: (url, token) => ({ url, ...headersObj(token) }),
  },
  windsurf: {
    dir: (x) => path.join(x.home, ".codeium", "windsurf"),
    file: (x, dir) => path.join(dir, "mcp_config.json"),
    container: ["mcpServers"],
    entry: (url, token) => ({ serverUrl: url, ...headersObj(token) }),
  },
  vscode: {
    dir: (x) =>
      x.platform === "darwin"
        ? path.join(x.macSupport, "Code", "User")
        : x.platform === "win32"
          ? path.join(x.appData, "Code", "User")
          : path.join(x.xdgConfig, "Code", "User"),
    file: (x, dir) => path.join(dir, "mcp.json"),
    container: ["servers"],
    entry: (url, token) => ({ type: "http", url, ...headersObj(token) }),
  },
  gemini: {
    dir: (x) => path.join(x.home, ".gemini"),
    // ~/.gemini is shared with Antigravity: count Gemini CLI only when it's on PATH,
    // its settings file exists, or the folder holds more than Antigravity's bits.
    detect: (x, dir) => {
      if (which("gemini", x)) return true;
      if (!isDir(dir)) return false;
      if (isFile(path.join(dir, "settings.json"))) return true;
      try {
        return fs.readdirSync(dir).some((n) => !["antigravity", "config", "antigravity-browser-profile"].includes(n));
      } catch {
        return false;
      }
    },
    file: (x, dir) => path.join(dir, "settings.json"),
    container: ["mcpServers"],
    entry: (url, token) => ({ httpUrl: url, ...headersObj(token) }),
  },
  antigravity: {
    dir: (x) => path.join(x.home, ".gemini", "config"),
    detect: (x) => isDir(path.join(x.home, ".gemini", "config")) || isDir(path.join(x.home, ".gemini", "antigravity")),
    file: (x) => {
      const main = path.join(x.home, ".gemini", "config", "mcp_config.json");
      const alt = path.join(x.home, ".gemini", "antigravity", "mcp_config.json");
      return !isFile(main) && isFile(alt) ? alt : main;
    },
    container: ["mcpServers"],
    entry: (url, token) => ({ serverUrl: url, ...headersObj(token) }),
  },
  opencode: {
    dir: (x) => {
      const main = path.join(x.xdgConfig, "opencode");
      const winAlt = path.join(x.home, ".config", "opencode");
      return x.platform === "win32" && !isDir(main) && isDir(winAlt) ? winAlt : main;
    },
    file: (x, dir) => {
      const json = path.join(dir, "opencode.json");
      const jsonc = path.join(dir, "opencode.jsonc");
      return !isFile(json) && isFile(jsonc) ? jsonc : json;
    },
    container: ["mcp"],
    createExtra: { $schema: "https://opencode.ai/config.json" },
    entry: (url, token) => ({ type: "remote", url, enabled: true, ...headersObj(token) }),
  },
  zed: {
    dir: (x) => (x.platform === "win32" ? path.join(x.appData, "Zed") : path.join(x.xdgConfig, "zed")),
    detect: (x, dir) => isDir(dir) || (x.platform === "darwin" && isDir(path.join(x.macSupport, "Zed"))),
    file: (x, dir) => path.join(dir, "settings.json"),
    container: ["context_servers"],
    entry: (url, token) => ({ source: "custom", type: "http", url, headers: token ? { Authorization: bearerOf(token) } : {} }),
  },
};

/** The manual config snippet for one agent (what `bothread connect <agent>` prints). */
export function snippetFor(id, opts = {}) {
  const url = opts.mcpUrl ?? "http://127.0.0.1:4889/mcp";
  const token = opts.token || null;
  const agent = resolveAgentId(id);
  if (agent === "claude") {
    return token
      ? `claude mcp add --transport http --scope user bothread ${url} \\\n  --header "Authorization: ${bearerOf(token)}"`
      : `claude mcp add --transport http --scope user bothread ${url}`;
  }
  if (agent === "codex") return tomlBlock(url, token).join("\n");
  if (agent === "other") {
    return JSON.stringify(
      { mcpServers: { bothread: { command: "npx", args: ["-y", "mcp-remote@latest", url, ...(token ? ["--header", `Authorization: ${bearerOf(token)}`] : [])] } } },
      null,
      2
    );
  }
  const spec = JSON_SPECS[agent];
  if (!spec) return "";
  const [key] = spec.container;
  const body = { [key]: { [SERVER_NAME]: spec.entry(url, token) } };
  if (agent === "zed") {
    // Zed's settings.json holds everything else too: show just the key to merge in.
    return JSON.stringify(body, null, 2).slice(2, -2).replace(/^ {2}/gm, "");
  }
  return JSON.stringify(agent === "opencode" ? { ...spec.createExtra, ...body } : body, null, 2);
}

/* ─────────────────────────────── Codex (TOML) ─────────────────────────────── */

const tomlStr = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
function tomlBlock(url, token) {
  const lines = ["[mcp_servers.bothread]", `url = ${tomlStr(url)}`];
  if (token) lines.push(`http_headers = { Authorization = ${tomlStr(bearerOf(token))} }`);
  return lines;
}

const BOTHREAD_KEY = `(?:bothread|"bothread"|'bothread')`;
const OUR_HEADER = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*${BOTHREAD_KEY}\\s*\\]\\s*(?:#.*)?$`);
const OUR_SUBTABLE = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*${BOTHREAD_KEY}\\s*\\.[^\\]]*\\]\\s*(?:#.*)?$`);
const ANY_HEADER = /^\s*\[\[?\s*[A-Za-z0-9_\-."' ]+\]\]?\s*(?:#.*)?$/;
const MCP_SERVERS_HEADER = /^\s*\[\s*mcp_servers\s*\]\s*(?:#.*)?$/;

/**
 * Locate our table in config.toml. → { start, end } (inclusive line range, from
 * the header through the last non-blank, non-comment line — trailing comments
 * belong to whatever table follows), plus `other`: bothread defined some other
 * way (inline table, dotted keys) that a line edit can't safely rewrite.
 */
function tomlLocate(lines) {
  let found = null;
  let other = false;
  let section = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ANY_HEADER.test(line)) {
      section = MCP_SERVERS_HEADER.test(line) ? "mcp_servers" : OUR_HEADER.test(line) || OUR_SUBTABLE.test(line) ? "ours" : "other";
      if (OUR_HEADER.test(line) && !found) {
        let last = i;
        let j = i + 1;
        for (; j < lines.length; j++) {
          if (ANY_HEADER.test(lines[j]) && !OUR_SUBTABLE.test(lines[j])) break;
          if (lines[j].trim() && !lines[j].trim().startsWith("#")) last = j;
        }
        found = { start: i, end: last };
      } else if (OUR_SUBTABLE.test(line) && !found) other = true;
      continue;
    }
    if (section === null && new RegExp(`^\\s*mcp_servers\\s*\\.\\s*${BOTHREAD_KEY}\\s*[.=]`).test(line)) other = true;
    if (section === "mcp_servers" && new RegExp(`^\\s*${BOTHREAD_KEY}\\s*[.=]`).test(line)) other = true;
  }
  return { found, other };
}

function tomlState(file, url, token) {
  let text = "";
  let exists = false;
  try {
    text = fs.readFileSync(file, "utf8");
    exists = true;
  } catch (err) {
    if (!err || err.code !== "ENOENT") return { exists: true, error: err.message, hasEntry: false, configured: false, text: "" };
  }
  const lines = text.split(/\r?\n/);
  const { found, other } = tomlLocate(lines);
  let configured = false;
  if (found) {
    const body = lines.slice(found.start, found.end + 1).join("\n");
    const m = body.match(/^\s*url\s*=\s*["']([^"']*)["']/m);
    configured = !!m && !!url && sameUrl(m[1], url) && (!token || body.includes(bearerOf(token)));
  }
  return { exists, text, lines, found, other, hasEntry: !!found || other, configured };
}

/* ─────────────────────────────── Claude Code (CLI) ─────────────────────────────── */

function claudeJsonPath(x) {
  return x.claudeConfigDir ? path.join(x.claudeConfigDir, ".claude.json") : path.join(x.home, ".claude.json");
}

/** Run a command with a timeout, capturing output. Never rejects. */
function run(cmd, args, { env, timeoutMs = 30_000, cwd } = {}) {
  return new Promise((resolve) => {
    const winShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd);
    const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
    let child;
    try {
      child = winShell
        ? spawn([cmd, ...args].map(quote).join(" "), { shell: true, env, cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
        : spawn(cmd, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      resolve({ code: null, stdout: "", stderr: "", error: err.message });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, stdout, stderr, error: `timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, error: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function claudeEnv(x) {
  if (!x.isolated) return process.env;
  const env = { ...process.env, HOME: x.home, USERPROFILE: x.home };
  delete env.CLAUDE_CONFIG_DIR;
  return env;
}

function claudeState(x, url, token) {
  const bin = which("claude", x);
  const file = claudeJsonPath(x);
  const json = readJson(file);
  const obj = json.data ?? json.loose;
  let existing = isPlainObject(obj) && isPlainObject(obj.mcpServers) ? obj.mcpServers[SERVER_NAME] : undefined;
  let hasEntry = existing !== undefined;
  let configured = hasEntry && !!url && covers({ url, ...headersObj(token) }, existing);
  if (json.exists && !obj && bin) {
    // Unreadable ~/.claude.json: ask the CLI instead.
    const r = spawnSync(bin, ["mcp", "get", SERVER_NAME], { env: claudeEnv(x), timeout: 8000, stdio: "ignore", shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(bin) });
    hasEntry = configured = r.status === 0;
  }
  return { bin, file, exists: json.exists, hasEntry, configured, existing };
}

/* ─────────────────────────────── detection ─────────────────────────────── */

function metaOf(id) {
  return AGENTS.find((a) => a.id === id);
}

function detectOne(id, x, url, token) {
  const meta = metaOf(id);
  const base = { id, label: meta.label, restart: meta.restart };
  if (id === "claude") {
    const st = claudeState(x, url, token);
    const detected = !!st.bin || isDir(path.join(x.home, ".claude")) || !!x.claudeConfigDir;
    const out = {
      ...base,
      detected,
      configured: st.configured,
      hasEntry: st.hasEntry,
      canAutoSetup: !!st.bin,
      method: "cli",
      configPath: st.file,
      target: tildify(st.file, x.home),
    };
    if (detected && !st.bin)
      out.note = "The `claude` command isn't on your PATH, so Bothread can't run `claude mcp add` for you — run it yourself (see: bothread connect claude).";
    else if (st.hasEntry && !st.configured) out.note = "Bothread is configured for a different URL — setup will update it.";
    return out;
  }
  if (id === "codex") {
    const file = path.join(x.codexHome, "config.toml");
    const st = tomlState(file, url, token);
    const out = {
      ...base,
      detected: isDir(x.codexHome) || !!which("codex", x),
      configured: st.configured,
      hasEntry: st.hasEntry,
      canAutoSetup: !st.error && !(st.other && !st.found),
      method: "file",
      configPath: file,
      target: tildify(file, x.home),
    };
    if (st.error) out.note = `Can't read ${out.target}: ${st.error}`;
    else if (st.other && !st.found) out.note = `${out.target} defines bothread in a form Bothread won't rewrite — edit it by hand (see: bothread connect codex).`;
    else if (st.hasEntry && !st.configured) out.note = "Bothread is configured for a different URL — setup will update it.";
    return out;
  }
  const spec = JSON_SPECS[id];
  const dir = spec.dir(x);
  const file = spec.file(x, dir);
  const detected = spec.detect ? spec.detect(x, dir) : isDir(dir);
  const json = readJson(file);
  const obj = json.data ?? json.loose;
  const container = isPlainObject(obj) ? getIn(obj, spec.container) : undefined;
  const existing = isPlainObject(container) ? container[SERVER_NAME] : undefined;
  const hasEntry = existing !== undefined;
  const writable = json.strict && (!json.exists || (isPlainObject(json.data) && (container === undefined || isPlainObject(container))));
  const out = {
    ...base,
    detected,
    configured: hasEntry && !!url && covers(spec.entry(url, token), existing),
    hasEntry,
    canAutoSetup: writable,
    method: "file",
    configPath: file,
    target: tildify(file, x.home),
  };
  if (!writable) {
    out.note =
      json.error && json.error !== "not valid JSON"
        ? `Can't read ${out.target}: ${json.error}`
        : json.strict
          ? `${out.target} isn't laid out the way Bothread expects, so it won't rewrite it — paste the snippet by hand (bothread connect ${id}).`
          : `${out.target} has comments or trailing commas, so Bothread won't rewrite it — paste the snippet by hand (bothread connect ${id}).`;
  } else if (hasEntry && !out.configured) out.note = "Bothread is configured for a different URL — setup will update it.";
  return out;
}

function getIn(obj, keys) {
  let cur = obj;
  for (const k of keys) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * Which agents are on this machine, and is Bothread already in their MCP config?
 * One entry per known agent (not `other`), detected or not.
 */
export function detectAgents(opts = {}) {
  const x = context(opts);
  const url = opts.mcpUrl ?? null;
  const token = opts.token || null;
  return AGENTS.filter((a) => a.id !== "other").map((a) => {
    try {
      return detectOne(a.id, x, url, token);
    } catch (err) {
      return { id: a.id, label: a.label, restart: a.restart, detected: false, configured: false, hasEntry: false, canAutoSetup: false, method: "file", note: String(err?.message ?? err) };
    }
  });
}

/* ─────────────────────────────── setup / remove ─────────────────────────────── */

function result(id, fields) {
  const meta = metaOf(id);
  return { id, label: meta?.label ?? id, ok: true, changed: false, action: "unchanged", backup: null, ...fields };
}

function manual(id, x, message, url, token, target) {
  return result(id, { ok: false, action: "manual", message, target, snippet: snippetFor(id, { mcpUrl: url, token }) });
}

/**
 * Point one agent at the hub. → { ok, message, target, backup, changed, action, snippet? }
 * action: "created" | "updated" | "unchanged" | "manual" (couldn't; see message + snippet) | "failed".
 * With dryRun, nothing is written and `changed` says whether something would be.
 */
export async function setupAgent(id, opts = {}) {
  const agent = resolveAgentId(id);
  if (!agent || agent === "other") return result(id, { ok: false, action: "failed", message: `Unknown agent '${id}'.` });
  const x = context(opts);
  const url = opts.mcpUrl;
  if (!url) throw new Error("setupAgent needs mcpUrl");
  const token = opts.token || null;
  const label = metaOf(agent).label;

  if (agent === "claude") return setupClaude(x, url, token, opts);
  if (agent === "codex") {
    const file = path.join(x.codexHome, "config.toml");
    const target = tildify(file, x.home);
    const st = tomlState(file, url, token);
    if (st.error) return manual(agent, x, `Can't read ${target}: ${st.error}`, url, token, target);
    if (st.configured) return result(agent, { message: `${label} already points at Bothread.`, target });
    if (st.other && !st.found) return manual(agent, x, `${target} defines bothread in a form Bothread won't rewrite. Add this by hand:`, url, token, target);
    const eol = eolOf(st.text);
    const block = tomlBlock(url, token);
    let lines = st.lines;
    if (st.found) {
      lines = [...lines.slice(0, st.found.start), ...block, ...lines.slice(st.found.end + 1)];
    } else {
      while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
      lines = lines.length ? [...lines, "", ...block] : [...block];
    }
    let next = lines.join("\n");
    if (!next.endsWith("\n")) next += "\n";
    const action = !st.exists ? "created" : "updated";
    if (opts.dryRun) return result(agent, { changed: true, action, message: `Would ${st.found ? "update [mcp_servers.bothread] in" : "add [mcp_servers.bothread] to"} ${target}.`, target, snippet: block.join("\n") });
    const backup = st.exists ? backupFile(file) : null;
    writeText(file, withEol(next, eol));
    return result(agent, { changed: true, action, backup, target, message: `${st.found ? "Updated [mcp_servers.bothread] in" : "Added [mcp_servers.bothread] to"} ${target}.` });
  }

  const spec = JSON_SPECS[agent];
  const file = spec.file(x, spec.dir(x));
  const target = tildify(file, x.home);
  const json = readJson(file);
  const entry = spec.entry(url, token);
  if (!json.strict) {
    const why = json.error && json.error !== "not valid JSON" ? `Can't read ${target}: ${json.error}.` : `${target} has comments or trailing commas, so Bothread won't rewrite it.`;
    return manual(agent, x, `${why} Paste this in by hand:`, url, token, target);
  }
  const data = json.exists ? json.data : {};
  if (!isPlainObject(data)) return manual(agent, x, `${target} isn't a JSON object. Paste this in by hand:`, url, token, target);
  const container = getIn(data, spec.container);
  if (container !== undefined && !isPlainObject(container))
    return manual(agent, x, `"${spec.container.join(".")}" in ${target} isn't an object. Paste this in by hand:`, url, token, target);
  const existing = isPlainObject(container) ? container[SERVER_NAME] : undefined;
  if (existing !== undefined && covers(entry, existing)) return result(agent, { message: `${label} already points at Bothread.`, target });

  const next = json.exists ? data : { ...(spec.createExtra ?? {}) };
  let cur = next;
  for (const k of spec.container) {
    if (!isPlainObject(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[SERVER_NAME] = entry;
  const action = json.exists ? "updated" : "created";
  const verb = existing !== undefined ? "Updated" : "Added";
  if (opts.dryRun)
    return result(agent, { changed: true, action, target, message: `Would ${verb === "Updated" ? "update" : "add"} "bothread" ${verb === "Updated" ? "in" : "to"} ${target}.`, snippet: snippetFor(agent, { mcpUrl: url, token }) });
  const backup = json.exists ? backupFile(file) : null;
  writeText(file, withEol(JSON.stringify(next, null, 2) + "\n", eolOf(json.text)));
  return result(agent, { changed: true, action, backup, target, message: `${verb} "bothread" ${verb === "Added" ? "to" : "in"} ${target}.` });
}

async function setupClaude(x, url, token, opts) {
  const st = claudeState(x, url, token);
  const target = tildify(st.file, x.home);
  if (st.configured) return result("claude", { message: "Claude Code already points at Bothread.", target });
  if (!st.bin) return manual("claude", x, "The `claude` command isn't on your PATH. Run this yourself once it is:", url, token, target);
  const args = ["mcp", "add", "--transport", "http", "--scope", "user", SERVER_NAME, url];
  if (token) args.push("--header", `Authorization: ${bearerOf(token)}`);
  const action = st.hasEntry ? "updated" : st.exists ? "updated" : "created";
  if (opts.dryRun)
    return result("claude", { changed: true, action, target, message: `Would run: ${snippetFor("claude", { mcpUrl: url, token }).replace(/ \\\n\s*/, " ")}` });
  const env = claudeEnv(x);
  const backup = st.exists ? backupFile(st.file) : null;
  if (st.hasEntry) await run(st.bin, ["mcp", "remove", SERVER_NAME, "--scope", "user"], { env, timeoutMs: 30_000 });
  const r = await run(st.bin, args, { env, timeoutMs: 45_000 });
  if (r.code !== 0) {
    const why = (r.error || r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).split("\n")[0];
    return result("claude", { ok: false, action: "failed", backup, target, message: `\`claude mcp add\` failed: ${why}`, snippet: snippetFor("claude", { mcpUrl: url, token }) });
  }
  return result("claude", { changed: true, action, backup, target, message: `Added "bothread" to Claude Code (user scope) via \`claude mcp add\`.` });
}

/**
 * Take Bothread back out of one agent's config (only our key). A backup is
 * made first, same as setup. → same shape as setupAgent; action "removed" | "unchanged" | …
 */
export async function removeAgent(id, opts = {}) {
  const agent = resolveAgentId(id);
  if (!agent || agent === "other") return result(id, { ok: false, action: "failed", message: `Unknown agent '${id}'.` });
  const x = context(opts);
  const label = metaOf(agent).label;

  if (agent === "claude") {
    const st = claudeState(x, null, null);
    const target = tildify(st.file, x.home);
    if (!st.hasEntry) return result(agent, { message: `${label} doesn't have Bothread configured.`, target });
    if (!st.bin) return result(agent, { ok: false, action: "manual", target, message: "The `claude` command isn't on your PATH. Run: claude mcp remove bothread --scope user" });
    if (opts.dryRun) return result(agent, { changed: true, action: "removed", target, message: "Would run: claude mcp remove bothread --scope user" });
    const backup = st.exists ? backupFile(st.file) : null;
    const r = await run(st.bin, ["mcp", "remove", SERVER_NAME, "--scope", "user"], { env: claudeEnv(x), timeoutMs: 30_000 });
    if (r.code !== 0)
      return result(agent, { ok: false, action: "failed", backup, target, message: `\`claude mcp remove\` failed: ${(r.error || r.stderr.trim() || `exit ${r.code}`).split("\n")[0]}` });
    return result(agent, { changed: true, action: "removed", backup, target, message: "Removed bothread from Claude Code (user scope)." });
  }

  if (agent === "codex") {
    const file = path.join(x.codexHome, "config.toml");
    const target = tildify(file, x.home);
    const st = tomlState(file, null, null);
    if (st.error) return result(agent, { ok: false, action: "failed", target, message: `Can't read ${target}: ${st.error}` });
    if (!st.found) {
      if (st.other) return result(agent, { ok: false, action: "manual", target, message: `${target} defines bothread in a form Bothread won't rewrite — remove it by hand.` });
      return result(agent, { message: `${label} doesn't have Bothread configured.`, target });
    }
    if (opts.dryRun) return result(agent, { changed: true, action: "removed", target, message: `Would remove [mcp_servers.bothread] from ${target}.` });
    const lines = [...st.lines];
    lines.splice(st.found.start, st.found.end - st.found.start + 1);
    // Don't leave a double blank line where the table was.
    const at = st.found.start;
    if (at > 0 && lines[at - 1]?.trim() === "" && (lines[at] === undefined || lines[at].trim() === "")) lines.splice(at - 1, 1);
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    const next = lines.length ? lines.join("\n") + "\n" : "";
    const backup = backupFile(file);
    writeText(file, withEol(next, eolOf(st.text)));
    return result(agent, { changed: true, action: "removed", backup, target, message: `Removed [mcp_servers.bothread] from ${target}.` });
  }

  const spec = JSON_SPECS[agent];
  const file = spec.file(x, spec.dir(x));
  const target = tildify(file, x.home);
  const json = readJson(file);
  if (!json.exists) return result(agent, { message: `${label} doesn't have Bothread configured.`, target });
  if (!json.strict) {
    const obj = json.loose;
    const has = isPlainObject(obj) && isPlainObject(getIn(obj, spec.container)) && getIn(obj, spec.container)[SERVER_NAME] !== undefined;
    if (!has) return result(agent, { message: `${label} doesn't have Bothread configured.`, target });
    return result(agent, { ok: false, action: "manual", target, message: `${target} has comments or trailing commas, so Bothread won't rewrite it — delete the "bothread" entry by hand.` });
  }
  const container = isPlainObject(json.data) ? getIn(json.data, spec.container) : undefined;
  if (!isPlainObject(container) || container[SERVER_NAME] === undefined) return result(agent, { message: `${label} doesn't have Bothread configured.`, target });
  if (opts.dryRun) return result(agent, { changed: true, action: "removed", target, message: `Would remove "bothread" from ${target}.` });
  delete container[SERVER_NAME];
  const backup = backupFile(file);
  writeText(file, withEol(JSON.stringify(json.data, null, 2) + "\n", eolOf(json.text)));
  return result(agent, { changed: true, action: "removed", backup, target, message: `Removed "bothread" from ${target}.` });
}
