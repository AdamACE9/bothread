import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { openDatabase } from "../src/db/database";
import { Engine } from "../src/engine/engine";
import { buildApp } from "../src/http";
import { McpHub } from "../src/mcp/transport";
import { RoomBus } from "../src/realtime";

/**
 * The commit guard: Engine.guardCheck → POST /api/guard/check → the
 * `bothread guard` pre-commit hook blocking a real `git commit`.
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

function makeEngine() {
  return new Engine(openDatabase(":memory:"), new RoomBus());
}

/** A room at `projectPath` with two agents joined: Claude Code (a) and Cursor (b). */
function roomWithAgents(engine: Engine, projectPath: string, name = "feat") {
  const { room, sessionId } = engine.createRoom({ name, projectPath });
  engine.joinSession(`mcp-a-${room.id}`, { sessionId, agentName: "Claude Code", brand: "claude" });
  engine.joinSession(`mcp-b-${room.id}`, { sessionId, agentName: "Cursor", brand: "cursor" });
  return { room, a: engine.resolveCaller(`mcp-a-${room.id}`), b: engine.resolveCaller(`mcp-b-${room.id}`) };
}

describe("Engine.guardCheck", () => {
  afterEach(() => vi.restoreAllMocks());

  it("blocks another agent's exclusive files (literal + glob), allows the holder, ignores shared", () => {
    const engine = makeEngine();
    const dir = tmpDir("bothread-guard-");
    const { a, b } = roomWithAgents(engine, dir);
    expect(engine.claimFiles(a, { paths: ["src/a.ts", "lib/**"] }).granted).toBe(true);
    expect(engine.claimFiles(b, { paths: ["docs/readme.md"], exclusive: false }).granted).toBe(true);

    const files = ["src/a.ts", "lib/deep/x.ts", "docs/readme.md", "other.ts", ".bothread/attachments/shot.png"];

    const asCursor = engine.guardCheck({ projectPath: dir, files, agent: "Cursor" });
    expect(asCursor.checked).toBe(4); // .bothread/ is never guarded
    expect(asCursor.rooms).toEqual(["feat"]);
    expect(asCursor.blocked).toEqual([
      { file: "src/a.ts", heldByName: "Claude Code", roomName: "feat", pattern: "src/a.ts", exclusive: true },
      { file: "lib/deep/x.ts", heldByName: "Claude Code", roomName: "feat", pattern: "lib/**", exclusive: true },
    ]);

    // No agent (a human / unidentified committer): every exclusive hold blocks.
    expect(engine.guardCheck({ projectPath: dir, files }).blocked.map((x) => x.file)).toEqual(["src/a.ts", "lib/deep/x.ts"]);

    // The holder itself commits freely — name match is case-insensitive.
    expect(engine.guardCheck({ projectPath: dir, files, agent: "claude code" }).blocked).toEqual([]);
    expect(engine.guardCheck({ projectPath: dir, files, agent: "Claude Code" }).blocked).toEqual([]);
  });

  it("audits guard.blocked and posts an advisory system message", () => {
    const engine = makeEngine();
    const dir = tmpDir("bothread-guard-");
    const { room, a } = roomWithAgents(engine, dir);
    engine.claimFiles(a, { paths: ["src/a.ts"] });

    engine.guardCheck({ projectPath: dir, files: ["src/a.ts"], agent: "Cursor" });
    engine.guardCheck({ projectPath: dir, files: ["src/a.ts"] });
    engine.guardCheck({ projectPath: dir, files: ["README.md"] }); // clear → no noise

    const audits = engine.listAudit(room.id).filter((e) => e.type === "guard.blocked");
    expect(audits.map((e) => e.actorName).sort()).toEqual(["Cursor", "commit"]);
    const msgs = engine.messagesBefore(room.id, 1e9, 100).messages.filter((m) => m.text.startsWith("Commit blocked"));
    expect(msgs.map((m) => m.text)).toEqual([
      "Commit blocked: Cursor tried to commit src/a.ts while Claude Code holds it.",
      "Commit blocked: someone tried to commit src/a.ts while Claude Code holds it.",
    ]);
    expect(msgs.every((m) => m.importance === "advisory" && m.kind === "system")).toBe(true);
  });

  it("ignores released and expired leases", () => {
    const engine = makeEngine();
    const dir = tmpDir("bothread-guard-");
    const { a } = roomWithAgents(engine, dir);
    engine.claimFiles(a, { paths: ["src/a.ts"] });
    engine.claimFiles(a, { paths: ["src/b.ts"], ttlSeconds: 60 });
    expect(engine.guardCheck({ projectPath: dir, files: ["src/a.ts", "src/b.ts"] }).blocked).toHaveLength(2);

    engine.releaseFiles(a, { paths: ["src/a.ts"] });
    expect(engine.guardCheck({ projectPath: dir, files: ["src/a.ts", "src/b.ts"] }).blocked.map((x) => x.file)).toEqual(["src/b.ts"]);

    const later = Date.now() + 120_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    expect(engine.guardCheck({ projectPath: dir, files: ["src/a.ts", "src/b.ts"] }).blocked).toEqual([]);
  });

  it("matches rooms by real folder (trailing slash, symlink, subfolder) and ignores other projects + closed rooms", () => {
    const engine = makeEngine();
    const dir = tmpDir("bothread-guard-");
    const other = tmpDir("bothread-guard-other-");
    fs.mkdirSync(path.join(dir, "pkg"));
    const { a } = roomWithAgents(engine, dir, "main");
    engine.claimFiles(a, { paths: ["src/a.ts"] });
    const o = roomWithAgents(engine, other, "elsewhere");
    engine.claimFiles(o.a, { paths: ["other.ts"] });
    const sub = roomWithAgents(engine, path.join(dir, "pkg"), "sub");
    engine.claimFiles(sub.a, { paths: ["src/**"] });

    const files = ["src/a.ts", "other.ts", "pkg/src/b.ts"];
    const r = engine.guardCheck({ projectPath: dir + path.sep, files, agent: "Cursor" });
    expect(r.rooms.sort()).toEqual(["main", "sub"]);
    expect(r.blocked.map((x) => [x.file, x.roomName])).toEqual([
      ["src/a.ts", "main"],
      ["pkg/src/b.ts", "sub"],
    ]);

    const link = path.join(tmpDir("bothread-guard-link-"), "repo-link");
    try {
      fs.symlinkSync(dir, link, "junction");
      expect(engine.guardCheck({ projectPath: link, files, agent: "Cursor" }).blocked).toHaveLength(2);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EPERM") throw err; // no symlink rights (Windows)
    }

    engine.setRoomStatus(sub.room.id, "closed");
    expect(engine.guardCheck({ projectPath: dir, files, agent: "Cursor" }).blocked.map((x) => x.file)).toEqual(["src/a.ts"]);
    expect(engine.guardCheck({ projectPath: other, files: ["src/a.ts"] }).blocked).toEqual([]);
  });
});

/* ---------------------------- HTTP + end-to-end ---------------------------- */

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

/** Plain node:http POST (no Origin header — exactly what the hook sends). */
function post(port: number, urlPath: string, body: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method: "POST", agent: false, headers: { "content-type": "application/json", "content-length": data.length, ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: any = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* not json */
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      }
    );
    req.on("error", reject);
    req.end(data);
  });
}

describe("POST /api/guard/check", () => {
  let hub: Hub;
  beforeAll(async () => {
    hub = await startHub();
  });
  afterAll(async () => {
    await hub.close();
  });

  it("returns the guard result for a plain local request", async () => {
    const dir = tmpDir("bothread-guard-http-");
    const { a } = roomWithAgents(hub.engine, dir, "http-room");
    hub.engine.claimFiles(a, { paths: ["src/**"] });
    const r = await post(hub.port, "/api/guard/check", { projectPath: dir, files: ["src/x.ts", "README.md"], agent: "Cursor" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      checked: 2,
      rooms: ["http-room"],
      blocked: [{ file: "src/x.ts", heldByName: "Claude Code", roomName: "http-room", pattern: "src/**", exclusive: true }],
    });
    const mine = await post(hub.port, "/api/guard/check", { projectPath: dir, files: ["src/x.ts"], agent: "Claude Code" });
    expect(mine.json.blocked).toEqual([]);
  });

  it("validates input", async () => {
    const bad = async (body: unknown) => (await post(hub.port, "/api/guard/check", body)).status;
    expect(await bad({ files: [] })).toBe(400);
    expect(await bad({ projectPath: "/x", files: "a.ts" })).toBe(400);
    expect(await bad({ projectPath: "/x", files: [1] })).toBe(400);
    expect(await bad({ projectPath: "/x", files: [], agent: 5 })).toBe(400);
    expect(await bad({ projectPath: "/x", files: Array.from({ length: 5001 }, (_, i) => `f${i}`) })).toBe(400);
    expect(await bad({ projectPath: "/x", files: [] })).toBe(200);
  });

  it("goes through the /api origin guard", async () => {
    const r = await post(hub.port, "/api/guard/check", { projectPath: "/x", files: [] }, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });
});

describe("bothread guard (real git repo, real pre-commit hook)", { timeout: 60_000 }, () => {
  let hub: Hub;
  let repo: string;
  let env: NodeJS.ProcessEnv;
  let agent: Client;

  // Async on purpose: the hub runs in THIS process, so a spawnSync'd `git commit`
  // would block the very event loop its pre-commit hook needs an answer from.
  const run = (cmd: string, args: string[], extra: Record<string, string>) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(cmd, args, { cwd: repo, env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });
  const git = (args: string[], extra: Record<string, string> = {}) => run("git", args, extra);
  const cli = (args: string[], extra: Record<string, string> = {}) => run(process.execPath, [bin, ...args], extra);
  const edit = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
  };

  beforeAll(async () => {
    hub = await startHub();
    repo = tmpDir("bothread-guard-repo-");
    // Hermetic git + CLI: no global/system git config (a global core.hooksPath would
    // redirect the hook), no inherited BOTHREAD_*, `node` on PATH for the hook shebang.
    const gitGlobal = path.join(tmpDir("bothread-guard-cfg-"), "gitconfig");
    fs.writeFileSync(gitGlobal, "");
    env = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("BOTHREAD_") && !k.startsWith("GIT_")) env[k] = v;
    Object.assign(env, {
      NO_COLOR: "1",
      BOTHREAD_NO_TELEMETRY: "1",
      BOTHREAD_PORT: String(hub.port),
      GIT_CONFIG_GLOBAL: gitGlobal,
      GIT_CONFIG_NOSYSTEM: "1",
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
    });
    execFileSync("git", ["init", "-q"], { cwd: repo, env });
    for (const [k, v] of [
      ["user.email", "test@bothread.local"],
      ["user.name", "Bothread Test"],
      ["commit.gpgsign", "false"],
      ["core.autocrlf", "false"],
    ]) execFileSync("git", ["config", k!, v!], { cwd: repo, env });
    edit("src/a.ts", "export const a = 1;\n");
    edit("README.md", "# repo\n");
    execFileSync("git", ["add", "-A"], { cwd: repo, env });
    execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: repo, env });

    const { sessionId } = hub.engine.createRoom({ name: "guarded", projectPath: repo });
    agent = new Client({ name: "claude", version: "1.0.0" });
    await agent.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${hub.port}/mcp`)));
    await agent.callTool({ name: "join_session", arguments: { sessionId, agentName: "Claude Code", brand: "claude" } });
    const claim = await agent.callTool({ name: "claim_files", arguments: { paths: ["src/a.ts"], exclusive: true } });
    expect(claim.isError).toBeFalsy();
  });

  afterAll(async () => {
    await agent?.close().catch(() => {});
    if (hub?.server.listening) await hub.close();
  });

  it("install writes a marked, executable hook; status/check report it", async () => {
    const r = await cli(["guard", "install", "--path", repo]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const hookPath = path.join(repo, ".git", "hooks", "pre-commit");
    const src = fs.readFileSync(hookPath, "utf8");
    expect(src.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(src).toContain("bothread-guard");
    if (process.platform !== "win32") expect(fs.statSync(hookPath).mode & 0o111).not.toBe(0);

    const st = JSON.parse((await cli(["guard", "status", "--json"])).stdout);
    expect(st).toMatchObject({ installed: true, foreignHook: false, hub: { running: true, port: hub.port } });
    expect(fs.realpathSync(st.hookPath)).toBe(fs.realpathSync(hookPath));

    const check = await cli(["guard", "check", "--json", "src/a.ts"]);
    expect(check.status).toBe(1);
    expect(JSON.parse(check.stdout).blocked[0]).toMatchObject({ file: "src/a.ts", heldByName: "Claude Code" });
    expect((await cli(["guard", "check", "--agent", "Claude Code", "src/a.ts"])).status).toBe(0);

    const doctor = JSON.parse((await cli(["doctor", "--json"])).stdout);
    expect(doctor.checks.find((k: { name: string }) => k.name === "guard")).toMatchObject({ status: "info" });
    expect(doctor.checks.find((k: { name: string }) => k.name === "guard").message).toContain("installed in");
  });

  it("blocks a commit of a file another agent holds, naming the holder", async () => {
    edit("src/a.ts", "export const a = 2;\n");
    await git(["add", "src/a.ts"]);
    const r = await git(["commit", "-m", "x"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Commit blocked by Bothread");
    expect(r.stderr).toContain("src/a.ts");
    expect(r.stderr).toContain("Claude Code");
    expect(r.stderr).toContain("BOTHREAD_GUARD=off");
    expect(r.stderr).toContain("request_handoff");
    expect(hub.engine.listRooms().some((room) => hub.engine.listAudit(room.id).some((e) => e.type === "guard.blocked"))).toBe(true);

    // Another agent identifying itself is still blocked.
    expect((await git(["commit", "-m", "x"], { BOTHREAD_AGENT: "Cursor" })).status).not.toBe(0);
    // A commit that doesn't touch held files is fine.
    await git(["reset", "-q", "src/a.ts"]);
    edit("README.md", "# repo v2\n");
    await git(["add", "README.md"]);
    expect((await git(["commit", "-q", "-m", "readme"])).status).toBe(0);
  });

  it("lets the holder commit (BOTHREAD_AGENT), and honors BOTHREAD_GUARD=off", async () => {
    await git(["add", "src/a.ts"]);
    const r = await git(["commit", "-q", "-m", "by holder"], { BOTHREAD_AGENT: "Claude Code" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);

    edit("src/a.ts", "export const a = 3;\n");
    await git(["add", "src/a.ts"]);
    expect((await git(["commit", "-q", "-m", "bypass"], { BOTHREAD_GUARD: "off" })).status).toBe(0);
  });

  // The foreign hook is a /bin/sh script; Git for Windows runs hooks differently.
  it.skipIf(process.platform === "win32")("chains a foreign hook only with --force, and uninstall restores it", async () => {
    const hooks = path.join(repo, ".git", "hooks");
    expect((await cli(["guard", "uninstall"])).status).toBe(0);
    expect(fs.existsSync(path.join(hooks, "pre-commit"))).toBe(false);

    const marker = path.join(repo, ".git", "prev-ran");
    const foreign = `#!/bin/sh\necho ran > "${marker.replace(/\\/g, "/")}"\nexit 0\n`;
    fs.writeFileSync(path.join(hooks, "pre-commit"), foreign, { mode: 0o755 });
    const refused = await cli(["guard", "install"]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("--force");
    expect(fs.readFileSync(path.join(hooks, "pre-commit"), "utf8")).toBe(foreign);

    expect((await cli(["guard", "install", "--force"])).status).toBe(0);
    expect(fs.readFileSync(path.join(hooks, "pre-commit.bothread-prev"), "utf8")).toBe(foreign);

    edit("src/a.ts", "export const a = 4;\n");
    await git(["add", "src/a.ts"]);
    expect((await git(["commit", "-m", "blocked"])).status).not.toBe(0);
    expect(fs.existsSync(marker)).toBe(true); // chained hook ran first

    expect((await cli(["guard", "uninstall"])).status).toBe(0);
    expect(fs.readFileSync(path.join(hooks, "pre-commit"), "utf8")).toBe(foreign);
    expect(fs.existsSync(path.join(hooks, "pre-commit.bothread-prev"))).toBe(false);
    await git(["reset", "-q", "src/a.ts"]);
    fs.unlinkSync(path.join(hooks, "pre-commit"));
  });

  it("respects core.hooksPath", async () => {
    await git(["config", "core.hooksPath", ".githooks"]);
    expect((await cli(["guard", "install"])).status).toBe(0);
    expect(fs.readFileSync(path.join(repo, ".githooks", "pre-commit"), "utf8")).toContain("bothread-guard");
    edit("src/a.ts", "export const a = 5;\n");
    await git(["add", "src/a.ts"]);
    expect((await git(["commit", "-m", "blocked"])).status).not.toBe(0);
  });

  it("fails open when the hub is down", async () => {
    await agent.close().catch(() => {});
    await hub.close();
    const r = await git(["commit", "-q", "-m", "hub down"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("commit not checked");
    expect((await cli(["guard", "check", "src/a.ts"])).status).toBe(2);
  });
});
