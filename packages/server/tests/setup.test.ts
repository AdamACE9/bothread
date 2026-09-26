import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectAgents, removeAgent, setupAgent, snippetFor } from "../../../bin/lib/agents.mjs";
import { openDatabase } from "../src/db/database";
import { Engine } from "../src/engine/engine";
import { buildApp, isLoopbackRemote } from "../src/http";
import { McpHub } from "../src/mcp/transport";
import { RoomBus } from "../src/realtime";

/**
 * One-command agent setup: bin/lib/agents.mjs (detection + config writing),
 * `bothread setup`, and the hub's /api/agents endpoints — always against a
 * throwaway fake home, never the real one.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const bin = path.join(repoRoot, "bin", "bothread.mjs");
const MCP = "http://127.0.0.1:4889/mcp";

const tmpDirs: string[] = [];
function tmpDir(prefix = "bothread-home-"): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** A fake home with these folders (relative to it) created. */
function fakeHome(dirs: string[]): string {
  const home = tmpDir();
  for (const d of dirs) fs.mkdirSync(path.join(home, d), { recursive: true });
  return home;
}
const opts = (home: string, extra: Record<string, unknown> = {}) => ({ home, mcpUrl: MCP, pathEnv: "", platform: "linux" as NodeJS.Platform, ...extra });
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const backupsOf = (file: string) =>
  fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith(`${path.basename(file)}.bothread-backup-`));

/**
 * A stand-in `claude` CLI: records its arguments and edits $HOME/.claude.json
 * the way `claude mcp add|remove|get --scope user` does.
 */
function fakeClaudeBin(): string {
  const dir = tmpDir("bothread-bin-");
  const script = `#!${process.execPath}
const fs = require("fs");
const path = require("path");
const file = path.join(process.env.HOME, ".claude.json");
const args = process.argv.slice(2);
fs.appendFileSync(path.join(process.env.HOME, "claude-calls.log"), JSON.stringify(args) + "\\n");
let data = {};
try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
data.mcpServers = data.mcpServers || {};
const pos = [];
const opt = {};
for (let i = 2; i < args.length; i++) {
  if (args[i].startsWith("--")) opt[args[i].slice(2)] = args[++i];
  else pos.push(args[i]);
}
if (args[1] === "add") {
  if (data.mcpServers[pos[0]]) { console.error("MCP server " + pos[0] + " already exists"); process.exit(1); }
  const entry = { type: opt.transport, url: pos[1] };
  if (opt.header) { const [k, ...v] = opt.header.split(":"); entry.headers = { [k.trim()]: v.join(":").trim() }; }
  data.mcpServers[pos[0]] = entry;
} else if (args[1] === "remove") {
  if (!data.mcpServers[pos[0]]) process.exit(1);
  delete data.mcpServers[pos[0]];
} else if (args[1] === "get") {
  process.exit(data.mcpServers[pos[0]] ? 0 : 1);
}
fs.writeFileSync(file, JSON.stringify(data, null, 2));
`;
  const file = path.join(dir, "claude");
  fs.writeFileSync(file, script, { mode: 0o755 });
  return dir;
}

const ALL_DIRS = [
  ".cursor",
  ".codex",
  ".gemini/config",
  ".config/opencode",
  ".codeium/windsurf",
  ".config/Claude",
  ".config/Code/User",
  ".config/zed",
];

describe("detectAgents", () => {
  it("finds agents by their folders and reports what's configured", () => {
    const home = fakeHome([...ALL_DIRS, ".claude"]);
    write(path.join(home, ".gemini", "settings.json"), "{}");
    const byId = Object.fromEntries(detectAgents(opts(home)).map((a) => [a.id, a]));
    for (const id of ["cursor", "codex", "gemini", "antigravity", "opencode", "windsurf", "claude-desktop", "vscode", "zed", "claude"]) {
      expect(byId[id]?.detected, id).toBe(true);
      expect(byId[id]?.configured, id).toBe(false);
    }
    expect(byId["other"]).toBeUndefined();
    expect(byId["cursor"]!.target).toBe(path.join("~", ".cursor", "mcp.json"));
    expect(byId["cursor"]!.configPath).toBe(path.join(home, ".cursor", "mcp.json"));
    expect(byId["claude-desktop"]!.configPath).toBe(path.join(home, ".config", "Claude", "claude_desktop_config.json"));
    expect(byId["cursor"]!.canAutoSetup).toBe(true);
    // ~/.claude exists but no `claude` on PATH: can't run `claude mcp add` for you.
    expect(byId["claude"]!.canAutoSetup).toBe(false);
    expect(byId["claude"]!.note).toContain("claude");
  });

  it("detects nothing in an empty home, and Antigravity alone doesn't count as Gemini CLI", () => {
    expect(detectAgents(opts(fakeHome([]))).filter((a) => a.detected)).toEqual([]);
    const home = fakeHome([".gemini/antigravity"]);
    const byId = Object.fromEntries(detectAgents(opts(home)).map((a) => [a.id, a]));
    expect(byId["antigravity"]!.detected).toBe(true);
    expect(byId["gemini"]!.detected).toBe(false);
  });
});

describe("setupAgent", () => {
  it("writes the right shape for every JSON client", async () => {
    const home = fakeHome(ALL_DIRS);
    for (const id of ["cursor", "windsurf", "vscode", "gemini", "antigravity", "opencode", "claude-desktop", "zed"]) {
      const r = await setupAgent(id, opts(home));
      expect(r, id).toMatchObject({ ok: true, changed: true, action: "created", backup: null });
    }
    const f = (...p: string[]) => readJson(path.join(home, ...p));
    expect(f(".cursor", "mcp.json")).toEqual({ mcpServers: { bothread: { url: MCP } } });
    expect(f(".codeium", "windsurf", "mcp_config.json")).toEqual({ mcpServers: { bothread: { serverUrl: MCP } } });
    expect(f(".config", "Code", "User", "mcp.json")).toEqual({ servers: { bothread: { type: "http", url: MCP } } });
    expect(f(".gemini", "settings.json")).toEqual({ mcpServers: { bothread: { httpUrl: MCP } } });
    expect(f(".gemini", "config", "mcp_config.json")).toEqual({ mcpServers: { bothread: { serverUrl: MCP } } });
    expect(f(".config", "opencode", "opencode.json")).toEqual({
      $schema: "https://opencode.ai/config.json",
      mcp: { bothread: { type: "remote", url: MCP, enabled: true } },
    });
    expect(f(".config", "Claude", "claude_desktop_config.json")).toEqual({
      mcpServers: { bothread: { command: "npx", args: ["-y", "mcp-remote", MCP] } },
    });
    expect(f(".config", "zed", "settings.json")).toEqual({
      context_servers: { bothread: { source: "custom", type: "http", url: MCP, headers: {} } },
    });
    // 2-space indent + trailing newline.
    expect(fs.readFileSync(path.join(home, ".cursor", "mcp.json"), "utf8")).toBe(
      JSON.stringify({ mcpServers: { bothread: { url: MCP } } }, null, 2) + "\n"
    );
    // Now everything reads as configured.
    const configured = detectAgents(opts(home)).filter((a) => a.configured).map((a) => a.id);
    expect(configured.sort()).toEqual(["antigravity", "claude-desktop", "cursor", "gemini", "opencode", "vscode", "windsurf", "zed"]);
  });

  it("keeps unrelated keys, backs up an existing file, and is idempotent", async () => {
    const home = fakeHome([".cursor", ".codeium/windsurf"]);
    const file = path.join(home, ".cursor", "mcp.json");
    const original = JSON.stringify({ theme: "dark", mcpServers: { github: { command: "gh-mcp", args: ["serve"] } } }, null, 4);
    write(file, original);

    const first = await setupAgent("cursor", opts(home));
    expect(first).toMatchObject({ ok: true, changed: true, action: "updated" });
    expect(first.backup).toMatch(/mcp\.json\.bothread-backup-\d{8}-\d{6}$/);
    expect(fs.readFileSync(first.backup!, "utf8")).toBe(original);
    expect(readJson(file)).toEqual({ theme: "dark", mcpServers: { github: { command: "gh-mcp", args: ["serve"] }, bothread: { url: MCP } } });

    const after = fs.readFileSync(file, "utf8");
    const second = await setupAgent("cursor", opts(home));
    expect(second).toMatchObject({ ok: true, changed: false, action: "unchanged", backup: null });
    expect(fs.readFileSync(file, "utf8")).toBe(after);
    expect(backupsOf(file)).toHaveLength(1);

    // A file that didn't exist gets no backup.
    const ws = await setupAgent("windsurf", opts(home));
    expect(ws.backup).toBeNull();
    expect(backupsOf(path.join(home, ".codeium", "windsurf", "mcp_config.json"))).toEqual([]);
  });

  it("points an entry for another URL at this hub (localhost counts as 127.0.0.1)", async () => {
    const home = fakeHome([".cursor"]);
    const file = path.join(home, ".cursor", "mcp.json");
    write(file, JSON.stringify({ mcpServers: { bothread: { url: "http://localhost:4889/mcp" } } }));
    expect(detectAgents(opts(home)).find((a) => a.id === "cursor")!.configured).toBe(true);

    const other = opts(home, { mcpUrl: "http://127.0.0.1:4999/mcp" });
    const det = detectAgents(other).find((a) => a.id === "cursor")!;
    expect(det).toMatchObject({ configured: false, hasEntry: true });
    const r = await setupAgent("cursor", other);
    expect(r).toMatchObject({ changed: true, action: "updated" });
    expect(readJson(file).mcpServers.bothread).toEqual({ url: "http://127.0.0.1:4999/mcp" });
  });

  it("refuses to rewrite a JSONC file and hands back the snippet", async () => {
    const home = fakeHome([".config/zed", ".cursor"]);
    const file = path.join(home, ".config", "zed", "settings.json");
    const jsonc = `// Zed settings\n{\n  "theme": "One Dark", // mine\n  "vim_mode": true,\n}\n`;
    write(file, jsonc);

    const det = detectAgents(opts(home)).find((a) => a.id === "zed")!;
    expect(det).toMatchObject({ detected: true, configured: false, canAutoSetup: false });
    expect(det.note).toContain("comments");

    const r = await setupAgent("zed", opts(home));
    expect(r).toMatchObject({ ok: false, changed: false, action: "manual", backup: null });
    expect(r.message).toContain("comments");
    expect(r.snippet).toContain('"context_servers"');
    expect(r.snippet).toContain(MCP);
    expect(fs.readFileSync(file, "utf8")).toBe(jsonc);
    expect(backupsOf(file)).toEqual([]);

    // A JSONC file that already has our entry still reads as configured.
    write(path.join(home, ".cursor", "mcp.json"), `{\n  // hi\n  "mcpServers": { "bothread": { "url": "${MCP}" }, },\n}`);
    expect(detectAgents(opts(home)).find((a) => a.id === "cursor")!.configured).toBe(true);
  });

  it("codex: appends a table, or replaces ours in place, never touching other tables", async () => {
    const home = fakeHome([".codex"]);
    const file = path.join(home, ".codex", "config.toml");
    const base = `model = "o3"\n\n[mcp_servers.github]\ncommand = "gh-mcp"\nargs = ["serve"]\n\n# profiles\n[profiles.fast]\nmodel = "o4-mini"\n`;
    write(file, base);

    const add = await setupAgent("codex", opts(home));
    expect(add).toMatchObject({ ok: true, changed: true });
    expect(fs.readFileSync(file, "utf8")).toBe(`${base}\n[mcp_servers.bothread]\nurl = "${MCP}"\n`);
    expect(fs.readFileSync(add.backup!, "utf8")).toBe(base);
    expect((await setupAgent("codex", opts(home))).changed).toBe(false);
    expect(backupsOf(file)).toHaveLength(1);

    // Ours in the middle, with a subtable: replaced in place; neighbors intact.
    const middle =
      `model = "o3"\n\n[mcp_servers.bothread]\nurl = "http://127.0.0.1:1111/mcp"\nstartup_timeout_sec = 5\n\n[mcp_servers.bothread.env]\nX = "1"\n\n` +
      `# github below\n[mcp_servers.github]\ncommand = "gh-mcp"\n`;
    write(file, middle);
    const rep = await setupAgent("codex", opts(home, { token: "sekret" }));
    expect(rep).toMatchObject({ ok: true, changed: true, action: "updated" });
    expect(fs.readFileSync(file, "utf8")).toBe(
      `model = "o3"\n\n[mcp_servers.bothread]\nurl = "${MCP}"\nhttp_headers = { Authorization = "Bearer sekret" }\n\n# github below\n[mcp_servers.github]\ncommand = "gh-mcp"\n`
    );
    expect(detectAgents(opts(home, { token: "sekret" })).find((a) => a.id === "codex")!.configured).toBe(true);

    // Remove: only our table goes.
    const rm = await removeAgent("codex", opts(home));
    expect(rm).toMatchObject({ ok: true, changed: true, action: "removed" });
    expect(fs.readFileSync(file, "utf8")).toBe(`model = "o3"\n\n# github below\n[mcp_servers.github]\ncommand = "gh-mcp"\n`);
    expect((await removeAgent("codex", opts(home))).changed).toBe(false);

    // Creating the file from nothing.
    const fresh = fakeHome([".codex"]);
    await setupAgent("codex", opts(fresh));
    expect(fs.readFileSync(path.join(fresh, ".codex", "config.toml"), "utf8")).toBe(`[mcp_servers.bothread]\nurl = "${MCP}"\n`);
  });

  it("codex: an inline-table definition is left for the user", async () => {
    const home = fakeHome([".codex"]);
    const file = path.join(home, ".codex", "config.toml");
    const text = `[mcp_servers]\nbothread = { url = "http://x/mcp" }\n`;
    write(file, text);
    expect(detectAgents(opts(home)).find((a) => a.id === "codex")!.canAutoSetup).toBe(false);
    const r = await setupAgent("codex", opts(home));
    expect(r).toMatchObject({ ok: false, action: "manual" });
    expect(fs.readFileSync(file, "utf8")).toBe(text);
  });

  it("adds the bearer header in each client's format when auth is on", async () => {
    const home = fakeHome(ALL_DIRS);
    const o = opts(home, { token: "tok123" });
    for (const id of ["cursor", "windsurf", "vscode", "gemini", "antigravity", "opencode", "claude-desktop", "zed"]) await setupAgent(id, o);
    const auth = { Authorization: "Bearer tok123" };
    const f = (...p: string[]) => readJson(path.join(home, ...p));
    expect(f(".cursor", "mcp.json").mcpServers.bothread).toEqual({ url: MCP, headers: auth });
    expect(f(".codeium", "windsurf", "mcp_config.json").mcpServers.bothread).toEqual({ serverUrl: MCP, headers: auth });
    expect(f(".config", "Code", "User", "mcp.json").servers.bothread).toEqual({ type: "http", url: MCP, headers: auth });
    expect(f(".gemini", "settings.json").mcpServers.bothread).toEqual({ httpUrl: MCP, headers: auth });
    expect(f(".config", "opencode", "opencode.json").mcp.bothread).toEqual({ type: "remote", url: MCP, enabled: true, headers: auth });
    expect(f(".config", "zed", "settings.json").context_servers.bothread.headers).toEqual(auth);
    expect(f(".config", "Claude", "claude_desktop_config.json").mcpServers.bothread.args).toEqual([
      "-y",
      "mcp-remote",
      MCP,
      "--header",
      "Authorization: Bearer tok123",
    ]);
    // A new token means "not configured" until setup runs again.
    expect(detectAgents(opts(home, { token: "other" })).find((a) => a.id === "cursor")!.configured).toBe(false);
    expect(snippetFor("claude", { mcpUrl: MCP, token: "tok123" })).toContain('--header "Authorization: Bearer tok123"');
  });

  it("removal takes out only our key, with a backup", async () => {
    const home = fakeHome([".cursor"]);
    const file = path.join(home, ".cursor", "mcp.json");
    write(file, JSON.stringify({ mcpServers: { github: { command: "gh" } }, keep: true }));
    await setupAgent("cursor", opts(home));
    const r = await removeAgent("cursor", opts(home));
    expect(r).toMatchObject({ ok: true, changed: true, action: "removed" });
    expect(readJson(file)).toEqual({ mcpServers: { github: { command: "gh" } }, keep: true });
    expect(backupsOf(file)).toHaveLength(2);
    expect(readJson(path.join(path.dirname(file), backupsOf(file).sort()[1]!)).mcpServers.bothread).toEqual({ url: MCP });
    expect(await removeAgent("cursor", opts(home))).toMatchObject({ changed: false, action: "unchanged" });
    expect(backupsOf(file)).toHaveLength(2);
    // Nothing there at all → nothing to do, nothing created.
    const empty = fakeHome([".codeium/windsurf"]);
    expect((await removeAgent("windsurf", opts(empty))).changed).toBe(false);
    expect(fs.existsSync(path.join(empty, ".codeium", "windsurf", "mcp_config.json"))).toBe(false);
  });

  it("dry run writes nothing", async () => {
    const home = fakeHome([".cursor"]);
    const r = await setupAgent("cursor", opts(home, { dryRun: true }));
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(r.snippet).toContain(MCP);
    expect(fs.existsSync(path.join(home, ".cursor", "mcp.json"))).toBe(false);
  });

  // Uses a fake `claude` shell script on PATH, which Windows can't execute.
  it.skipIf(process.platform === "win32")("claude: runs `claude mcp add --scope user` (and only when needed)", async () => {
    const home = fakeHome([".claude"]);
    const binDir = fakeClaudeBin();
    const o = opts(home, { pathEnv: binDir });
    expect(detectAgents(o).find((a) => a.id === "claude")).toMatchObject({ detected: true, configured: false, canAutoSetup: true, method: "cli" });

    const r = await setupAgent("claude", o);
    expect(r).toMatchObject({ ok: true, changed: true });
    const calls = () => fs.readFileSync(path.join(home, "claude-calls.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(calls()).toEqual([["mcp", "add", "--transport", "http", "--scope", "user", "bothread", MCP]]);
    expect(readJson(path.join(home, ".claude.json")).mcpServers.bothread).toEqual({ type: "http", url: MCP });
    expect(detectAgents(o).find((a) => a.id === "claude")!.configured).toBe(true);

    expect((await setupAgent("claude", o)).changed).toBe(false);
    expect(calls()).toHaveLength(1);

    // A token change: remove + re-add with the header.
    const withTok = await setupAgent("claude", { ...o, token: "t0k" });
    expect(withTok).toMatchObject({ ok: true, changed: true });
    expect(withTok.backup).toBeTruthy();
    expect(calls().slice(1)).toEqual([
      ["mcp", "remove", "bothread", "--scope", "user"],
      ["mcp", "add", "--transport", "http", "--scope", "user", "bothread", MCP, "--header", "Authorization: Bearer t0k"],
    ]);
    expect((await removeAgent("claude", o)).action).toBe("removed");
    expect(readJson(path.join(home, ".claude.json")).mcpServers.bothread).toBeUndefined();
  });
});

/* ───────────────────────────── the CLI ───────────────────────────── */

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function cli(args: string[], home: string, binDir = tmpDir("bothread-emptybin-")) {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("BOTHREAD_") && k !== "FORCE_COLOR") env[k] = v;
  Object.assign(env, {
    NO_COLOR: "1",
    BOTHREAD_NO_TELEMETRY: "1",
    BOTHREAD_NO_OPEN: "1",
    BOTHREAD_AGENT_HOME: home,
    BOTHREAD_HOME: path.join(home, ".bothread-data"),
    PATH: binDir, // only a fake `claude` (or nothing) — never a real agent CLI
  });
  const r = spawnSync(process.execPath, [bin, ...args], { cwd: repoRoot, env, encoding: "utf8", timeout: 30_000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("bothread setup (CLI)", () => {
  // Uses a fake `claude` shell script on PATH, which Windows can't execute.
  it.skipIf(process.platform === "win32")("--yes --json connects every detected agent that isn't connected", async () => {
    const home = fakeHome([".cursor", ".codex", ".claude", ".config/zed"]);
    write(path.join(home, ".config", "zed", "settings.json"), `{\n  // comment\n}\n`);
    write(path.join(home, ".codex", "config.toml"), `model = "o3"\n`);
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/mcp`;
    const r = cli(["setup", "--yes", "--json", "--port", String(port)], home, fakeClaudeBin());
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ ok: true, dryRun: false, remove: false, mcpUrl: url, hubRunning: false });
    const res = Object.fromEntries(out.results.map((x: { id: string }) => [x.id, x]));
    expect(Object.keys(res).sort()).toEqual(["claude", "codex", "cursor", "zed"]);
    expect(res.cursor).toMatchObject({ ok: true, changed: true, action: "created", backup: null });
    expect(res.codex).toMatchObject({ ok: true, changed: true });
    expect(res.codex.backup).toBeTruthy();
    expect(res.claude).toMatchObject({ ok: true, changed: true });
    expect(res.zed).toMatchObject({ ok: false, action: "manual" });
    expect(res.zed.snippet).toContain("context_servers");
    expect(out.skill).toMatchObject({ installed: false, skipped: true }); // never auto-installed unattended
    expect(out.nextSteps.join("\n")).toContain("This is a Bothread session");
    expect(readJson(path.join(home, ".cursor", "mcp.json"))).toEqual({ mcpServers: { bothread: { url } } });
    expect(fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8")).toBe(`model = "o3"\n\n[mcp_servers.bothread]\nurl = "${url}"\n`);
    expect(readJson(path.join(home, ".claude.json")).mcpServers.bothread).toEqual({ type: "http", url });

    // Second run: nothing left to do.
    const again = JSON.parse(cli(["setup", "--yes", "--json", "--port", String(port)], home, fakeClaudeBin()).stdout);
    expect(again.results.map((x: { id: string }) => x.id)).toEqual(["zed"]);
    expect(backupsOf(path.join(home, ".codex", "config.toml"))).toHaveLength(1);
  });

  it("--dry-run --json reports the plan and writes nothing", async () => {
    const home = fakeHome([".cursor", ".codeium/windsurf"]);
    const port = await freePort();
    const r = cli(["setup", "--dry-run", "--json", "--port", String(port)], home);
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.dryRun).toBe(true);
    expect(out.results.map((x: { id: string; changed: boolean }) => [x.id, x.changed])).toEqual([
      ["cursor", true],
      ["windsurf", true],
    ]);
    expect(fs.existsSync(path.join(home, ".cursor", "mcp.json"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".codeium", "windsurf", "mcp_config.json"))).toBe(false);
  });

  // Uses a fake `claude` shell script on PATH, which Windows can't execute.
  it.skipIf(process.platform === "win32")("--only and --remove, plus a helpful error for an unknown agent", async () => {
    const home = fakeHome([".cursor", ".codex"]);
    const port = String(await freePort());
    const only = JSON.parse(cli(["setup", "--only", "cursor", "--json", "--port", port], home, fakeClaudeBin()).stdout);
    expect(only.results.map((x: { id: string }) => x.id)).toEqual(["cursor"]);
    expect(fs.existsSync(path.join(home, ".codex", "config.toml"))).toBe(false);

    const rm = cli(["setup", "--remove", "--yes", "--json", "--port", port], home, fakeClaudeBin());
    expect(rm.code, rm.stderr).toBe(0);
    expect(JSON.parse(rm.stdout).results).toMatchObject([{ id: "cursor", action: "removed" }]);
    expect(readJson(path.join(home, ".cursor", "mcp.json"))).toEqual({ mcpServers: {} });

    const bad = cli(["setup", "--only", "cursr", "--port", port], home, fakeClaudeBin());
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("Unknown agent 'cursr'. Did you mean 'cursor'?");
  });

  it("prints a readable, uncolored plan when piped", async () => {
    const home = fakeHome([".cursor"]);
    const r = cli(["setup", "--dry-run", "--port", String(await freePort())], home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("Found 1 AI coding agent");
    expect(r.stdout).toContain("Cursor");
    expect(r.stdout).toContain("Dry run — nothing was written.");
    expect(r.stdout).not.toMatch(/\x1b\[/);
  });
});

/* ───────────────────────────── the hub API ───────────────────────────── */

describe("/api/agents", () => {
  let home = "";
  let server: http.Server;
  let base = "";
  let port = 0;
  const saved = process.env.BOTHREAD_AGENT_HOME;

  beforeAll(async () => {
    home = fakeHome([".cursor", ".codex"]);
    process.env.BOTHREAD_AGENT_HOME = home;
    const engine = new Engine(openDatabase(":memory:"), new RoomBus());
    const bus = new RoomBus();
    const hub = new McpHub(engine);
    const config = { host: "127.0.0.1", port: 4889, dbPath: ":memory:", installToken: null, authRequired: false };
    const { app } = buildApp({ engine, bus, hub, config, token: "test" });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
    port = (server.address() as net.AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    if (saved === undefined) delete process.env.BOTHREAD_AGENT_HOME;
    else process.env.BOTHREAD_AGENT_HOME = saved;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("lists agents and sets one up (in the fake home)", async () => {
    const list = (await (await fetch(`${base}/api/agents`)).json()) as { agents: { id: string; detected: boolean; configured: boolean; canAutoSetup: boolean; target?: string }[] };
    const cursor = list.agents.find((a) => a.id === "cursor")!;
    expect(cursor).toMatchObject({ detected: true, configured: false, canAutoSetup: true });
    expect(cursor.target).toBe(path.join("~", ".cursor", "mcp.json"));

    const res = await fetch(`${base}/api/agents/cursor/setup`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; message: string; target: string };
    expect(body.ok).toBe(true);
    expect(body.message).toContain("Restart Cursor");
    expect(readJson(path.join(home, ".cursor", "mcp.json"))).toEqual({ mcpServers: { bothread: { url: "http://127.0.0.1:4889/mcp" } } });

    const again = (await (await fetch(`${base}/api/agents`)).json()) as { agents: { id: string; configured: boolean }[] };
    expect(again.agents.find((a) => a.id === "cursor")!.configured).toBe(true);

    const rm = (await (await fetch(`${base}/api/agents/cursor/remove`, { method: "POST" })).json()) as { ok: boolean };
    expect(rm.ok).toBe(true);
    expect(readJson(path.join(home, ".cursor", "mcp.json"))).toEqual({ mcpServers: {} });

    expect((await fetch(`${base}/api/agents/nope/setup`, { method: "POST" })).status).toBe(404);
  });

  it("refuses browsers from other sites", async () => {
    const res = await fetch(`${base}/api/agents/cursor/setup`, { method: "POST", headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("only loopback peers may touch agent configs", async () => {
    expect(isLoopbackRemote("127.0.0.1")).toBe(true);
    expect(isLoopbackRemote("::1")).toBe(true);
    expect(isLoopbackRemote("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackRemote("127.8.9.10")).toBe(true);
    expect(isLoopbackRemote("192.168.1.20")).toBe(false);
    expect(isLoopbackRemote("::ffff:10.0.0.5")).toBe(false);
    expect(isLoopbackRemote("fe80::1")).toBe(false);
    expect(isLoopbackRemote(undefined)).toBe(false);
  });

  // End to end over a real non-loopback interface, when this machine has one.
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  it.skipIf(!lan)("answers 403 to a peer on the network, even with a loopback Host header", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: lan, port, path: "/api/agents", method: "GET", headers: { host: `127.0.0.1:${port}` }, agent: false },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
    expect(fs.existsSync(path.join(home, ".codex", "config.toml"))).toBe(false);
  });
});
