import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LoggingMessageNotificationSchema, ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { openDatabase } from "../src/db/database";
import { Engine } from "../src/engine/engine";
import { buildApp } from "../src/http";
import { McpHub, pushFor, type PushedMessage } from "../src/mcp/transport";
import { RoomBus } from "../src/realtime";
import { channelEvent, createChannel } from "../../../bin/lib/channel.mjs";

/**
 * @mentions that actually interrupt: auto-parsed mentions (multi-word names, @all), the
 * interrupt banner on the next tool call of any kind, push notifications only to the
 * addressed agent, the Claude Code PostToolUse `notify` hook, and the channel server.
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
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function room3(engine: Engine, projectPath?: string) {
  const { room, sessionId } = engine.createRoom({ name: "feat", projectPath });
  engine.joinSession("mcp-a", { sessionId, agentName: "Claude Code", brand: "claude" });
  engine.joinSession("mcp-b", { sessionId, agentName: "Cursor", brand: "cursor" });
  engine.joinSession("mcp-c", { sessionId, agentName: "Claude", brand: "claude" });
  return { room, sessionId, a: engine.resolveCaller("mcp-a"), b: engine.resolveCaller("mcp-b"), c: engine.resolveCaller("mcp-c") };
}

describe("mention parsing", () => {
  it("auto-detects @Name against the roster: case-insensitive, longest first, multi-word, merged with explicit", () => {
    const engine = new Engine(openDatabase(":memory:"), new RoomBus());
    const { room, a, b } = room3(engine);
    expect(engine.sendMessage(b, { text: "hey @claude code, can you look?" }).mentions).toEqual(["Claude Code"]);
    expect(engine.sendMessage(b, { text: "@Claude please (not the other one)" }).mentions).toEqual(["Claude"]);
    expect(engine.sendMessage(a, { text: "@Cursorx and mail foo@cursor.dev aren't mentions" }).mentions).toEqual([]);
    // Explicit names are kept as given; the same name in the text isn't added twice.
    expect(engine.sendMessage(a, { text: "@Cursor and @Claude", mentions: ["cursor"] }).mentions).toEqual(["cursor", "Claude"]);
    // The human overseer's REST message is parsed too.
    expect(engine.overseerMessage(room.id, "@Claude Code stop editing loader.ts", "interrupt").mentions).toEqual(["Claude Code"]);
  });

  it("@all / @everyone / @here = every active agent except the author (in text or the explicit list)", () => {
    const engine = new Engine(openDatabase(":memory:"), new RoomBus());
    const { room, a, b } = room3(engine);
    expect(engine.sendMessage(a, { text: "@all heads up: schema changed" }).mentions.sort()).toEqual(["Claude", "Cursor"]);
    expect(engine.sendMessage(b, { text: "ping", mentions: ["@everyone"] }).mentions.sort()).toEqual(["Claude", "Claude Code"]);
    expect(engine.overseerMessage(room.id, "@here stand by").mentions.sort()).toEqual(["Claude", "Claude Code", "Cursor"]);
    // Agents that left aren't included.
    engine.leaveSession(engine.resolveCaller("mcp-c"));
    expect(engine.sendMessage(a, { text: "@all again" }).mentions).toEqual(["Cursor"]);
  });
});

describe("pending interrupts (engine)", () => {
  it("mentions + human interrupts, never your own, shown once; reads also count as shown", () => {
    const engine = new Engine(openDatabase(":memory:"), new RoomBus());
    const { room, a, b } = room3(engine);
    const me = a.participant.id;
    engine.sendMessage(a, { text: "@Cursor mine, @all too" });
    engine.sendMessage(b, { text: "chatter, not for anyone" });
    engine.sendMessage(b, { text: "agent interrupt aimed at Claude", importance: "interrupt", mentions: ["Claude"] });
    expect(engine.pendingInterrupts(me)).toEqual([]);

    const m1 = engine.sendMessage(b, { text: "@Claude Code schema changed" });
    const m2 = engine.overseerMessage(room.id, "everyone stop", "interrupt");
    const items = engine.takeInterrupts(me);
    expect(items.map((i) => [i.seq, i.mentioned, i.authorKind])).toEqual([
      [m1.seq, true, "agent"],
      [m2.seq, false, "human"],
    ]);
    expect(engine.takeInterrupts(me)).toEqual([]);

    // Read via read_messages → not bannered later.
    engine.sendMessage(b, { text: "@Claude Code one more" });
    engine.readMessages(a, { unreadOnly: true });
    expect(engine.pendingInterrupts(me)).toEqual([]);
  });
});

/* ------------------------------ live hub ------------------------------ */

interface Hub {
  server: http.Server;
  port: number;
  baseUrl: string;
  engine: Engine;
  close: () => Promise<void>;
}

async function startHub(): Promise<Hub> {
  const bus = new RoomBus();
  const engine = new Engine(openDatabase(":memory:"), bus);
  const hub = new McpHub(engine);
  // Same wiring as src/index.ts.
  bus.onAny((ev) => {
    if (ev.type !== "message") return;
    const m = (ev.data as { message?: PushedMessage }).message;
    if (m) hub.notifyRoomMessage(ev.roomId, m);
  });
  const config = { host: "127.0.0.1", port: 0, dbPath: ":memory:", installToken: "test", authRequired: false };
  const { app } = buildApp({ engine, bus, hub, config, token: "test" });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    engine,
    close: async () => {
      await hub.closeAll();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function textOf(res: unknown): string {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}
function jsonOf<T = any>(res: unknown): T {
  const m = textOf(res).match(/```json\n([\s\S]*?)\n```/);
  if (!m) throw new Error("no json block:\n" + textOf(res));
  return JSON.parse(m[1]!) as T;
}

async function connect(hub: Hub, name: string) {
  const client = new Client({ name, version: "1.0.0" });
  const logs: Array<{ level: string; data: unknown }> = [];
  const updated: string[] = [];
  client.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
    logs.push({ level: n.params.level, data: n.params.data });
  });
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
    updated.push(n.params.uri);
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${hub.baseUrl}/mcp`)));
  return {
    client,
    logs,
    updated,
    call: (tool: string, args: Record<string, unknown> = {}) => client.callTool({ name: tool, arguments: args }),
  };
}

describe("interrupts over MCP", { timeout: 30_000 }, () => {
  let hub: Hub;
  beforeAll(async () => {
    hub = await startHub();
  });
  afterAll(async () => {
    await hub?.close();
  });

  it("banner on the next unrelated tool call after a mention, then not again; JSON carries interrupts", async () => {
    const { room, sessionId } = hub.engine.createRoom({ name: "banner" });
    const claude = await connect(hub, "claude");
    const cursor = await connect(hub, "cursor");
    await claude.call("join_session", { sessionId, agentName: "Claude Code" });
    await cursor.call("join_session", { sessionId, agentName: "Cursor" });

    const sent = await cursor.call("send_message", { text: "@Claude Code stop editing loader.ts, schema changed" });
    expect(textOf(sent)).toContain("Claude Code is not currently listening");
    expect(textOf(sent)).not.toContain("INTERRUPT"); // your own message never banners you

    const r1 = await claude.call("check_files", { paths: ["src/loader.ts"] });
    const t1 = textOf(r1);
    expect(t1.startsWith("📣 INTERRUPT — Cursor @mentioned you [#")).toBe(true);
    expect(t1).toContain('"@Claude Code stop editing loader.ts, schema changed"');
    expect(t1).toContain("replyToSeq:");
    expect(t1).toContain("src/loader.ts: free.");
    // check_files' data is an array, so interrupts ride in their own block.
    expect(t1).toMatch(/```json\n\{"interrupts":\[\{"seq":\d+,"author":"Cursor"/);

    const r2 = await claude.call("check_files", { paths: ["src/loader.ts"] });
    expect(textOf(r2)).not.toContain("INTERRUPT");

    // The human's interrupt banners without any mention; object data gets `interrupts` merged.
    hub.engine.overseerMessage(room.id, "pause all work, reviewing", "interrupt");
    const r3 = await claude.call("get_room_state");
    // get_room_state shows the thread itself (read cursor moves), so no banner needed there…
    expect(textOf(r3)).not.toContain("📣 INTERRUPT");
    hub.engine.overseerMessage(room.id, "actually, one more thing", "interrupt");
    const r4 = await claude.call("claim_next_task");
    expect(textOf(r4)).toMatch(/^📣 INTERRUPT — You \(human\) sent an interrupt \[#\d+\]: "actually, one more thing"/);
    expect(jsonOf(r4)).toMatchObject({ task: null, interrupts: [{ author: "You", mentioned: false, importance: "interrupt" }] });

    // More than 3: newest 3 shown, the rest counted.
    for (const n of [1, 2, 3, 4, 5]) await cursor.call("send_message", { text: `@claude code item ${n}` });
    const r5 = textOf(await claude.call("check_files", { paths: ["x"] })).split("\n\nx: free.")[0]!;
    expect(r5).toMatch(/^📣 2 more interrupts for you/);
    expect(r5).toContain("item 5");
    expect(r5).not.toContain("item 2");
    expect(r5.indexOf("item 3")).toBeLessThan(r5.indexOf("item 5"));
    await claude.client.close();
    await cursor.client.close();
  });

  it("push: warning only to the mentioned agent, alert to all on a human interrupt, info for human chatter, resources/updated to subscribers", async () => {
    const { room, sessionId } = hub.engine.createRoom({ name: "push" });
    const a = await connect(hub, "a");
    const b = await connect(hub, "b");
    const c = await connect(hub, "c");
    await a.call("join_session", { sessionId, agentName: "Claude Code" });
    await b.call("join_session", { sessionId, agentName: "Cursor" });
    await c.call("join_session", { sessionId, agentName: "Codex" });
    await b.client.subscribeResource({ uri: "bothread://room/state" });
    await sleep(300); // let the SSE streams open
    const clear = () => [a, b, c].forEach((x) => (x.logs.length = 0, x.updated.length = 0));
    clear();

    await a.call("send_message", { text: "@Cursor can you take the API?" });
    await sleep(400);
    expect(b.logs).toHaveLength(1);
    expect(b.logs[0]).toMatchObject({ level: "warning" });
    expect(String(b.logs[0]!.data)).toMatch(/^📣 @mention from Claude Code \[#\d+\]: @Cursor can you take the API\?/);
    expect(c.logs).toEqual([]); // unaddressed agent chatter: silence
    expect(a.logs).toEqual([]); // never the author
    expect(b.updated).toEqual(["bothread://room/state"]);
    expect(c.updated).toEqual([]);

    clear();
    hub.engine.overseerMessage(room.id, "stop, the build is red", "interrupt");
    await sleep(400);
    for (const x of [a, b, c]) {
      expect(x.logs).toHaveLength(1);
      expect(x.logs[0]).toMatchObject({ level: "alert" });
      expect(String(x.logs[0]!.data)).toContain("Interrupt from You (human)");
    }

    clear();
    hub.engine.overseerMessage(room.id, "nice work so far", "info");
    await sleep(400);
    expect(c.logs).toEqual([{ level: "info", data: expect.stringContaining("Message from You (human)") }]);

    for (const x of [a, b, c]) await x.client.close();
  });

  it("pushFor: levels and silence", () => {
    const base: PushedMessage = { seq: 7, authorId: "p1", authorName: "Cursor", kind: "agent", importance: "info", text: "hi", mentions: [] };
    expect(pushFor(base, "Codex")).toBeNull();
    expect(pushFor({ ...base, mentions: ["codex"] }, "Codex")?.level).toBe("warning");
    expect(pushFor({ ...base, mentions: ["Codex"], importance: "interrupt" }, "Codex")?.level).toBe("alert");
    expect(pushFor({ ...base, importance: "interrupt", mentions: ["Claude"] }, "Codex")).toBeNull();
    expect(pushFor({ ...base, importance: "interrupt" }, "Codex")?.level).toBe("alert");
  });
});

describe("Claude Code: hooks run notify, /api/agent-inbox, channel", { timeout: 60_000 }, () => {
  let hub: Hub;
  let dir: string;
  let env: NodeJS.ProcessEnv;
  const cli = (args: string[], stdin: unknown, extra: Record<string, string> = {}) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [bin, ...args], { cwd: dir, env: { ...env, ...extra }, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, stdout, stderr }));
      child.stdin.end(JSON.stringify(stdin));
    });
  const post = (body: unknown) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const data = Buffer.from(JSON.stringify(body));
      const req = http.request(
        { host: "127.0.0.1", port: hub.port, path: "/api/agent-inbox", method: "POST", agent: false, headers: { "content-type": "application/json", "content-length": data.length } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString("utf8") || "null") }));
        }
      );
      req.on("error", reject);
      req.end(data);
    });

  beforeAll(async () => {
    hub = await startHub();
    dir = tmpDir("bothread-mentions-");
    fs.mkdirSync(path.join(dir, ".git"));
    env = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("BOTHREAD_") && !k.startsWith("CLAUDE_")) env[k] = v;
    Object.assign(env, { NO_COLOR: "1", BOTHREAD_NO_TELEMETRY: "1", BOTHREAD_PORT: String(hub.port) });
  });
  afterAll(async () => {
    await hub?.close();
  });

  it("notify: injects a pending mention as PostToolUse additionalContext once, silent otherwise", async () => {
    const { a, b } = room3(hub.engine, dir);
    const notify = () =>
      cli(["hooks", "run", "notify", "--agent", "Claude Code"], { session_id: "s", cwd: dir, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" } });

    expect(await notify()).toMatchObject({ status: 0, stdout: "", stderr: "" });

    const m = hub.engine.sendMessage(b, { text: "@Claude Code the schema changed — stop editing loader.ts" });
    const r = await notify();
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(out.hookSpecificOutput.additionalContext).toContain(`📣 INTERRUPT from Bothread room "feat" — Cursor @mentioned you [#${m.seq}]`);
    expect(out.hookSpecificOutput.additionalContext).toContain(`replyToSeq: ${m.seq}`);
    // Shown once — and the MCP banner won't repeat it either (shared marker).
    expect((await notify()).stdout).toBe("");
    expect(hub.engine.pendingInterrupts(a.participant.id)).toEqual([]);

    // Hub down / hooks off: silent, exit 0.
    expect(await cli(["hooks", "run", "notify", "--agent", "Claude Code"], { cwd: dir }, { BOTHREAD_HOOKS: "off" })).toMatchObject({ status: 0, stdout: "" });
    expect(await cli(["hooks", "run", "notify", "--agent", "Claude Code"], { cwd: dir }, { BOTHREAD_PORT: "1" })).toMatchObject({ status: 0, stdout: "" });
  });

  it("POST /api/agent-inbox validates, and with waitMs long-polls until a message lands", async () => {
    expect((await post({ agent: "x" })).status).toBe(400);
    expect((await post({ projectPath: "rel", agent: "x" })).status).toBe(400);
    const cursor = hub.engine.resolveCaller("mcp-b");
    const latest = hub.engine.latestSeq(cursor.room.id);
    const started = Date.now();
    const pending = post({ projectPath: dir, agent: "Claude Code", since: { [cursor.room.id]: latest }, waitMs: 10_000 });
    await sleep(200);
    hub.engine.sendMessage(cursor, { text: "@Claude Code ping" });
    const r = await pending;
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r.status).toBe(200);
    expect(r.json.rooms[0].interrupts.map((i: { text: string }) => i.text)).toEqual(["@Claude Code ping"]);
    // `since` reads don't mark: the hook/banner still get it.
    expect(hub.engine.pendingInterrupts(hub.engine.resolveCaller("mcp-a").participant.id)).toHaveLength(1);
    hub.engine.takeInterrupts(hub.engine.resolveCaller("mcp-a").participant.id);
  });

  it("channel: declares claude/channel on a pre-2026-07-28 handshake and pushes each mention once", async () => {
    const sent: any[] = [];
    const ch = createChannel({ agent: "Claude Code", port: hub.port, projectPath: dir, write: (m) => sent.push(m), version: "test" });
    ch.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "claude-code", version: "2" } } });
    expect(sent[0]).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", capabilities: { experimental: { "claude/channel": {} } }, serverInfo: { name: "bothread-channel" } } });
    expect(sent[0].result.instructions).toContain('You are "Claude Code"');
    ch.handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    expect(sent[1].result.protocolVersion).toBe("2025-03-26");
    ch.handle({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    expect(sent[2]).toMatchObject({ id: 3, error: { code: -32601 } });
    ch.handle({ jsonrpc: "2.0", id: 4, method: "ping" });
    expect(sent[3]).toEqual({ jsonrpc: "2.0", id: 4, result: {} });
    sent.length = 0;

    // (No notifications/initialized: drive the poll by hand instead of the background loop.)
    expect(await ch.pollOnce(0)).toBe(0);
    const cursor = hub.engine.resolveCaller("mcp-b");
    const m = hub.engine.sendMessage(cursor, { text: "@Claude Code please rebase", importance: "steering" });
    expect(await ch.pollOnce(0)).toBe(1);
    expect(sent[0]).toMatchObject({
      method: "notifications/claude/channel",
      params: { meta: { room: "feat", from: "Cursor", from_kind: "agent", seq: String(m.seq), kind: "mention", importance: "steering" } },
    });
    expect(sent[0].params.content).toContain("please rebase");
    for (const k of Object.keys(sent[0].params.meta)) expect(k).toMatch(/^[A-Za-z0-9_]+$/);
    expect(await ch.pollOnce(0)).toBe(0);
    ch.stop();

    expect(channelEvent({ roomName: "r" }, { seq: 3, author: "You", authorKind: "human", importance: "interrupt", text: "stop", mentioned: false }).meta.kind).toBe("interrupt");
  });

  it("hooks install --channel registers bothread-channel in .mcp.json (merged, idempotent); uninstall removes it", async () => {
    const proj = tmpDir("bothread-channel-proj-");
    fs.writeFileSync(path.join(proj, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    const r1 = JSON.parse((await cli(["hooks", "install", "--path", proj, "--agent", "Claude Code", "--channel", "--json"], {})).stdout);
    expect(r1.channel).toMatchObject({ changed: true, launch: "claude --dangerously-load-development-channels server:bothread-channel" });
    const mcp = JSON.parse(fs.readFileSync(path.join(proj, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.other).toEqual({ command: "x" });
    expect(mcp.mcpServers["bothread-channel"].args.slice(-3)).toEqual(["channel", "--agent", "Claude Code"]);
    const r2 = JSON.parse((await cli(["hooks", "install", "--path", proj, "--agent", "Claude Code", "--channel", "--json"], {})).stdout);
    expect(r2.channel.changed).toBe(false);
    const settings = JSON.parse(fs.readFileSync(path.join(proj, ".claude", "settings.json"), "utf8"));
    expect(settings.hooks.PostToolUse[0].matcher).toBeUndefined();
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toMatch(/hooks run notify --agent "Claude Code"$/);
    const st = JSON.parse((await cli(["hooks", "status", "--path", proj, "--json"], {})).stdout);
    expect(st.channel.installed).toBe(true);
    const u = JSON.parse((await cli(["hooks", "uninstall", "--path", proj, "--json"], {})).stdout);
    expect(u.channel.changed).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(proj, ".mcp.json"), "utf8"))).toEqual({ mcpServers: { other: { command: "x" } } });
  });

  it("bothread channel over real stdio: initialize, then a live mention is pushed", async () => {
    // At startup the channel pushes what's still pending; clear the earlier tests' leftovers.
    hub.engine.takeInterrupts(hub.engine.resolveCaller("mcp-a").participant.id);
    const child = spawn(process.execPath, [bin, "channel", "--agent", "Claude Code"], { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) + "\n");
    for (let i = 0; i < 50 && !stdout.includes("\n"); i++) await sleep(100);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    await sleep(500); // first long-poll parks on the hub
    const m = hub.engine.sendMessage(hub.engine.resolveCaller("mcp-b"), { text: "@Claude Code wake up" });
    for (let i = 0; i < 50 && stdout.split("\n").filter(Boolean).length < 2; i++) await sleep(100);
    child.stdin.end();
    const code = await new Promise((r) => child.on("close", r));
    const [first, second] = stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(first.result.capabilities.experimental["claude/channel"]).toEqual({});
    expect(second).toMatchObject({ method: "notifications/claude/channel", params: { meta: { seq: String(m.seq), kind: "mention" } } });
    expect(code).toBe(0);
  });
});
