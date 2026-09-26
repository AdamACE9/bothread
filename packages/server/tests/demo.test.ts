import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database";
import { DEMO_ROOM_NAME, demoStatus, startDemo, stopDemo } from "../src/demo";
import { Engine } from "../src/engine/engine";
import { buildApp } from "../src/http";
import { McpHub } from "../src/mcp/transport";
import { RoomBus } from "../src/realtime";

/**
 * Demo mode, end to end: the simulated agents are real MCP clients talking to
 * a real hub over HTTP, compressed to a few seconds with a speed multiplier.
 */

const SPEED = "40";
const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let server: http.Server;
let baseUrl: string;
let engine: Engine;
let hub: McpHub;
const prevSpeed = process.env.BOTHREAD_DEMO_SPEED;

async function waitFor<T>(fn: () => T | undefined | false, timeoutMs = 15_000, label = "condition"): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const post = (p: string) =>
  fetch(`${baseUrl}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then(
    (r) => r.json() as Promise<{ roomId: string; started: boolean }>
  );

beforeAll(async () => {
  process.env.BOTHREAD_DEMO_SPEED = SPEED;
  const db = openDatabase(":memory:");
  const bus = new RoomBus();
  // Short approval window so the demo exercises the timeout-safe resume loop.
  engine = new Engine(db, bus, { approvalWaitMs: 300 });
  hub = new McpHub(engine);
  const config = { host: "127.0.0.1", port: 0, dbPath: ":memory:", installToken: "test", authRequired: false };
  const { app, attachWebSocket } = buildApp({ engine, bus, hub, config, token: "test" });
  server = http.createServer(app);
  attachWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await stopDemo(engine);
  engine.drainApprovals();
  await hub.closeAll();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (prevSpeed === undefined) delete process.env.BOTHREAD_DEMO_SPEED;
  else process.env.BOTHREAD_DEMO_SPEED = prevSpeed;
});

describe("demo mode", () => {
  it("POST /api/demo runs the whole story through real MCP clients", async () => {
    const before = await fetch(`${baseUrl}/api/demo`).then((r) => r.json() as Promise<{ running: boolean }>);
    expect(before.running).toBe(false);

    const { roomId, started } = await post("/api/demo");
    expect(started).toBe(true);
    const room = engine.getRoom(roomId)!;
    expect(room.name).toBe(DEMO_ROOM_NAME);
    expect(room.settings.requireApprovalFor).toEqual(["deploy"]);
    const projectPath = room.projectPath;
    if (hasGit) {
      expect(projectPath).toBeTruthy();
      // :memory: hub → the demo repo lives in the OS temp dir, never a real project.
      expect(path.resolve(projectPath!).startsWith(path.resolve(os.tmpdir()))).toBe(true);
    }

    // A second start while it runs reuses the same room.
    const again = await post("/api/demo");
    expect(again).toEqual({ roomId, started: false });

    await waitFor(() => demoStatus(engine).phase === "listening", 18_000, "the script to finish");
    // The deploy request is on the board and waiting for the human.
    await waitFor(() => engine.pendingApprovals(roomId).length === 1, 5_000, "the pending deploy approval");

    const agents = engine.listParticipants(roomId).filter((p) => p.kind === "agent");
    expect(agents.map((a) => a.name).sort()).toEqual(["Claude Code", "Codex", "Cursor"]);
    expect(agents.find((a) => a.name === "Claude Code")!.capabilities).toEqual(["can-run-tests"]);
    expect(agents.every((a) => a.status === "active")).toBe(true);

    const tasks = engine.listTasks(roomId);
    expect(tasks.length).toBe(4);
    expect(tasks.some((t) => (t.blockedBy ?? []).length > 0)).toBe(true);
    expect(tasks.filter((t) => t.status === "done").length).toBe(3);

    const audit = engine.listAudit(roomId, 500);
    const kinds = audit.map((a) => a.type);
    expect(kinds).toContain("lease.collision");
    expect(kinds).toContain("handoff.request");
    expect(kinds).toContain("approval.request");

    const notes = engine.listNotes(roomId);
    expect(notes.map((n) => n.kind).sort()).toEqual(["decision", "verification"]);

    const thread = engine.snapshotForOverseer(roomId)!.thread;
    expect(thread.some((m) => m.replyToSeq !== undefined && m.mentions.includes("Codex"))).toBe(true);
    expect(thread.some((m) => m.text.includes("```ts"))).toBe(true);
    expect(thread.some((m) => /Prevented: Codex tried to claim src\/physics\.ts/.test(m.text))).toBe(true);
    expect(thread.some((m) => /src\/physics\.ts` is free now/.test(m.text))).toBe(true);

    if (hasGit) {
      const ready = engine.listBranches(roomId).filter((b) => b.status === "ready");
      expect(ready.length).toBe(3);
      expect(ready.every((b) => (b.diff ?? "").length > 0)).toBe(true);
      const claude = ready.find((b) => b.participantName === "Claude Code")!;
      expect(claude.diff).toContain("+export const COYOTE_FRAMES = 6;");
    }

    // The human approves: the agent hears it through its resumed request and reacts.
    const approval = engine.pendingApprovals(roomId)[0]!;
    engine.decideApproval(roomId, approval.id, "approved");
    await waitFor(
      () => engine.snapshotForOverseer(roomId)!.thread.some((m) => m.author === "Codex" && m.text.startsWith("Approved, deploying preview")),
      5_000,
      "Codex to react to the approval"
    );

    // Stop: agents leave, clients close, the temp repo is removed.
    await stopDemo(engine);
    expect(demoStatus(engine).running).toBe(false);
    expect(engine.listParticipants(roomId).filter((p) => p.kind === "agent").every((p) => p.status === "left")).toBe(true);
    if (projectPath) expect(fs.existsSync(projectPath)).toBe(false);
    expect(hub.count).toBe(0);

    // Starting again recreates cleanly: one demo room, a new id.
    const fresh = await post("/api/demo");
    expect(fresh.started).toBe(true);
    expect(fresh.roomId).not.toBe(roomId);
    expect(engine.listRooms().filter((r) => r.name === DEMO_ROOM_NAME).length).toBe(1);
    await stopDemo(engine);
  });

  it("runs without git: no project folder, everything else still happens", async () => {
    const dbPath = ":memory:";
    const { roomId } = await startDemo(engine, { mcpUrl: `${baseUrl}/mcp`, dbPath, noGit: true, speed: 60 });
    expect(engine.getRoom(roomId)!.projectPath).toBeUndefined();
    await waitFor(() => demoStatus(engine).phase === "listening", 18_000, "the script to finish");
    expect(demoStatus(engine).git).toBe(false);
    expect(engine.listAudit(roomId, 500).some((a) => a.type === "lease.collision")).toBe(true);
    expect(engine.listBranches(roomId).length).toBe(0);
    await stopDemo(engine);
  });
});

describe("bothread demo (CLI)", () => {
  it("--help explains the command", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("BOTHREAD_") && k !== "FORCE_COLOR") env[k] = v;
    const r = spawnSync(process.execPath, [path.join(repoRoot, "bin", "bothread.mjs"), "demo", "--help"], {
      cwd: repoRoot,
      env: { ...env, NO_COLOR: "1", BOTHREAD_NO_TELEMETRY: "1", BOTHREAD_NO_OPEN: "1" },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("bothread demo");
    expect(r.stdout).toContain("Demo: platformer game");
    expect(r.stdout).toContain("--no-open");
    const help = spawnSync(process.execPath, [path.join(repoRoot, "bin", "bothread.mjs"), "help"], {
      cwd: repoRoot,
      env: { ...env, NO_COLOR: "1" },
      encoding: "utf8",
    });
    expect(help.stdout).toMatch(/^\s+demo\s+Watch 3 simulated agents/m);
  });
});
