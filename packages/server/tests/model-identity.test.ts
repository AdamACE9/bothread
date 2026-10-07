import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { openDatabase } from "../src/db/database";
import { SCHEMA_SQL } from "../src/db/schema";
import { Engine } from "../src/engine/engine";
import { buildApp } from "../src/http";
import { McpHub } from "../src/mcp/transport";
import { renderSnapshot } from "../src/mcp/tools";
import { RoomBus } from "../src/realtime";

/** Agents self-report their exact AI model (and client app) on join_session. */

const TIP = "Tip: re-call join_session with model: '<your exact model and version>' so the room shows which model you are.";

function makeEngine() {
  return new Engine(openDatabase(":memory:"), new RoomBus());
}

describe("model identity — engine", () => {
  it("persists model + client and exposes them on Participant and ParticipantView", () => {
    const engine = makeEngine();
    const { room, sessionId } = engine.createRoom({ name: "ident" });
    const { participant } = engine.joinSession("mcp-A", {
      sessionId,
      agentName: "Codex",
      brand: "codex",
      model: "GPT-5 Codex",
      client: "Codex CLI 1.0",
    });
    expect(participant.model).toBe("GPT-5 Codex");
    expect(participant.client).toBe("Codex CLI 1.0");

    const listed = engine.listParticipants(room.id).find((p) => p.name === "Codex")!;
    expect(listed.model).toBe("GPT-5 Codex");
    expect(listed.client).toBe("Codex CLI 1.0");

    // Another agent's snapshot shows the identity in JSON and text.
    engine.joinSession("mcp-B", { sessionId, agentName: "Claude Code", brand: "claude", model: "Claude Opus 5.5" });
    const b = engine.resolveCaller("mcp-B");
    const snap = engine.snapshotForAgent(b.room, b.participant);
    const view = snap.participants.find((p) => p.name === "Codex")!;
    expect(view.model).toBe("GPT-5 Codex");
    expect(view.client).toBe("Codex CLI 1.0");
    expect(renderSnapshot(snap)).toContain("• Codex (codex, GPT-5 Codex, via Codex CLI 1.0) — active");
  });

  it("records model in the join audit payload", () => {
    const engine = makeEngine();
    const { room, sessionId } = engine.createRoom({ name: "audit" });
    engine.joinSession("mcp-A", { sessionId, agentName: "Cursor", brand: "cursor", model: "Claude Sonnet 5" });
    const join = engine.listAudit(room.id).find((e) => e.type === "participant.join")!;
    expect(join.payload).toMatchObject({ brand: "cursor", model: "Claude Sonnet 5" });
  });

  it("re-join updates a changed model and keeps it when omitted", () => {
    const engine = makeEngine();
    const { room, sessionId } = engine.createRoom({ name: "rejoin" });
    engine.joinSession("mcp-A", { sessionId, agentName: "Claude Code", brand: "claude", model: "Claude Sonnet 5" });
    const r1 = engine.joinSession("mcp-A", { sessionId, agentName: "Claude Code", brand: "claude", model: "Claude Opus 5.5" });
    expect(r1.participant.model).toBe("Claude Opus 5.5");
    const r2 = engine.joinSession("mcp-A", { sessionId, agentName: "Claude Code", brand: "claude" });
    expect(r2.participant.model).toBe("Claude Opus 5.5");
    expect(engine.listParticipants(room.id).filter((p) => p.kind === "agent")).toHaveLength(1);
  });

  it("is optional: joining without model leaves it undefined and renders the old line", () => {
    const engine = makeEngine();
    const { sessionId } = engine.createRoom({ name: "plain" });
    const { participant } = engine.joinSession("mcp-A", { sessionId, agentName: "Gemini", brand: "gemini" });
    expect(participant.model).toBeUndefined();
    engine.joinSession("mcp-B", { sessionId, agentName: "Other" });
    const b = engine.resolveCaller("mcp-B");
    expect(renderSnapshot(engine.snapshotForAgent(b.room, b.participant))).toContain("• Gemini (gemini) — active");
  });
});

describe("model identity — migration", () => {
  it("adds model/client to a pre-existing participants table and is idempotent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bothread-model-"));
    const dbPath = path.join(dir, "old.db");
    try {
      // Build a DB with the OLD participants schema (no model/client columns).
      const oldSql = SCHEMA_SQL.split("\n")
        .filter((l) => !/^\s*(model|client)\s+TEXT/.test(l))
        .join("\n");
      expect(oldSql).not.toMatch(/^\s*model\s+TEXT/m);
      const old = new Database(dbPath);
      old.exec(oldSql);
      const cols = (old.prepare("PRAGMA table_info(participants)").all() as { name: string }[]).map((c) => c.name);
      expect(cols).not.toContain("model");
      old
        .prepare(
          `INSERT INTO rooms (id, name, session_id, status, created_at, settings) VALUES ('room_x', 'old', 'old-session-id', 'active', 1, '{}')`
        )
        .run();
      old
        .prepare(
          `INSERT INTO participants (id, room_id, name, brand, kind, status, joined_at, last_seen_at) VALUES ('part_old', 'room_x', 'Old', 'claude', 'agent', 'left', 1, 1)`
        )
        .run();
      old.close();

      for (let i = 0; i < 2; i++) {
        const db = openDatabase(dbPath);
        const after = (db.prepare("PRAGMA table_info(participants)").all() as { name: string }[]).map((c) => c.name);
        expect(after).toEqual(expect.arrayContaining(["model", "client"]));
        const row = db.prepare("SELECT name, model, client FROM participants WHERE id = 'part_old'").get();
        expect(row).toEqual({ name: "Old", model: null, client: null });
        // A migrated DB works end to end.
        const engine = new Engine(db, new RoomBus());
        const { sessionId } = engine.createRoom({ name: `migrated-${i}` });
        const { participant } = engine.joinSession(`mcp-${i}`, { sessionId, agentName: "A", model: "Gemini 3 Pro" });
        expect(participant.model).toBe("Gemini 3 Pro");
        db.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------ Over MCP ------------------------------ */

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const db = openDatabase(":memory:");
  const bus = new RoomBus();
  const engine = new Engine(db, bus);
  const hub = new McpHub(engine);
  const config = { host: "127.0.0.1", port: 0, dbPath: ":memory:", installToken: "test", authRequired: false };
  const { app, attachWebSocket } = buildApp({ engine, bus, hub, config, token: "test" });
  server = http.createServer(app);
  attachWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function textOf(res: unknown): string {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

async function connectAgent(name: string) {
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
  return {
    client,
    call: (toolName: string, args: Record<string, unknown>) => client.callTool({ name: toolName, arguments: args }),
    close: () => client.close(),
  };
}

describe("model identity — MCP", () => {
  it("advertises model/client on join_session, nudges when missing, and shows them to others", async () => {
    const created = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "models" }),
    }).then((r) => r.json() as Promise<{ sessionId: string; room: { id: string } }>);
    const { sessionId } = created;

    const codex = await connectAgent("codex");
    const tools = await codex.client.listTools();
    const join = tools.tools.find((t) => t.name === "join_session")!;
    const props = (join.inputSchema as { properties: Record<string, { description?: string }> }).properties;
    expect(props.model?.description).toContain("exact AI model name and version");
    expect(props.client).toBeDefined();
    expect(join.description).toContain("model");

    // Joining without a model works but carries the one-line tip.
    const bare = await codex.call("join_session", { sessionId, agentName: "Codex", brand: "codex" });
    expect((bare as { isError?: boolean }).isError).toBeFalsy();
    expect(textOf(bare)).toContain(TIP);

    // Re-join with a model: no tip.
    const withModel = await codex.call("join_session", { sessionId, agentName: "Codex", brand: "codex", model: "GPT-5 Codex" });
    expect(textOf(withModel)).not.toContain("Tip: re-call join_session");

    const claude = await connectAgent("claude");
    const res = await claude.call("join_session", {
      sessionId,
      agentName: "Claude Code",
      brand: "claude",
      model: "Claude Opus 5.5",
      client: "Claude Code 2.1",
    });
    const text = textOf(res);
    expect(text).toContain("• Codex (codex, GPT-5 Codex) — active");
    expect(text).not.toContain("Tip: re-call join_session");
    const json = JSON.parse(text.match(/```json\n([\s\S]*?)\n```/)![1]!) as {
      participants: Array<{ name: string; model?: string; client?: string }>;
    };
    expect(json.participants.find((p) => p.name === "Codex")?.model).toBe("GPT-5 Codex");
    expect(json.participants.find((p) => p.name === "Claude Code")).toMatchObject({ model: "Claude Opus 5.5", client: "Claude Code 2.1" });

    // REST participants carry the fields for the room UI.
    const roomJson = (await fetch(`${baseUrl}/api/rooms/${created.room.id}`).then((r) => r.json())) as {
      participants: Array<{ name: string; model?: string; client?: string }>;
    };
    expect(roomJson.participants.find((p) => p.name === "Claude Code")).toMatchObject({
      model: "Claude Opus 5.5",
      client: "Claude Code 2.1",
    });

    // The join prompt asks for the model.
    const prompt = await claude.client.getPrompt({ name: "join", arguments: { sessionId } });
    const promptText = (prompt.messages[0]!.content as { text: string }).text;
    expect(promptText).toContain("model:");

    await codex.close();
    await claude.close();
  });
});
