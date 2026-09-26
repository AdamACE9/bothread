import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database";
import { Engine } from "../src/engine/engine";
import { buildApp } from "../src/http";
import { McpHub } from "../src/mcp/transport";
import { RoomBus } from "../src/realtime";

/**
 * Agent reliability: the read cursor behind read_messages({ unreadOnly }),
 * GET /api/agent-status, and `bothread hooks` (install / uninstall / status / run).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const bin = path.join(repoRoot, "bin", "bothread.mjs");

const tmpDirs: string[] = [];
function tmpDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function roomWithAgents(engine: Engine, projectPath?: string) {
  const { room, sessionId } = engine.createRoom({ name: "feat", projectPath });
  engine.joinSession("mcp-a", { sessionId, agentName: "Claude Code", brand: "claude" });
  engine.joinSession("mcp-b", { sessionId, agentName: "Cursor", brand: "cursor" });
  return { room, a: engine.resolveCaller("mcp-a"), b: engine.resolveCaller("mcp-b") };
}

describe("read cursor (read_messages unreadOnly)", () => {
  it("returns only messages not yet shown, excluding your own, and advances", () => {
    const engine = new Engine(openDatabase(":memory:"), new RoomBus());
    const { a, b } = roomWithAgents(engine);
    // Cursor's join snapshot showed everything so far.
    expect(engine.readMessages(b, { unreadOnly: true }).messages).toEqual([]);

    engine.sendMessage(a, { text: "one" });
    engine.sendMessage(a, { text: "two" });
    const first = engine.readMessages(b, { unreadOnly: true });
    expect(first.messages.map((m) => m.text)).toEqual(["one", "two"]);
    expect(first.readCursor).toBe(first.latestSeq);
    expect(engine.readMessages(b, { unreadOnly: true }).messages).toEqual([]);

    // Own messages are never unread, but the cursor moves past them.
    engine.sendMessage(b, { text: "mine" });
    expect(engine.readMessages(b, { unreadOnly: true }).messages).toEqual([]);
    expect(engine.readCursor(b.participant.id)).toBe(engine.latestSeq(b.room.id));

    // Paging with limit: the cursor only covers what was returned.
    for (const t of ["p1", "p2", "p3"]) engine.sendMessage(a, { text: t });
    expect(engine.readMessages(b, { unreadOnly: true, limit: 2 }).messages.map((m) => m.text)).toEqual(["p1", "p2"]);
    expect(engine.readMessages(b, { unreadOnly: true, limit: 2 }).messages.map((m) => m.text)).toEqual(["p3"]);
  });

  it("is a high-water mark: since/plain reads, snapshots and wait_for_update advance it; it never goes back", async () => {
    const engine = new Engine(openDatabase(":memory:"), new RoomBus());
    const { room, a, b } = roomWithAgents(engine);
    const s1 = engine.sendMessage(a, { text: "x" }).seq;
    engine.sendMessage(a, { text: "y" });
    // A plain page read (most recent page) marks everything shown.
    engine.readMessages(b, {});
    expect(engine.readCursor(b.participant.id)).toBe(engine.latestSeq(room.id));
    // Re-reading history doesn't move it backwards.
    engine.readMessages(b, { since: 0, limit: 1 });
    expect(engine.readCursor(b.participant.id)).toBe(engine.latestSeq(room.id));
    expect(s1).toBeGreaterThan(0);

    engine.sendMessage(a, { text: "z" });
    const w = await engine.waitForUpdate(b, { since: engine.latestSeq(room.id) - 1, maxWaitMs: 10 });
    expect(w.newMessages.map((m) => m.text)).toEqual(["z"]);
    expect(engine.readMessages(b, { unreadOnly: true }).messages).toEqual([]);

    engine.sendMessage(a, { text: "snap" });
    engine.snapshotForAgent(room, b.participant); // get_room_state
    expect(engine.readMessages(b, { unreadOnly: true }).messages).toEqual([]);

    // since + unreadOnly: the later of the two wins.
    engine.sendMessage(a, { text: "q1" });
    const q2 = engine.sendMessage(a, { text: "q2" }).seq;
    expect(engine.readMessages(b, { unreadOnly: true, since: q2 - 1 }).messages.map((m) => m.text)).toEqual(["q2"]);
    expect(engine.readMessages(b, { unreadOnly: true }).messages).toEqual([]);
  });

  it("mentionsMe matches case-insensitively and the read still moves the cursor", () => {
    const engine = new Engine(openDatabase(":memory:"), new RoomBus());
    const { a, b } = roomWithAgents(engine);
    engine.sendMessage(a, { text: "fyi" });
    engine.sendMessage(a, { text: "@cursor look", mentions: ["cursor"] });
    expect(engine.readMessages(b, { unreadOnly: true, mentionsMe: true }).messages.map((m) => m.text)).toEqual(["@cursor look"]);
    expect(engine.readMessages(b, { unreadOnly: true }).messages).toEqual([]);
  });
});

describe("Engine.agentStatus", () => {
  it("counts unread mentions/interrupts, owned in-progress tasks, hand-offs waiting, pause", () => {
    const engine = new Engine(openDatabase(":memory:"), new RoomBus());
    const dir = tmpDir("bothread-hooks-");
    const { room, a, b } = roomWithAgents(engine, dir);
    const status = () => engine.agentStatus({ projectPath: dir, agent: "claude code" }).rooms;

    expect(status()).toHaveLength(1);
    expect(status()[0]).toMatchObject({ joined: true, unreadMentions: 0, unreadInterrupts: 0, openTasks: [], handoffsWaiting: [], paused: false });
    expect(status()[0]!.activeTeammates).toEqual(["Cursor"]);

    engine.sendMessage(b, { text: "@Claude Code ping", mentions: ["Claude Code"] });
    engine.sendMessage(b, { text: "stop!", importance: "interrupt" });
    const t = engine.createTask(a, { title: "webhook", claim: true });
    engine.claimFiles(a, { paths: ["src/a.ts"] });
    engine.requestHandoff(b, { path: "src/a.ts", message: "need it" });

    const s = status()[0]!;
    expect(s.unreadMentions).toBe(1); // the hand-off shows up under handoffsWaiting instead
    expect(s.unreadInterrupts).toBe(1);
    expect(s.openTasks).toEqual([{ id: t.id, title: "webhook" }]);
    expect(s.handoffsWaiting).toMatchObject([{ path: "src/a.ts", requestedBy: "Cursor" }]);
    // Read-only: asking doesn't mark anything read.
    expect(status()[0]!.unreadMentions).toBe(1);

    engine.readMessages(a, { unreadOnly: true });
    expect(status()[0]).toMatchObject({ unreadMentions: 0, unreadInterrupts: 0 });

    engine.setRoomStatus(room.id, "paused");
    expect(status()[0]!.paused).toBe(true);

    // A subfolder of the room's project matches too; an unknown agent isn't joined; other folders don't match.
    fs.mkdirSync(path.join(dir, "pkg"));
    expect(engine.agentStatus({ projectPath: path.join(dir, "pkg"), agent: "Claude Code" }).rooms).toHaveLength(1);
    expect(engine.agentStatus({ projectPath: dir, agent: "Gemini" }).rooms[0]).toMatchObject({ joined: false, participant: null });
    expect(engine.agentStatus({ projectPath: tmpDir("bothread-other-"), agent: "Claude Code" }).rooms).toEqual([]);
  });

  it("an editor-hook guard block posts one 'Edit blocked' notice per window", () => {
    const engine = new Engine(openDatabase(":memory:"), new RoomBus());
    const dir = tmpDir("bothread-hooks-");
    const { room, b } = roomWithAgents(engine, dir);
    engine.claimFiles(b, { paths: ["src/a.ts"] });
    for (let i = 0; i < 3; i++) {
      expect(engine.guardCheck({ projectPath: dir, files: ["src/a.ts"], agent: "Claude Code", source: "edit" }).blocked).toHaveLength(1);
    }
    const notices = engine.messagesBefore(room.id, 1e9, 100).messages.filter((m) => m.text.startsWith("Edit blocked"));
    expect(notices.map((m) => m.text)).toEqual(["Edit blocked: Claude Code tried to edit src/a.ts while Cursor holds it."]);
    expect(engine.listAudit(room.id).filter((e) => e.type === "guard.edit_blocked")).toHaveLength(3);
  });
});

/* ---------------------------- HTTP + CLI ---------------------------- */

interface Hub {
  server: http.Server;
  port: number;
  engine: Engine;
  close: () => Promise<void>;
}

async function startHub(): Promise<Hub> {
  const bus = new RoomBus();
  const engine = new Engine(openDatabase(":memory:"), bus);
  const hub = new McpHub(engine);
  const config = { host: "127.0.0.1", port: 0, dbPath: ":memory:", installToken: "test", authRequired: false };
  const { app } = buildApp({ engine, bus, hub, config, token: "test" });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    port,
    engine,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function get(port: number, urlPath: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method: "GET", agent: false, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let json: any = null;
        try {
          json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          /* not json */
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("hooks against a live hub", { timeout: 60_000 }, () => {
  let hub: Hub;
  let dir: string;
  let env: NodeJS.ProcessEnv;

  // Async on purpose: the hub runs in THIS process, so spawnSync would deadlock it.
  const cli = (args: string[], opts: { stdin?: unknown; env?: Record<string, string>; cwd?: string } = {}) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [bin, ...args], { cwd: opts.cwd ?? dir, env: { ...env, ...opts.env }, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, stdout, stderr }));
      child.stdin.end(opts.stdin === undefined ? "" : JSON.stringify(opts.stdin));
    });
  const editInput = (file: string) => ({ session_id: "s1", cwd: dir, hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: path.join(dir, file) } });

  beforeAll(async () => {
    hub = await startHub();
    dir = tmpDir("bothread-hooks-proj-");
    fs.mkdirSync(path.join(dir, ".git")); // looks like a repo root to the hooks
    env = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("BOTHREAD_") && !k.startsWith("CLAUDE_")) env[k] = v;
    Object.assign(env, { NO_COLOR: "1", BOTHREAD_NO_TELEMETRY: "1", BOTHREAD_PORT: String(hub.port) });
  });
  afterAll(async () => {
    if (hub?.server.listening) await hub.close();
  });

  it("GET /api/agent-status: validation, origin guard, results", async () => {
    const { a, b } = roomWithAgents(hub.engine, dir);
    hub.engine.sendMessage(b, { text: "@Claude Code hi", mentions: ["Claude Code"] });
    expect((await get(hub.port, `/api/agent-status?agent=x`)).status).toBe(400);
    expect((await get(hub.port, `/api/agent-status?project=relative&agent=x`)).status).toBe(400);
    expect((await get(hub.port, `/api/agent-status?project=${encodeURIComponent(dir)}`)).status).toBe(400);
    expect((await get(hub.port, `/api/agent-status?project=${encodeURIComponent(dir)}&agent=x`, { origin: "https://evil.example" })).status).toBe(403);
    const r = await get(hub.port, `/api/agent-status?project=${encodeURIComponent(dir)}&agent=${encodeURIComponent("Claude Code")}`);
    expect(r.status).toBe(200);
    expect(r.json.rooms).toHaveLength(1);
    expect(r.json.rooms[0]).toMatchObject({ roomName: "feat", joined: true, unreadMentions: 1, paused: false });
    hub.engine.readMessages(a, { unreadOnly: true });
  });

  it("install merges with existing hooks, backs up, is idempotent; status; uninstall removes only ours", async () => {
    const proj = tmpDir("bothread-hooks-settings-");
    const file = path.join(proj, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(file));
    const original = {
      model: "opus",
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./check.sh" }] }],
        Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
      },
    };
    fs.writeFileSync(file, JSON.stringify(original, null, 2));

    const r1 = await cli(["hooks", "install", "--path", proj, "--agent", "Claude A", "--json"]);
    expect(r1.status).toBe(0);
    const res1 = JSON.parse(r1.stdout);
    expect(res1).toMatchObject({ changed: true, agent: "Claude A", scope: "project" });
    expect(fs.readFileSync(res1.backup, "utf8")).toBe(JSON.stringify(original, null, 2));

    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(s.model).toBe("opus");
    expect(s.hooks.PreToolUse[0]).toEqual(original.hooks.PreToolUse[0]);
    expect(s.hooks.PreToolUse[1].matcher).toBe("Edit|Write|MultiEdit|NotebookEdit");
    expect(s.hooks.PreToolUse[1].hooks[0].command).toMatch(/bothread.* hooks run pre-edit --agent "Claude A"$/);
    expect(s.hooks.Stop[0]).toEqual(original.hooks.Stop[0]);
    expect(s.hooks.Stop[1].hooks[0].command).toMatch(/hooks run stop --agent "Claude A"$/);
    expect(s.hooks.UserPromptSubmit[0].hooks[0].command).toMatch(/hooks run context/);
    expect(s.hooks.SessionStart[0].hooks[0].command).toMatch(/hooks run context/);

    // Again: nothing changes, no new backup.
    const backups = () => fs.readdirSync(path.dirname(file)).filter((f) => f.includes("bothread-backup"));
    expect(backups()).toHaveLength(1);
    const r2 = JSON.parse((await cli(["hooks", "install", "--path", proj, "--agent", "Claude A", "--json"])).stdout);
    expect(r2.changed).toBe(false);
    expect(backups()).toHaveLength(1);

    // A different name replaces ours instead of adding a second set.
    await cli(["hooks", "install", "--path", proj, "--agent", "Claude B", "--json"]);
    const s2 = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(s2.hooks.PreToolUse).toHaveLength(2);
    expect(s2.hooks.PreToolUse[1].hooks[0].command).toMatch(/"Claude B"$/);

    const st = JSON.parse((await cli(["hooks", "status", "--path", proj, "--json"])).stdout);
    expect(st).toMatchObject({ installed: true, agent: "Claude B", hub: { running: true, port: hub.port } });
    expect(st.events.sort()).toEqual(["PreToolUse", "SessionStart", "Stop", "UserPromptSubmit"]);

    const u = JSON.parse((await cli(["hooks", "uninstall", "--path", proj, "--json"])).stdout);
    expect(u.changed).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(original);
    expect(JSON.parse((await cli(["hooks", "uninstall", "--path", proj, "--json"])).stdout).changed).toBe(false);
    expect(JSON.parse((await cli(["hooks", "status", "--path", proj, "--json"])).stdout).installed).toBe(false);

    // Creates the file when there is none; refuses a file that isn't plain JSON.
    const fresh = tmpDir("bothread-hooks-fresh-");
    expect((await cli(["hooks", "install", "--path", fresh])).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(fresh, ".claude", "settings.json"), "utf8")).hooks.Stop).toHaveLength(1);
    const bad = tmpDir("bothread-hooks-bad-");
    fs.mkdirSync(path.join(bad, ".claude"));
    fs.writeFileSync(path.join(bad, ".claude", "settings.json"), "{ // comment\n}");
    const rb = await cli(["hooks", "install", "--path", bad]);
    expect(rb.status).toBe(1);
    expect(fs.readFileSync(path.join(bad, ".claude", "settings.json"), "utf8")).toBe("{ // comment\n}");
    expect((await cli(["hooks", "install", "--path", fresh, "--agent", 'bad"name'])).status).toBe(1);
  });

  it("--user writes to CLAUDE_CONFIG_DIR/settings.json", async () => {
    const cfg = tmpDir("bothread-hooks-user-");
    const r = await cli(["hooks", "install", "--user", "--json"], { env: { CLAUDE_CONFIG_DIR: cfg } });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ scope: "user", agent: "Claude Code" });
    expect(JSON.parse(fs.readFileSync(path.join(cfg, "settings.json"), "utf8")).hooks.PreToolUse).toHaveLength(1);
  });

  it("run pre-edit: blocks another agent's exclusive file, allows own/unclaimed, fails open", async () => {
    const room = hub.engine.listRooms().find((r) => r.projectPath === dir)!;
    const cursor = hub.engine.resolveCaller("mcp-b");
    expect(cursor.room.id).toBe(room.id);
    expect(hub.engine.claimFiles(cursor, { paths: ["src/held.ts"] }).granted).toBe(true);

    const blocked = await cli(["hooks", "run", "pre-edit", "--agent", "Claude Code"], { stdin: editInput("src/held.ts") });
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain("src/held.ts is claimed exclusively by Cursor");
    expect(blocked.stderr).toContain("request_handoff");
    expect(blocked.stdout).toBe("");

    // Relative path + NotebookEdit's notebook_path + BOTHREAD_AGENT override.
    const nb = await cli(["hooks", "run", "pre-edit", "--agent", "Claude Code"], {
      stdin: { cwd: dir, tool_name: "NotebookEdit", tool_input: { notebook_path: "src/held.ts" } },
    });
    expect(nb.status).toBe(2);
    const asHolder = await cli(["hooks", "run", "pre-edit", "--agent", "Claude Code"], { stdin: editInput("src/held.ts"), env: { BOTHREAD_AGENT: "Cursor" } });
    expect(asHolder.status).toBe(0);

    const free = await cli(["hooks", "run", "pre-edit", "--agent", "Claude Code"], { stdin: editInput("src/free.ts") });
    expect(free).toMatchObject({ status: 0, stdout: "", stderr: "" });
    const outside = await cli(["hooks", "run", "pre-edit", "--agent", "Claude Code"], { stdin: { cwd: dir, tool_input: { file_path: "/etc/hosts" } } });
    expect(outside.status).toBe(0);

    const off = await cli(["hooks", "run", "pre-edit", "--agent", "Claude Code"], { stdin: editInput("src/held.ts"), env: { BOTHREAD_HOOKS: "off" } });
    expect(off.status).toBe(0);
    const garbage = await cli(["hooks", "run", "pre-edit", "--agent", "Claude Code"], { stdin: "not json" });
    expect(garbage.status).toBe(0);

    // Hub down: a port nobody listens on.
    const probe = http.createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const deadPort = (probe.address() as AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const down = await cli(["hooks", "run", "pre-edit", "--agent", "Claude Code"], { stdin: editInput("src/held.ts"), env: { BOTHREAD_PORT: String(deadPort) } });
    expect(down).toMatchObject({ status: 0, stdout: "" });

    hub.engine.releaseFiles(cursor, { paths: ["src/held.ts"] });
  });

  it("run stop: exit 2 with unread mentions; 0 when stop_hook_active or nothing pending; context prints only when needed", async () => {
    const claude = hub.engine.resolveCaller("mcp-a");
    const cursor = hub.engine.resolveCaller("mcp-b");
    hub.engine.readMessages(claude, { unreadOnly: true });
    const stopInput = (active = false) => ({ session_id: "s1", cwd: dir, hook_event_name: "Stop", stop_hook_active: active });
    const stop = (active = false, extra: Record<string, string> = {}) => cli(["hooks", "run", "stop", "--agent", "Claude Code"], { stdin: stopInput(active), env: extra });
    const context = () => cli(["hooks", "run", "context", "--agent", "Claude Code"], { stdin: { cwd: dir, hook_event_name: "UserPromptSubmit", prompt: "hi" } });

    expect(await stop()).toMatchObject({ status: 0, stderr: "" });
    expect((await context()).stdout).toBe("");

    hub.engine.sendMessage(cursor, { text: "@Claude Code can you check the API?", mentions: ["Claude Code"] });
    hub.engine.sendMessage(cursor, { text: "@Claude Code and the tests", mentions: ["Claude Code"] });
    const blocked = await stop();
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain('Bothread room "feat": 2 unread @mentions of you');
    expect(blocked.stderr).toContain("wait_for_update");
    expect((await stop(true)).status).toBe(0);
    expect((await stop(false, { BOTHREAD_HOOKS: "off" })).status).toBe(0);

    const ctx = await context();
    expect(ctx.status).toBe(0);
    expect(ctx.stdout).toMatch(/^Bothread room "feat": 2 unread @mentions of you \(seq \d+, \d+\)\. Call read_messages with unreadOnly: true/);
    expect(ctx.stdout.trim().split("\n").length).toBeLessThanOrEqual(3);

    hub.engine.readMessages(claude, { unreadOnly: true });
    expect((await stop()).status).toBe(0);

    // An in-progress task while a teammate is active keeps it going too.
    const t = hub.engine.createTask(claude, { title: "api check", claim: true });
    const taskStop = await stop();
    expect(taskStop.status).toBe(2);
    expect(taskStop.stderr).toContain(`your task "api check" (${t.id}) is still in progress while Cursor is active`);
    // Paused room: nothing to do but wait — let it stop.
    const room = hub.engine.listRooms().find((r) => r.projectPath === dir)!;
    hub.engine.setRoomStatus(room.id, "paused");
    expect((await stop()).status).toBe(0);
    expect((await context()).stdout).toContain("PAUSED");
    hub.engine.setRoomStatus(room.id, "active");
    hub.engine.updateTask(claude, { taskId: t.id, status: "done" });
    expect((await stop()).status).toBe(0);
  });
});
