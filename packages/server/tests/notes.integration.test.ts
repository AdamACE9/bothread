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
 * Focused coverage for the notes feature (record_note / resolve_note) over the
 * real MCP wire, plus the REST endpoints the overseer's UI drives. Deliberately
 * a standalone file — does NOT touch the shared tool-list assertion in
 * mcp.integration.test.ts, since multiple parallel units are adding tools there.
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
    call: (toolName: string, args: Record<string, unknown>) => client.callTool({ name: toolName, arguments: args }),
    close: () => client.close(),
  };
}

async function createRoom(name: string) {
  return fetch(`${baseUrl}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  }).then((r) => r.json() as Promise<{ sessionId: string; room: { id: string } }>);
}

describe("MCP over Streamable HTTP — notes (decisions/issues/verification)", () => {
  it("registers record_note and resolve_note on the tool surface", async () => {
    const probe = await connectAgent("probe-notes");
    const tools = await probe.client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("record_note");
    expect(names).toContain("resolve_note");
    await probe.close();
  });

  it("an agent records a decision over MCP and it shows up in get_room_state", async () => {
    const created = await createRoom("notes-room");
    const claude = await connectAgent("claude-notes");
    await claude.call("join_session", { sessionId: created.sessionId, agentName: "Claude Code", brand: "claude" });

    const recorded = jsonOf(
      await claude.call("record_note", {
        kind: "decision",
        title: "physics.js owns collision",
        detail: "level.js owns tiles; isSolid(col,row) is the contract.",
      })
    );
    expect(recorded.kind).toBe("decision");
    expect(recorded.status).toBe("open");

    const state = jsonOf(await claude.call("get_room_state", {}));
    expect(state.notes.some((n: any) => n.title === "physics.js owns collision" && n.kind === "decision")).toBe(true);

    await claude.close();
  });

  it("an agent flags an issue, another resolves it, and the resolution round-trips over REST", async () => {
    const created = await createRoom("notes-room-2");
    const cursor = await connectAgent("cursor-notes");
    await cursor.call("join_session", { sessionId: created.sessionId, agentName: "Cursor", brand: "cursor" });

    const issue = jsonOf(
      await cursor.call("record_note", { kind: "issue", title: "leftover shadow artifact" })
    );
    expect(issue.status).toBe("open");

    // Resolved via REST — the overseer's UI path — using engine.callerForOverseer under the hood.
    const decided = await fetch(`${baseUrl}/api/rooms/${created.room.id}/notes/${issue.id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolution: "removed the stray sprite" }),
    }).then((r) => r.json() as Promise<{ note: { status: string; detail?: string } }>);

    expect(decided.note.status).toBe("resolved");
    expect(decided.note.detail).toContain("removed the stray sprite");

    // A fresh get_room_state confirms it.
    const state = jsonOf(await cursor.call("get_room_state", {}));
    const found = state.notes.find((n: any) => n.id === issue.id);
    expect(found.status).toBe("resolved");

    await cursor.close();
  });

  it("records a verification note via REST (overseer authoring one directly)", async () => {
    const created = await createRoom("notes-room-3");
    const res = await fetch(`${baseUrl}/api/rooms/${created.room.id}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "verification",
        title: "collision regression suite",
        detail: "tested: 20 falling-block cases\nexpected: no clip-through\nactual: all passed",
      }),
    }).then((r) => r.json() as Promise<{ note: { kind: string; title: string } }>);
    expect(res.note.kind).toBe("verification");

    const snapshot = await fetch(`${baseUrl}/api/rooms/${created.room.id}`).then(
      (r) => r.json() as Promise<{ snapshot: { notes: Array<{ title: string }> } }>
    );
    expect(snapshot.snapshot.notes.some((n) => n.title === "collision regression suite")).toBe(true);
  });
});
