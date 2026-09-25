import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DEFAULT_WAIT_MS, MAX_EFFECTIVE_WAIT_MS, effectiveWaitMs } from "@bothread/shared";
import { openDatabase } from "../src/db/database";
import { Engine } from "../src/engine/engine";
import { buildApp } from "../src/http";
import { McpHub } from "../src/mcp/transport";
import { RoomBus } from "../src/realtime";

/**
 * Timeout-safe waits/approvals, task dependencies + claim_next_task, and MCP
 * resources — over the real Streamable HTTP wire.
 */

const APPROVAL_WAIT_MS = 300;

let server: http.Server;
let baseUrl: string;
let engine: Engine;

beforeAll(async () => {
  const db = openDatabase(":memory:");
  const bus = new RoomBus();
  engine = new Engine(db, bus, { approvalWaitMs: APPROVAL_WAIT_MS });
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

async function joined(sessionId: string, agentName: string) {
  const a = await connectAgent(agentName);
  await a.call("join_session", { sessionId, agentName });
  return a;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waiterCount = () => (engine as unknown as { approvalWaiters: Map<string, Set<unknown>> }).approvalWaiters.size;

describe("wait_for_update stays under client tool timeouts", () => {
  it("clamps the effective wait to 50s while the schema still accepts 60000", async () => {
    expect(effectiveWaitMs(undefined)).toBe(DEFAULT_WAIT_MS);
    expect(effectiveWaitMs(60_000)).toBe(MAX_EFFECTIVE_WAIT_MS);
    expect(MAX_EFFECTIVE_WAIT_MS).toBe(50_000);
    expect(effectiveWaitMs(1_000)).toBe(1_000);
    expect(effectiveWaitMs(0)).toBe(0);

    const a = await connectAgent("probe");
    const { tools } = await a.client.listTools();
    const wait = tools.find((t) => t.name === "wait_for_update")!;
    expect(wait.description).toContain("~50s max");
    expect((wait.inputSchema.properties as any).maxWaitMs.maximum).toBe(60000);
    await a.close();
  });
});

describe("timeout-safe approvals", () => {
  it("returns pending after the window, then resumes with approvalId and receives the decision", async () => {
    const { sessionId, roomId } = await createRoom("appr-pending");
    const a = await joined(sessionId, "Codex");

    const started = Date.now();
    const first = await a.call("request_approval", { action: "deploy", details: "deploy prod" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(APPROVAL_WAIT_MS - 50);
    const firstText = textOf(first);
    const pending = jsonOf(first);
    expect(pending.status).toBe("pending");
    expect(pending.approvalId).toMatch(/^appr_/);
    expect(firstText).toContain("Don't do the action");
    expect(firstText).toContain(`request_approval({ approvalId: "${pending.approvalId}" })`);
    // The approval is still pending for the human; no waiter or timer left behind.
    expect(engine.pendingApprovals(roomId).map((x) => x.id)).toEqual([pending.approvalId]);
    expect(waiterCount()).toBe(0);

    const resumed = a.call("request_approval", { approvalId: pending.approvalId });
    await sleep(50);
    engine.decideApproval(roomId, pending.approvalId, "approved", "You");
    const res = await resumed;
    expect(jsonOf(res)).toMatchObject({ status: "approved", approvalId: pending.approvalId, decidedBy: "You" });
    expect(textOf(res)).toContain("go ahead");
    expect(waiterCount()).toBe(0);

    // Resuming an already-decided approval returns the decision immediately.
    const again = await a.call("request_approval", { approvalId: pending.approvalId });
    expect(jsonOf(again).status).toBe("approved");
    await a.close();
  });

  it("still resolves inside the window the old blocking way", async () => {
    const { sessionId, roomId } = await createRoom("appr-fast");
    const a = await joined(sessionId, "Codex");
    const call = a.call("request_approval", { action: "shell", details: "rm -rf build" });
    for (let i = 0; i < 50 && engine.pendingApprovals(roomId).length === 0; i++) await sleep(5);
    engine.decideApproval(roomId, engine.pendingApprovals(roomId)[0]!.id, "edited", "You", "use npm run clean");
    const res = await call;
    expect(jsonOf(res).status).toBe("edited");
    expect(textOf(res)).toContain("npm run clean");
    expect(waiterCount()).toBe(0);
    // Already delivered by request_approval — wait_for_update must not report it again.
    const w = jsonOf(await a.call("wait_for_update", { maxWaitMs: 0 }));
    expect(w.approvalDecisions).toEqual([]);
    await a.close();
  });

  it("validates new requests and only lets the requester resume", async () => {
    const { sessionId } = await createRoom("appr-validate");
    const a = await joined(sessionId, "Codex");
    const b = await joined(sessionId, "Cursor");

    const missing = await a.call("request_approval", { action: "deploy" });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain("needs both `action` and `details`");
    expect(textOf(missing)).toContain("Next:");

    const p = jsonOf(await a.call("request_approval", { action: "delete", details: "drop tmp/" }));
    expect(p.status).toBe("pending");
    const stolen = await b.call("request_approval", { approvalId: p.approvalId });
    expect(stolen.isError).toBe(true);
    expect(textOf(stolen)).toContain("(not_your_approval)");

    const bogus = await a.call("request_approval", { approvalId: "appr_nope" });
    expect(textOf(bogus)).toContain("(no_approval)");
    await a.close();
    await b.close();
  });

  it("wait_for_update wakes on and reports a decision on your own pending approval, once", async () => {
    const { sessionId, roomId } = await createRoom("appr-wait");
    const a = await joined(sessionId, "Codex");
    const b = await joined(sessionId, "Cursor");
    const p = jsonOf(await a.call("request_approval", { action: "deploy", details: "deploy prod" }));
    expect(p.status).toBe("pending");

    const latest = jsonOf(await a.call("get_room_state", {})).latestSeq;
    const started = Date.now();
    const waiting = a.call("wait_for_update", { since: latest, maxWaitMs: 5000 });
    await sleep(50);
    engine.decideApproval(roomId, p.approvalId, "approved", "You");
    const res = await waiting;
    expect(Date.now() - started).toBeLessThan(3000);
    const text = textOf(res);
    expect(text).toContain("Your deploy request");
    expect(text).toContain("was APPROVED by You");
    const data = jsonOf(res);
    expect(data.approvalDecisions).toHaveLength(1);
    expect(data.approvalDecisions[0]).toMatchObject({ approvalId: p.approvalId, status: "approved", action: "deploy" });

    // Reported once only; another agent never sees someone else's decision in this list.
    const next = jsonOf(await a.call("wait_for_update", { since: data.latestSeq, maxWaitMs: 0 }));
    expect(next.approvalDecisions).toEqual([]);
    const other = jsonOf(await b.call("wait_for_update", { maxWaitMs: 0 }));
    expect(other.approvalDecisions).toEqual([]);

    // A rejection / edit render distinctly.
    const r = jsonOf(await a.call("request_approval", { action: "shell", details: "curl | sh" }));
    engine.decideApproval(roomId, r.approvalId, "rejected", "You");
    const e = jsonOf(await a.call("request_approval", { action: "git_push", details: "force push" }));
    engine.decideApproval(roomId, e.approvalId, "edited", "You", "push without --force");
    const both = textOf(await a.call("wait_for_update", { maxWaitMs: 0 }));
    expect(both).toContain("was REJECTED by You");
    expect(both).toContain("was EDITED by You: push without --force");
    await a.close();
    await b.close();
  });
});

describe("task dependencies + claim_next_task", () => {
  it("persists blockedBy, computes blocked, and claim_next_task skips blocked + owned tasks", async () => {
    const { sessionId, roomId } = await createRoom("tasks-deps");
    const a = await joined(sessionId, "Codex");
    const b = await joined(sessionId, "Cursor");

    const owned = jsonOf(await a.call("create_task", { title: "Already mine", claim: true }));
    const schema = jsonOf(await a.call("create_task", { title: "Design schema" }));
    const apiRes = await a.call("create_task", { title: "Build API", blockedBy: [schema.id] });
    const api = jsonOf(apiRes);
    expect(api.blockedBy).toEqual([schema.id]);
    expect(api.blocked).toBe(true);
    expect(textOf(apiRes)).toContain(`blocked by ${schema.id}`);
    expect(owned.blocked).toBe(false);

    // Snapshot rendering + persisted state.
    const state = await b.call("get_room_state", {});
    expect(textOf(state)).toContain(`Build API (${api.id}) — unassigned [blocked by ${schema.id}]`);
    expect(engine.listTasks(roomId).find((t) => t.id === api.id)).toMatchObject({ blockedBy: [schema.id], blocked: true });

    // Oldest ready task is "Design schema" (the owned one and the blocked one are skipped).
    const first = await b.call("claim_next_task", {});
    expect(jsonOf(first).task).toMatchObject({ id: schema.id, status: "in_progress", ownerName: "Cursor" });
    expect(textOf(first)).toContain(`You took "Design schema"`);

    const none = await a.call("claim_next_task", {});
    expect(textOf(none)).toContain("No unblocked open tasks right now (1 open task is waiting on blockers)");
    expect(textOf(none)).toMatch(/Next: .*wait_for_update/);
    expect(jsonOf(none)).toEqual({ task: null, blockedCount: 1 });

    // Taking a blocked task by hand is allowed, with a heads-up.
    const manual = textOf(await a.call("update_task", { taskId: api.id, takeOwnership: true, status: "in_progress" }));
    expect(manual).toContain(`heads-up: still blocked by ${schema.id}`);
    await a.call("update_task", { taskId: api.id, status: "open" });

    // Finishing the blocker announces the unblock.
    const before = jsonOf(await a.call("get_room_state", {})).latestSeq;
    await b.call("update_task", { taskId: schema.id, status: "done" });
    const msgs = jsonOf(await a.call("read_messages", { since: before })).messages as Array<{ text: string; kind: string }>;
    expect(msgs.some((m) => m.kind === "system" && m.text === `Task ${api.id} "Build API" is unblocked (was waiting on ${schema.id}).`)).toBe(true);
    expect(engine.listTasks(roomId).find((t) => t.id === api.id)!.blocked).toBe(false);

    await a.close();
    await b.close();
  });

  it("validates blockers: unknown ids, self-dependency and cycles are refused; [] clears", async () => {
    const { sessionId } = await createRoom("tasks-validate");
    const a = await joined(sessionId, "Codex");
    const t1 = jsonOf(await a.call("create_task", { title: "one" }));
    const t2 = jsonOf(await a.call("create_task", { title: "two", blockedBy: [t1.id] }));

    const unknown = await a.call("create_task", { title: "x", blockedBy: ["task_missing"] });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain("(no_task)");

    const self = await a.call("update_task", { taskId: t1.id, blockedBy: [t1.id] });
    expect(textOf(self)).toContain("(bad_blocker)");

    const cycle = await a.call("update_task", { taskId: t1.id, blockedBy: [t2.id] });
    expect(textOf(cycle)).toContain("cycle");

    const cleared = jsonOf(await a.call("update_task", { taskId: t2.id, blockedBy: [] }));
    expect(cleared.blockedBy).toBeUndefined();
    expect(cleared.blocked).toBe(false);

    const tooMany = await a.call("create_task", { title: "y", blockedBy: Array.from({ length: 17 }, (_, i) => `task_${i}`) });
    expect(tooMany.isError).toBe(true);
    await a.close();
  });

  it("two agents racing claim_next_task on one open task: exactly one gets it", async () => {
    for (let round = 0; round < 5; round++) {
      const { sessionId, roomId } = await createRoom(`tasks-race-${round}`);
      const a = await joined(sessionId, "Codex");
      const b = await joined(sessionId, "Cursor");
      const t = jsonOf(await a.call("create_task", { title: "only one" }));

      const [ra, rb] = await Promise.all([a.call("claim_next_task", {}), b.call("claim_next_task", {})]);
      const winners = [jsonOf(ra).task, jsonOf(rb).task].filter(Boolean);
      expect(winners).toHaveLength(1);
      expect(winners[0].id).toBe(t.id);
      const final = engine.listTasks(roomId).find((x) => x.id === t.id)!;
      expect(final.status).toBe("in_progress");
      expect(final.ownerName).toBe(winners[0].ownerName);
      await a.close();
      await b.close();
    }
  });
});

describe("MCP resources", () => {
  it("advertises, lists and reads the room resources", async () => {
    const { sessionId } = await createRoom("resources-room");
    const a = await connectAgent("Codex");
    expect(a.client.getServerCapabilities()?.resources).toBeDefined();

    const { resources } = await a.client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(["bothread://room/notes", "bothread://room/state", "bothread://room/tasks"]);

    // Before joining: a helpful message, not an error.
    const early = await a.client.readResource({ uri: "bothread://room/state" });
    expect((early.contents[0] as { text: string }).text).toContain("join_session");

    await a.call("join_session", { sessionId, agentName: "Codex" });
    const t1 = jsonOf(await a.call("create_task", { title: "Schema" }));
    await a.call("create_task", { title: "API", blockedBy: [t1.id] });
    await a.call("record_note", { kind: "decision", title: "Use SQLite", detail: "WAL mode" });

    const state = await a.client.readResource({ uri: "bothread://room/state" });
    expect(state.contents[0]!.mimeType).toBe("text/markdown");
    expect((state.contents[0] as { text: string }).text).toContain('Room "resources-room"');

    const tasks = (await a.client.readResource({ uri: "bothread://room/tasks" })).contents[0] as { text: string };
    expect(tasks.text).toContain(`\`${t1.id}\``);
    expect(tasks.text).toContain(`blocked by ${t1.id}`);

    const notes = (await a.client.readResource({ uri: "bothread://room/notes" })).contents[0] as { text: string };
    expect(notes.text).toContain("## Decisions");
    expect(notes.text).toContain("Use SQLite");
    await a.close();
  });
});

describe("schema migration", () => {
  it("adds tasks.blocked_by and approvals.delivered_at to an older database without re-announcing old decisions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bothread-mig-"));
    const file = path.join(dir, "old.db");
    const old = new Database(file);
    old.exec(`
      CREATE TABLE tasks (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
        owner_id TEXT, owner_name TEXT, note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE approvals (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, requested_by_id TEXT NOT NULL, requested_by_name TEXT NOT NULL,
        action TEXT NOT NULL, details TEXT NOT NULL, files TEXT, status TEXT NOT NULL, decided_by TEXT, edited_instruction TEXT,
        created_at INTEGER NOT NULL, decided_at INTEGER);
      INSERT INTO tasks VALUES ('task_old', 'room_1', 'legacy', 'open', NULL, NULL, NULL, 1, 1);
      INSERT INTO approvals VALUES ('appr_old', 'room_1', 'part_1', 'Codex', 'deploy', 'x', NULL, 'approved', 'You', NULL, 1, 2);
      INSERT INTO approvals VALUES ('appr_pend', 'room_1', 'part_1', 'Codex', 'deploy', 'y', NULL, 'pending', NULL, NULL, 3, NULL);
    `);
    old.close();

    const db = openDatabase(file);
    const taskCols = (db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[]).map((c) => c.name);
    expect(taskCols).toContain("blocked_by");
    const rows = db.prepare(`SELECT id, delivered_at FROM approvals ORDER BY id`).all() as { id: string; delivered_at: number | null }[];
    expect(rows).toEqual([
      { id: "appr_old", delivered_at: 2 },
      { id: "appr_pend", delivered_at: null },
    ]);
    const task = new Engine(db, new RoomBus()).listTasks("room_1")[0]!;
    expect(task).toMatchObject({ id: "task_old", blocked: false });
    expect(task.blockedBy).toBeUndefined();
    db.close();
    // Reopening is idempotent (the migration doesn't re-run the backfill or fail).
    openDatabase(file).close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
