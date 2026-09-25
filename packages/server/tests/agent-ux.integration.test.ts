import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { openDatabase } from "../src/db/database";
import { Engine } from "../src/engine/engine";
import { buildApp } from "../src/http";
import { McpHub } from "../src/mcp/transport";
import { RoomBus } from "../src/realtime";
import { VERSION } from "../src/version";

/**
 * The agent-facing UX over the real wire: prompts, actionable "Next:" errors,
 * next-step nudges, ids inline in the snapshot, rendered messages in
 * wait_for_update, and tool annotations.
 */

let server: http.Server;
let baseUrl: string;
let engine: Engine;

beforeAll(async () => {
  const db = openDatabase(":memory:");
  const bus = new RoomBus();
  engine = new Engine(db, bus);
  const hub = new McpHub(engine);
  const config = { host: "127.0.0.1", port: 0, dbPath: ":memory:", installToken: "test", authRequired: false };
  const { app, attachWebSocket } = buildApp({ engine, bus, hub, config, token: "test" });
  server = http.createServer(app);
  attachWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function textOf(res: unknown): string {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}
function jsonOf<T = any>(res: unknown): T {
  const m = textOf(res).match(/```json\n([\s\S]*?)\n```/);
  if (!m) throw new Error("no json block in tool result:\n" + textOf(res));
  return JSON.parse(m[1]!) as T;
}

async function connectAgent(name: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(transport);
  return {
    client,
    call: (toolName: string, args: Record<string, unknown>) => client.callTool({ name: toolName, arguments: args }),
    close: () => client.close(),
  };
}

async function createRoom(name: string): Promise<{ sessionId: string; roomId: string }> {
  const created = await fetch(`${baseUrl}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  }).then((r) => r.json() as Promise<{ sessionId: string; room: { id: string } }>);
  return { sessionId: created.sessionId, roomId: created.room.id };
}

describe("agent UX over MCP", () => {
  it("reports the package version and working-loop instructions on initialize", async () => {
    const a = await connectAgent("probe");
    expect(a.client.getServerVersion()?.version).toBe(VERSION);
    const instructions = a.client.getInstructions() ?? "";
    expect(instructions).toContain("join_session");
    expect(instructions).toContain("wait_for_update");
    expect(instructions.split(/\s+/).length).toBeLessThan(130);
    await a.close();
  });

  it("annotates every tool, all closed-world, with titles", async () => {
    const a = await connectAgent("probe");
    const { tools } = await a.client.listTools();
    expect(tools.length).toBe(20);
    for (const t of tools) {
      expect(t.annotations, t.name).toBeDefined();
      expect(t.annotations!.openWorldHint, t.name).toBe(false);
      expect(typeof t.annotations!.readOnlyHint, t.name).toBe("boolean");
      expect(typeof t.annotations!.destructiveHint, t.name).toBe("boolean");
      expect(t.title, t.name).toBeTruthy();
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations!]));
    expect(byName.retract_message!.destructiveHint).toBe(true);
    expect(byName.leave_session!.destructiveHint).toBe(true);
    expect(byName.get_room_state!.readOnlyHint).toBe(true);
    expect(byName.get_room_state!.idempotentHint).toBe(true);
    expect(byName.claim_files!.readOnlyHint).toBe(false);
    expect(byName.send_message!.destructiveHint).toBe(false);
    await a.close();
  });

  it("lists the join + standup prompts and renders the session id into join", async () => {
    const a = await connectAgent("probe");
    const { prompts } = await a.client.listPrompts();
    const names = prompts.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["join", "standup"]));
    const join = prompts.find((p) => p.name === "join")!;
    expect(join.arguments?.find((x) => x.name === "sessionId")?.required).toBe(true);

    const rendered = await a.client.getPrompt({ name: "join", arguments: { sessionId: "sess-abc-12345", agentName: "Codex" } });
    const text = (rendered.messages[0]!.content as { text: string }).text;
    expect(rendered.messages[0]!.role).toBe("user");
    expect(text).toContain("sess-abc-12345");
    expect(text).toContain("join_session");
    expect(text).toContain("Codex");

    const standup = await a.client.getPrompt({ name: "standup" });
    const s = (standup.messages[0]!.content as { text: string }).text;
    expect(s).toContain("get_room_state");
    expect(s).toContain("send_message");
    await a.close();
  });

  it("gives a not-joined agent an actionable error with a Next: line", async () => {
    const a = await connectAgent("lost");
    const res = await a.call("get_room_state", {});
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("(not_joined)");
    expect(text).toMatch(/\nNext: .*join_session/);

    // A bad session ID on join is also actionable.
    const bad = textOf(await a.call("join_session", { sessionId: "definitely-not-a-room", agentName: "X" }));
    expect(bad).toContain("(bad_session)");
    expect(bad).toContain("Next:");
    await a.close();
  });

  it("reshapes SDK input-validation errors into Error/Next form", async () => {
    const a = await connectAgent("sloppy");
    const res = await a.call("claim_files", { paths: "not-an-array" });
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("invalid_arguments");
    expect(text).toContain("paths");
    expect(text).toMatch(/Next: fix the arguments/);
    await a.close();
  });

  it("nudges on join, claims, prevented claims, and renders ids + → YOU", async () => {
    const { sessionId, roomId } = await createRoom("ux-room");
    const claude = await connectAgent("claude");
    const cursor = await connectAgent("cursor");

    const join = textOf(await claude.call("join_session", { sessionId, agentName: "Claude Code", brand: "claude" }));
    expect(join).toContain("don't call get_room_state again");
    await cursor.call("join_session", { sessionId, agentName: "Cursor", brand: "cursor" });

    // Compact JSON inside the same fence.
    const claimRes = await claude.call("claim_files", { paths: ["src/game/*"] });
    const claimText = textOf(claimRes);
    expect(claimText).toMatch(/```json\n\{"granted":true/);
    expect(claimText).toContain("release_files");
    expect(jsonOf(claimRes).granted).toBe(true);

    const prevented = textOf(await cursor.call("claim_files", { paths: ["src/game/boss.ts"] }));
    expect(prevented).toContain("PREVENTED");
    expect(prevented).toContain("held by Claude Code");
    expect(prevented).toContain("request_handoff");
    expect(prevented).toContain("check_files");

    // Snapshot shows task + note ids inline, and your own leases.
    const task = jsonOf(await claude.call("create_task", { title: "Wire boss", claim: true }));
    const note = jsonOf(await claude.call("record_note", { kind: "decision", title: "physics owns collision" }));
    const snapText = textOf(await claude.call("get_room_state", {}));
    expect(snapText).toContain(`Wire boss (${task.id})`);
    expect(snapText).toContain(`decision ${note.id}: physics owns collision`);
    expect(snapText).toMatch(/You hold: src\/game\/\*/);
    // The hand-off auto-opened by the prevented claim is shown with its id, flagged as yours to act on.
    const handoffId = engine.pendingHandoffs(roomId)[0]!.id;
    expect(snapText).toContain(`${handoffId}: Cursor wants src/game/boss.ts`);
    expect(snapText).toContain("you hold this");

    // wait_for_update renders a new message addressed to the caller.
    const since = jsonOf(await cursor.call("read_messages", {})).latestSeq as number;
    const waiting = cursor.call("wait_for_update", { since, maxWaitMs: 5000 });
    await new Promise((r) => setTimeout(r, 50));
    await claude.call("send_message", { text: "@Cursor take the HUD instead", mentions: ["Cursor"], importance: "steering" });
    const woke = textOf(await waiting);
    expect(woke).toContain("take the HUD instead");
    expect(woke).toContain("→ YOU");
    expect(woke).toContain("!steering");
    expect(woke).toMatch(/latestSeq \d+/);
    expect(woke).toContain("Next:");

    // read_messages renders lines too.
    const read = textOf(await cursor.call("read_messages", { since }));
    expect(read).toContain("take the HUD instead");
    expect(read).toContain("→ YOU");

    // Quiet wait: tells the agent that's normal.
    const quiet = textOf(await cursor.call("wait_for_update", { maxWaitMs: 0 }));
    expect(quiet).toContain("No new activity");
    expect(quiet).toContain("call wait_for_update again");

    await claude.close();
    await cursor.close();
  });

  it("paused rooms return a paused error with a wait_for_update hint", async () => {
    const { sessionId, roomId } = await createRoom("paused-room");
    const a = await connectAgent("pausy");
    await a.call("join_session", { sessionId, agentName: "Gemini" });
    engine.setRoomStatus(roomId, "paused");
    const res = textOf(await a.call("claim_files", { paths: ["a.ts"] }));
    expect(res).toContain("(paused)");
    expect(res).toMatch(/Next: .*wait_for_update/);
    await a.close();
  });

  it("request_approval tells the agent not to proceed when rejected", async () => {
    const { sessionId, roomId } = await createRoom("approval-room");
    const a = await connectAgent("asker");
    await a.call("join_session", { sessionId, agentName: "Codex" });
    const pending = a.call("request_approval", { action: "deploy", details: "deploy prod" });
    for (let i = 0; i < 50 && engine.pendingApprovals(roomId).length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const open = engine.pendingApprovals(roomId)[0]!;
    engine.decideApproval(roomId, open.id, "rejected");
    const text = textOf(await pending);
    expect(text).toMatch(/rejected/);
    expect(text).toContain("do NOT do it");
    await a.close();
  });
});
