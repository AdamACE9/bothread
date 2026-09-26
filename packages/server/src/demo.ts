/**
 * Demo mode: three simulated agents (Claude Code, Cursor, Codex) building a
 * small platformer in one room, so a brand-new user sees Bothread working
 * before they've connected anything.
 *
 * Nothing here writes rows directly. Every agent is a real MCP SDK client
 * talking to this hub's own /mcp endpoint, so presence, "listening", the audit
 * trail, collisions, hand-offs, approvals and git diffs are exactly what a real
 * agent would produce. The only non-agent actions are the ones the hub itself
 * performs for a human: creating the room and posting the kickoff brief.
 *
 * The demo project is a throwaway git repo inside Bothread's data dir (or an OS
 * temp dir when the database is `:memory:`, removed again on stop). It never
 * touches the user's own projects.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Request, Router } from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { dataDir, type HubConfig } from "./config";
import type { Engine } from "./engine/engine";
import { logger } from "./logger";
import { VERSION } from "./version";

export const DEMO_ROOM_NAME = "Demo: platformer game";
/** Marker inside the demo repo's .git dir: "this folder is ours, safe to recreate". */
const MARKER = "bothread-demo";

export interface DemoOptions {
  /** The hub's own MCP endpoint, e.g. http://127.0.0.1:4889/mcp. */
  mcpUrl: string;
  /** Bearer token, when the hub requires one. */
  token?: string | null;
  /** The hub's DB path; `:memory:` puts the demo repo in an OS temp dir, cleaned up on stop. */
  dbPath?: string;
  /** Pace multiplier: 2 = twice as fast. Default: BOTHREAD_DEMO_SPEED, else 1 (~90s script). */
  speed?: number;
  /** Where to put the demo repo (default: the data dir). Mostly for tests. */
  baseDir?: string;
  /** Skip git entirely (as if it weren't installed). Mostly for tests. */
  noGit?: boolean;
}

export type DemoPhase = "starting" | "script" | "listening" | "stopped";

export interface DemoStatus {
  running: boolean;
  roomId: string | null;
  phase: DemoPhase | null;
  step: number;
  totalSteps: number;
  git: boolean;
  projectPath: string | null;
}

interface ToolOutcome {
  text: string;
  json: any;
  isError: boolean;
}

class DemoStopped extends Error {}

/** Number of paced steps in the script (for progress in GET /api/demo). */
const SCRIPT_STEPS = 40;

/* ------------------------------ demo project ------------------------------ */

const FILES_V0: Record<string, string> = {
  "README.md": `# Tiny platformer

A small browser platformer used by the Bothread demo. Three simulated agents
split the work: physics, the level loader, and the world 1 boss.
`,
  ".gitignore": `.bothread/\nnode_modules/\n`,
  "src/physics.ts": `// Platformer physics: gravity, jumping and ground collision.
export const GRAVITY = 0.5;
export const JUMP_VELOCITY = -9;

export interface Body {
  x: number;
  y: number;
  vy: number;
  onGround: boolean;
}

export function step(body: Body, groundY: number): Body {
  let vy = body.vy + GRAVITY;
  let y = body.y + vy;
  let onGround = false;
  if (y >= groundY) {
    y = groundY;
    vy = 0;
    onGround = true;
  }
  return { ...body, y, vy, onGround };
}

export function jump(body: Body): Body {
  return body.onGround ? { ...body, vy: JUMP_VELOCITY, onGround: false } : body;
}
`,
  "src/levels/loader.ts": `// Loads a level. TODO: real format.
export interface Level {
  name: string;
  tiles: string[];
}

export function loadLevel(name: string): Level {
  return { name, tiles: [] };
}
`,
  "src/boss.ts": `// World 1 boss. TODO: everything.
export interface Boss {
  name: string;
  hp: number;
}

export function createBoss(): Boss {
  return { name: "Mossback", hp: 10 };
}
`,
};

/** Claude's jump tuning: stronger arc plus coyote time. */
const PHYSICS_V1 = `// Platformer physics: gravity, jumping and ground collision.
export const GRAVITY = 0.6;
export const JUMP_VELOCITY = -11;
/** Frames after walking off a ledge where a jump still counts. */
export const COYOTE_FRAMES = 6;

export interface Body {
  x: number;
  y: number;
  vy: number;
  onGround: boolean;
  framesSinceGround: number;
}

export function step(body: Body, groundY: number): Body {
  let vy = body.vy + GRAVITY;
  let y = body.y + vy;
  let onGround = false;
  if (y >= groundY) {
    y = groundY;
    vy = 0;
    onGround = true;
  }
  const framesSinceGround = onGround ? 0 : body.framesSinceGround + 1;
  return { ...body, y, vy, onGround, framesSinceGround };
}

export function jump(body: Body): Body {
  const canJump = body.onGround || body.framesSinceGround < COYOTE_FRAMES;
  return canJump ? { ...body, vy: JUMP_VELOCITY, onGround: false, framesSinceGround: COYOTE_FRAMES } : body;
}
`;

/** Codex's follow-up: a gravityScale so the boss can slam down harder. */
const PHYSICS_V2 = PHYSICS_V1.replace(
  "export function step(body: Body, groundY: number): Body {\n  let vy = body.vy + GRAVITY;",
  "export function step(body: Body, groundY: number, gravityScale = 1): Body {\n  let vy = body.vy + GRAVITY * gravityScale;"
);

const LOADER_V1 = `// Loads a level from its JSON file. One character per tile keeps levels diffable.
export type Tile = "." | "#" | "^" | "B";

export interface Level {
  name: string;
  tiles: Tile[][];
  spawn: { x: number; y: number };
}

const VALID = new Set<string>([".", "#", "^", "B"]);

export function parseLevel(name: string, rows: string[]): Level {
  if (!rows.length) throw new Error(\`Level \${name} is empty\`);
  const width = rows[0]!.length;
  const tiles = rows.map((row, y) => {
    if (row.length !== width) throw new Error(\`Level \${name}: row \${y} is \${row.length} wide, expected \${width}\`);
    return [...row].map((ch) => {
      if (!VALID.has(ch)) throw new Error(\`Level \${name}: unknown tile "\${ch}"\`);
      return ch as Tile;
    });
  });
  return { name, tiles, spawn: { x: 1, y: rows.length - 2 } };
}

export async function loadLevel(name: string): Promise<Level> {
  const res = await fetch(\`/levels/\${name}.json\`);
  const rows = (await res.json()) as string[];
  return parseLevel(name, rows);
}
`;

const BOSS_V1 = `// World 1 boss: Mossback. Three phases; the ground slam uses a heavier gravity.
import { step, type Body } from "./physics";

export type Phase = "patrol" | "slam" | "stunned";

export interface Boss {
  name: string;
  hp: number;
  phase: Phase;
  body: Body;
}

export const SLAM_GRAVITY_SCALE = 2.5;

export function createBoss(): Boss {
  return {
    name: "Mossback",
    hp: 12,
    phase: "patrol",
    body: { x: 40, y: 0, vy: 0, onGround: true, framesSinceGround: 0 },
  };
}

export function hitbox(boss: Boss): { w: number; h: number } {
  // Smaller while stunned so the player has to commit to the jump.
  return boss.phase === "stunned" ? { w: 2, h: 1 } : { w: 3, h: 2 };
}

export function tick(boss: Boss, groundY: number): Boss {
  const scale = boss.phase === "slam" ? SLAM_GRAVITY_SCALE : 1;
  const body = step(boss.body, groundY, scale);
  const landed = boss.phase === "slam" && body.onGround;
  return { ...boss, body, phase: landed ? "stunned" : boss.phase };
}
`;

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Is this folder a demo repo we created (and so may delete)? */
function isOurs(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git", MARKER));
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
}

/**
 * Create a fresh demo repo. Returns its path and whether it's a temp dir to
 * delete on stop. Never reuses or deletes a folder it didn't create.
 */
function scaffoldProject(opts: DemoOptions): { dir: string; temp: boolean } {
  const temp = !opts.baseDir && opts.dbPath === ":memory:";
  let dir: string;
  if (temp) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bothread-demo-"));
  } else {
    const base = opts.baseDir ?? dataDir();
    fs.mkdirSync(base, { recursive: true });
    dir = path.join(base, "demo-project");
    if (fs.existsSync(dir)) {
      if (isOurs(dir)) fs.rmSync(dir, { recursive: true, force: true });
      else dir = fs.mkdtempSync(path.join(base, "demo-project-"));
    }
    fs.mkdirSync(dir, { recursive: true });
  }
  writeFiles(dir, FILES_V0);
  git(dir, ["init", "-q"]);
  fs.writeFileSync(path.join(dir, ".git", MARKER), "Created by the Bothread demo. Safe to delete.\n");
  // Local identity so the hub's branch commits and "Merge" work even when the
  // machine has no global git identity. Hooks off: this is a sandbox repo.
  git(dir, ["config", "user.name", "Bothread demo"]);
  git(dir, ["config", "user.email", "demo@bothread.local"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["config", "core.hooksPath", ".git/no-hooks"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--no-verify", "-m", "Start the platformer"]);
  return { dir, temp };
}

/* ------------------------------- the agents ------------------------------- */

function textOf(res: unknown): string {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

function jsonOf(text: string): any {
  const m = text.match(/```json\n([\s\S]*?)\n```\s*$/);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]!);
  } catch {
    return undefined;
  }
}

interface AgentSpec {
  name: string;
  brand: string;
  capabilities?: string[];
}

class DemoAgent {
  client: Client;
  since = 0;
  private transport: StreamableHTTPClientTransport;
  /** In-flight requests, aborted on close. */
  private live = new Set<AbortController>();

  constructor(
    readonly spec: AgentSpec,
    mcpUrl: string,
    token: string | null | undefined
  ) {
    this.transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
      fetch: (url, init) => this.fetch(url, init),
    });
    this.client = new Client({ name: `bothread-demo-${spec.brand}`, version: VERSION });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  /**
   * The SDK hands every request the transport's one shared AbortSignal, and
   * each fetch leaves an abort listener on it until GC. A demo that idles for
   * hours makes thousands of calls, so give each request its own signal and
   * abort whatever is still in flight on close instead.
   */
  private async fetch(url: string | URL, init?: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    this.live.add(ctrl);
    const done = (): void => {
      this.live.delete(ctrl);
    };
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (!res.body || [101, 204, 205, 304].includes(res.status)) {
        done();
        return res;
      }
      const body = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ flush: done }));
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (err) {
      done();
      throw err;
    }
  }

  async raw(tool: string, args: Record<string, unknown>): Promise<ToolOutcome> {
    const res = await this.client.callTool({ name: tool, arguments: args }, undefined, { timeout: 70_000 });
    const text = textOf(res);
    return { text, json: jsonOf(text), isError: !!(res as { isError?: boolean }).isError };
  }

  async close(): Promise<void> {
    try {
      await this.transport.terminateSession();
    } catch {
      /* already gone */
    }
    try {
      await this.client.close();
    } catch {
      /* ignore */
    }
    for (const c of this.live) c.abort();
    this.live.clear();
  }
}

/* ------------------------------- the runner ------------------------------- */

export class DemoRunner {
  roomId: string | null = null;
  phase: DemoPhase = "starting";
  step = 0;
  readonly totalSteps = SCRIPT_STEPS;
  projectPath: string | null = null;

  private stopped = false;
  private tempDir: string | null = null;
  private speed: number;
  private agents = new Map<string, DemoAgent>();
  private sleepers = new Set<{ timer: ReturnType<typeof setTimeout>; resolve: () => void }>();
  private loops: Promise<void>[] = [];
  private script: Promise<void> | null = null;
  private repliedTo = new Set<number>();

  constructor(
    private engine: Engine,
    private opts: DemoOptions
  ) {
    const envSpeed = Number(process.env.BOTHREAD_DEMO_SPEED);
    const s = opts.speed ?? (Number.isFinite(envSpeed) && envSpeed > 0 ? envSpeed : 1);
    this.speed = Math.min(1000, Math.max(0.1, s));
  }

  get running(): boolean {
    return !this.stopped && !!this.roomId && !!this.engine.getRoom(this.roomId);
  }

  status(): DemoStatus {
    return {
      running: this.running,
      roomId: this.roomId,
      phase: this.phase,
      step: this.step,
      totalSteps: this.totalSteps,
      git: !!this.projectPath,
      projectPath: this.projectPath,
    };
  }

  /** Create the room and kick off the script in the background. Resolves with the room id. */
  async start(): Promise<string> {
    let projectPath: string | undefined;
    if (!this.opts.noGit && gitAvailable()) {
      try {
        const p = scaffoldProject(this.opts);
        projectPath = p.dir;
        if (p.temp) this.tempDir = p.dir;
      } catch (err) {
        logger.warn({ err }, "demo: couldn't scaffold the git project; running without diffs");
        projectPath = undefined;
      }
    }
    this.projectPath = projectPath ?? null;

    const { room, sessionId } = this.engine.createRoom({
      name: DEMO_ROOM_NAME,
      projectPath,
      settings: { requireApprovalFor: ["deploy"] },
    });
    this.roomId = room.id;

    const agents: AgentSpec[] = [
      { name: "Claude Code", brand: "claude", capabilities: ["can-run-tests"] },
      { name: "Cursor", brand: "cursor" },
      { name: "Codex", brand: "codex" },
    ];
    for (const spec of agents) this.agents.set(spec.name, new DemoAgent(spec, this.opts.mcpUrl, this.opts.token));

    this.script = this.run(sessionId).catch((err) => {
      if (err instanceof DemoStopped || this.stopped) return;
      logger.warn({ err }, "demo: script failed");
    });
    return room.id;
  }

  /* --------------------------- pacing + actions --------------------------- */

  /** Wait `ms` (divided by the speed). Resolves early, then throws, if the demo stops. */
  private async pace(ms: number): Promise<void> {
    await this.sleep(ms / this.speed);
    if (this.stopped) throw new DemoStopped();
    this.step++;
  }

  private sleep(ms: number): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      const entry = {
        resolve: () => {
          this.sleepers.delete(entry);
          resolve();
        },
        timer: setTimeout(() => entry.resolve(), Math.max(0, ms)),
      };
      this.sleepers.add(entry);
    });
  }

  private agent(name: string): DemoAgent {
    return this.agents.get(name)!;
  }

  /**
   * One tool call, the way a well-behaved agent makes it: if the human paused
   * the room, wait for the resume and retry. Other errors are returned (and
   * logged), never thrown, so one odd state doesn't kill the whole demo.
   */
  private async act(name: string, tool: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> {
    for (;;) {
      if (this.stopped) throw new DemoStopped();
      if (this.roomId && !this.engine.getRoom(this.roomId)) {
        // The human deleted the demo room: nothing left to drive.
        void this.stop();
        throw new DemoStopped();
      }
      const out = await this.agent(name).raw(tool, args);
      if (out.isError && /\(paused\)/.test(out.text)) {
        await this.sleep(1500);
        continue;
      }
      if (out.isError) logger.debug({ tool, agent: name, text: out.text }, "demo: tool error");
      return out;
    }
  }

  private say(name: string, text: string, extra: Record<string, unknown> = {}): Promise<ToolOutcome> {
    return this.act(name, "send_message", { text, ...extra });
  }

  /** Write a file in the demo repo (only ever inside it). No-op without git. */
  private edit(rel: string, content: string): void {
    if (!this.projectPath) return;
    const file = path.resolve(this.projectPath, rel);
    if (!file.startsWith(path.resolve(this.projectPath) + path.sep)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }

  /**
   * Keep an agent parked in wait_for_update, like a real agent between tasks,
   * so its presence reads "listening". Claude Code also answers the human once
   * per message, since these agents can't actually do what they're asked.
   */
  private listen(name: string): Promise<void> {
    const a = this.agent(name);
    const maxWaitMs = Math.round(Math.min(45_000, Math.max(250, 30_000 / this.speed)));
    const loop = async () => {
      while (!this.stopped) {
        let out: ToolOutcome;
        try {
          out = await a.raw("wait_for_update", { since: a.since, maxWaitMs });
        } catch {
          if (this.stopped) return;
          await this.sleep(1000);
          continue;
        }
        if (out.isError) {
          if (/\((revoked|bad_session|closed|no_room)\)/.test(out.text)) return;
          await this.sleep(1000);
          continue;
        }
        const res = out.json as { latestSeq?: number; newMessages?: Array<{ seq: number; kind: string; author: string }> } | undefined;
        if (typeof res?.latestSeq === "number") a.since = res.latestSeq;
        if (name === "Claude Code" && this.phase === "listening") {
          for (const m of res?.newMessages ?? []) {
            if (m.kind !== "human" || this.repliedTo.has(m.seq)) continue;
            this.repliedTo.add(m.seq);
            await this.say(
              name,
              "Heads up: I'm a simulated demo agent, so I can't act on that. Connect a real one with Connect agent and it will.",
              { replyToSeq: m.seq }
            ).catch(() => undefined);
          }
        }
      }
    };
    const p = loop();
    this.loops.push(p);
    return p;
  }

  /** Ask for the deploy and keep resuming the (timeout-safe) request until the human decides. */
  private async approvalFlow(taskId: string | undefined): Promise<void> {
    const X = "Codex";
    let out = await this.act(X, "request_approval", {
      action: "deploy",
      details: "Deploy a preview build of world 1 (physics, level loader, Mossback boss) to the preview URL. Not production.",
    });
    let decision = out.json as { status?: string; approvalId?: string; editedInstruction?: string } | undefined;
    const approvalId = decision?.approvalId;
    while (!this.stopped && decision?.status === "pending" && approvalId) {
      out = await this.act(X, "request_approval", { approvalId });
      decision = (out.json as typeof decision) ?? decision;
      if (out.isError) await this.sleep(1000);
    }
    if (this.stopped || !decision) return;
    if (decision.status === "approved") {
      await this.say(X, "Approved, deploying preview…");
      await this.sleep(2500 / this.speed);
      await this.say(X, "Preview is up (simulated): world 1 with the new jump and Mossback. Marking the deploy task done.");
      if (taskId) await this.act(X, "update_task", { taskId, status: "done" });
    } else if (decision.status === "rejected") {
      await this.say(X, "OK, holding off.");
      if (taskId) await this.act(X, "update_task", { taskId, status: "open", note: "Deploy declined by the human. Waiting for a go-ahead." });
    } else if (decision.status === "edited") {
      await this.say(X, `Got it, doing this instead: ${decision.editedInstruction ?? "(your instruction)"}`);
    }
  }

  /* ------------------------------ the script ------------------------------ */

  private async run(sessionId: string): Promise<void> {
    const C = "Claude Code";
    const U = "Cursor";
    const X = "Codex";
    this.phase = "script";

    for (const name of [C, U, X]) {
      await this.pace(name === C ? 1200 : 1800);
      const a = this.agent(name);
      await a.connect();
      const joined = await this.act(name, "join_session", {
        sessionId,
        agentName: a.spec.name,
        brand: a.spec.brand,
        ...(a.spec.capabilities ? { capabilities: a.spec.capabilities } : {}),
      });
      a.since = (joined.json as { latestSeq?: number } | undefined)?.latestSeq ?? 0;
      void this.listen(name);
    }

    await this.pace(2000);
    this.engine.postSystemMessage(
      this.roomId!,
      "Demo brief: build a small platformer. Tight jump physics, a level loader for world 1, and a boss at the end. " +
        "Split the work, stay out of each other's files, and ask before you deploy.",
      "steering"
    );

    await this.pace(3000);
    await this.say(C, "Hi both. Plan:\n- I take physics (jump arc, coyote time), I can run the tests\n- Level loader and boss are up for grabs\n- Putting it all on the task board now");

    await this.pace(2000);
    const t1 = (await this.act(C, "create_task", { title: "Tune jump physics", note: "Apex at 3 tiles, add coyote time.", claim: true })).json?.id as
      | string
      | undefined;
    await this.pace(1500);
    const t2 = (await this.act(C, "create_task", { title: "Level loader for world 1", note: "Levels as data, not code." })).json?.id as string | undefined;
    await this.pace(1500);
    const t3 = (
      await this.act(C, "create_task", {
        title: "Boss fight: Mossback",
        note: "Needs the final gravity from physics.ts.",
        ...(t1 ? { blockedBy: [t1] } : {}),
      })
    ).json?.id as string | undefined;
    await this.pace(1500);
    const t4 = (
      await this.act(C, "create_task", {
        title: "Ship a preview build",
        note: "Deploy needs the human's OK.",
        ...(t2 && t3 ? { blockedBy: [t2, t3] } : {}),
      })
    ).json?.id as string | undefined;

    await this.pace(2500);
    await this.act(C, "claim_files", { paths: ["src/physics.ts"], reason: "tuning the jump arc" });

    await this.pace(2500);
    await this.act(U, "claim_next_task");
    await this.pace(1500);
    await this.act(U, "claim_files", { paths: ["src/levels/**"], reason: "level loader" });
    await this.pace(2000);
    await this.say(U, "Took the level loader. Holding src/levels/** for now. Levels will be JSON so they stay easy to edit.");

    await this.pace(2500);
    await this.act(X, "claim_next_task");
    await this.pace(2000);
    await this.say(X, "Nothing unblocked for me yet, the boss waits on physics. Starting the boss hitbox, it needs gravity from physics.ts.");

    // The collision: Codex reaches for the file Claude holds.
    await this.pace(2000);
    await this.act(X, "claim_files", { paths: ["src/physics.ts"], reason: "gravity hook for the boss" });
    await this.pace(2500);
    await this.act(X, "request_handoff", { path: "src/physics.ts", message: "Need a gravityScale hook for the boss slam" });
    await this.pace(1500);
    await this.act(X, "claim_files", { paths: ["src/boss.ts"], reason: "boss hitbox and phases" });
    await this.pace(2000);
    const ask = await this.say(X, "@Claude Code can you hand physics.ts over when the jump arc lands? Working in boss.ts meanwhile.", {
      mentions: [C],
    });
    const askSeq = (ask.json as { seq?: number } | undefined)?.seq;

    await this.pace(3000);
    await this.say(C, "@Codex yes, releasing it as soon as the arc tests pass. It's all yours after that.", {
      mentions: [X],
      ...(askSeq ? { replyToSeq: askSeq } : {}),
    });

    // Claude does the real edit while holding the claim.
    await this.pace(3500);
    this.edit("src/physics.ts", PHYSICS_V1);
    await this.pace(2500);
    await this.say(
      C,
      "New jump tuning, apex is exactly 3 tiles now:\n```ts\nexport const GRAVITY = 0.6;\nexport const JUMP_VELOCITY = -11;\nexport const COYOTE_FRAMES = 6;\n```\nRunning the physics tests."
    );
    await this.pace(3000);
    await this.act(C, "record_note", {
      kind: "verification",
      title: "Jump arc verified",
      detail: "Tested: physics step at 60fps over 200 frames.\nExpected: apex at 3 tiles, lands in 34 frames.\nActual: apex 3.0 tiles, lands in 34 frames. 12/12 physics tests pass.",
    });
    await this.pace(2000);
    await this.act(C, "release_files", { paths: ["src/physics.ts"] });
    await this.pace(1500);
    if (t1) await this.act(C, "update_task", { taskId: t1, status: "done" });

    // The hand-off resolved: Codex picks the file up.
    await this.pace(2500);
    await this.act(X, "claim_files", { paths: ["src/physics.ts"], reason: "gravityScale for the boss slam" });
    await this.pace(1500);
    await this.act(X, "claim_next_task");

    await this.pace(2000);
    this.edit("src/levels/loader.ts", LOADER_V1);
    await this.pace(2500);
    await this.act(U, "record_note", {
      kind: "decision",
      title: "Levels are JSON files",
      detail: "src/levels/*.json, parsed by loader.ts. One character per tile so level changes read well in a diff.",
    });
    await this.pace(2000);
    await this.act(U, "release_files", {});
    await this.pace(1500);
    if (t2) await this.act(U, "update_task", { taskId: t2, status: "done" });

    await this.pace(3000);
    this.edit("src/physics.ts", PHYSICS_V2);
    this.edit("src/boss.ts", BOSS_V1);
    await this.pace(2500);
    await this.say(X, "Mossback is in: patrol, slam, stunned. The slam uses gravityScale 2.5 and the hitbox shrinks while he's stunned.");
    await this.pace(2000);
    await this.act(X, "release_files", {});
    await this.pace(1500);
    if (t3) await this.act(X, "update_task", { taskId: t3, status: "done" });

    await this.pace(2000);
    await this.act(X, "claim_next_task");
    await this.pace(2500);
    await this.say(X, "World 1 is done. Deploys need a human OK in this room, so I'm asking before I ship the preview.");
    await this.pace(1500);
    const approval = this.approvalFlow(t4).catch((err) => {
      if (!(err instanceof DemoStopped) && !this.stopped) logger.warn({ err }, "demo: approval flow failed");
    });
    this.loops.push(approval);

    await this.pace(3000);
    await this.say(C, "I'm idle and listening. @mention me if you want tests run.");
    await this.pace(2000);
    await this.say(U, "Same here. All three diffs are waiting in the Changes tab for your review.");
    this.phase = "listening";
  }

  /** Stop everything: sleeps, loops, MCP clients, temp files. Safe to call twice. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.phase = "stopped";
    for (const s of [...this.sleepers]) {
      clearTimeout(s.timer);
      s.resolve();
    }
    // Leave like a real agent would. That also wakes any parked wait_for_update.
    const roomAlive = !!(this.roomId && this.engine.getRoom(this.roomId));
    if (roomAlive) {
      const leaves = [...this.agents.values()].map((a) => a.raw("leave_session", {}).catch(() => undefined));
      await Promise.race([Promise.allSettled(leaves), new Promise((r) => setTimeout(r, 1500).unref?.())]);
    }
    await Promise.allSettled([...this.agents.values()].map((a) => a.close()));
    await Promise.race([
      Promise.allSettled([this.script, ...this.loops]),
      new Promise((r) => setTimeout(r, 2000).unref?.()),
    ]);
    if (this.tempDir) {
      try {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      this.tempDir = null;
    }
  }
}

/* ------------------------------ module API ------------------------------ */

const runners = new WeakMap<Engine, DemoRunner>();
const starting = new WeakMap<Engine, Promise<{ roomId: string; started: boolean }>>();

/**
 * Start the demo, or reuse the one already running on this engine. A demo left
 * over from an earlier hub run (same name, our own project folder or none) is
 * deleted and recreated, so a second start is always clean.
 */
export function startDemo(engine: Engine, opts: DemoOptions): Promise<{ roomId: string; started: boolean }> {
  const current = runners.get(engine);
  if (current?.running && current.roomId) return Promise.resolve({ roomId: current.roomId, started: false });
  const pending = starting.get(engine);
  if (pending) return pending;

  const p = (async () => {
    if (current) await current.stop();
    for (const room of engine.listRooms()) {
      if (room.name !== DEMO_ROOM_NAME) continue;
      const ours = !room.projectPath || isOurs(room.projectPath) || !fs.existsSync(room.projectPath);
      if (ours) {
        try {
          engine.deleteRoom(room.id, "Bothread demo");
        } catch {
          /* already gone */
        }
      }
    }
    const runner = new DemoRunner(engine, opts);
    runners.set(engine, runner);
    const roomId = await runner.start();
    return { roomId, started: true };
  })().finally(() => starting.delete(engine));
  starting.set(engine, p);
  return p;
}

export function demoStatus(engine: Engine): DemoStatus {
  const r = runners.get(engine);
  if (!r) return { running: false, roomId: null, phase: null, step: 0, totalSteps: SCRIPT_STEPS, git: false, projectPath: null };
  return r.status();
}

export async function stopDemo(engine: Engine): Promise<void> {
  const r = runners.get(engine);
  runners.delete(engine);
  await r?.stop();
}

/** The hub's own MCP URL as seen from a request that reached it (used by POST /api/demo). */
function selfMcpUrl(req: Request): string {
  const addr = (req.socket.localAddress ?? "127.0.0.1").replace(/^::ffff:/i, "");
  const host = addr === "::" || addr === "0.0.0.0" ? "127.0.0.1" : addr.includes(":") ? `[${addr}]` : addr;
  return `http://${host}:${req.socket.localPort}/mcp`;
}

/** GET /api/demo (status) and POST /api/demo (start or reuse; returns { roomId }). */
export function mountDemoRoutes(api: Router, deps: { engine: Engine; config: HubConfig; token: string }): void {
  const { engine, config, token } = deps;
  api.get("/demo", (_req, res) => {
    res.json(demoStatus(engine));
  });
  api.post("/demo", (req, res) => {
    startDemo(engine, { mcpUrl: selfMcpUrl(req), token: config.authRequired ? token : null, dbPath: config.dbPath }).then(
      (r) => res.json(r),
      (err) => {
        logger.error({ err }, "demo: start failed");
        res.status(500).json({ error: `Couldn't start the demo: ${(err as Error).message}` });
      }
    );
  });
}
