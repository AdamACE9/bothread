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

/**
 * The thesis, proven end-to-end over the wire: two DIFFERENT-BRAND agents
 * (modeled as two real @modelcontextprotocol/sdk clients) join one room via a
 * session ID, exchange messages, and the second is PREVENTED from claiming a
 * file the first holds — exactly the collision Bothread exists to stop.
 */

let server: http.Server;
let baseUrl: string;
let engine: Engine;

beforeAll(async () => {
  const db = openDatabase(":memory:");
  const bus = new RoomBus();
  engine = new Engine(db, bus);
  const hub = new McpHub(engine);
  const config = {
    host: "127.0.0.1",
    port: 0,
    dbPath: ":memory:",
    installToken: "test",
    authRequired: false,
  };
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
/** Pull the trailing ```json block out of a tool result and parse it. */
function jsonOf<T = any>(res: unknown): T {
  const text = textOf(res);
  const m = text.match(/```json\n([\s\S]*?)\n```/);
  if (!m) throw new Error("no json block in tool result:\n" + text);
  return JSON.parse(m[1]!) as T;
}

async function connectAgent(name: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(transport);
  return {
    client,
    call: (toolName: string, args: Record<string, unknown>) =>
      client.callTool({ name: toolName, arguments: args }),
    close: () => client.close(),
  };
}

describe("MCP over Streamable HTTP — two-agent collision prevention", () => {
  it("lists the Bothread tool surface to a connected client", async () => {
    const a = await connectAgent("probe");
    const tools = await a.client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "join_session",
        "get_room_state",
        "send_message",
        "claim_files",
        "request_approval",
        "leave_session",
      ])
    );
    await a.close();
  });

  it("creates a room over REST, two brands join, and a collision is prevented", async () => {
    // Room created through the same REST control plane the UI uses.
    const created = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "payments-refactor" }),
    }).then((r) => r.json() as Promise<{ sessionId: string; room: { id: string } }>);
    const sessionId: string = created.sessionId;
    const roomId: string = created.room.id;
    expect(sessionId).toBeTruthy();

    const claude = await connectAgent("claude-code");
    const cursor = await connectAgent("cursor");

    const joinA = await claude.call("join_session", { sessionId, agentName: "Claude Code", brand: "claude" });
    expect(textOf(joinA)).toContain("payments-refactor");
    await cursor.call("join_session", { sessionId, agentName: "Cursor", brand: "cursor" });

    // Claude claims the payments dir exclusively — granted.
    const claimA = jsonOf(await claude.call("claim_files", { paths: ["src/payments/*"], exclusive: true }));
    expect(claimA.granted).toBe(true);

    // Cursor tries to grab a file inside it — PREVENTED.
    const claimBRes = await cursor.call("claim_files", { paths: ["src/payments/webhook.ts"], exclusive: true });
    expect(textOf(claimBRes)).toContain("PREVENTED");
    const claimB = jsonOf(claimBRes);
    expect(claimB.granted).toBe(false);
    expect(claimB.conflicts[0].heldByName).toBe("Claude Code");

    // Cursor sees the collision + Claude's lock in the room state.
    await claude.call("send_message", { text: "Taking payments — please stay in checkout." });
    const stateB = jsonOf(await cursor.call("get_room_state", {}));
    expect(stateB.locks.some((l: any) => l.path === "src/payments/*" && l.heldByName === "Claude Code")).toBe(true);
    expect(stateB.thread.some((m: any) => String(m.text).startsWith("Prevented:"))).toBe(true);

    await claude.close();
    await cursor.close();
  });

  it("blocks request_approval until the overseer decides", async () => {
    const created = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "deploy-room" }),
    }).then((r) => r.json() as Promise<{ sessionId: string; room: { id: string } }>);
    const roomId: string = created.room.id;

    const claude = await connectAgent("claude-code-2");
    await claude.call("join_session", { sessionId: created.sessionId, agentName: "Claude Code", brand: "claude" });

    const pending = claude.call("request_approval", { action: "deploy", details: "deploy:staging" });

    // Wait for the request to register, then approve it via REST (the UI path).
    for (let i = 0; i < 50 && engine.pendingApprovals(roomId).length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const open = engine.pendingApprovals(roomId);
    expect(open).toHaveLength(1);
    await fetch(`${baseUrl}/api/rooms/${roomId}/approvals/${open[0]!.id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });

    const res = await pending;
    expect(textOf(res)).toMatch(/approved/i);
    await claude.close();
  });
});
