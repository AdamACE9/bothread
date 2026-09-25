import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The `bothread` CLI (bin/bothread.mjs), driven exactly as a user or an agent
 * would: as a subprocess, reading stdout/stderr and exit codes.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const bin = path.join(repoRoot, "bin", "bothread.mjs");
const pkgVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version as string;

const agentHome = fs.mkdtempSync(path.join(os.tmpdir(), "bothread-cli-home-"));

// No inherited BOTHREAD_* (a developer's own port/auth/db must not leak in), no
// color, no telemetry, never open a browser.
function cliEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("BOTHREAD_") && k !== "FORCE_COLOR") env[k] = v;
  // Agent detection (start screen, doctor) looks at an empty fake home, never the real one.
  return { ...env, NO_COLOR: "1", BOTHREAD_NO_TELEMETRY: "1", BOTHREAD_NO_OPEN: "1", BOTHREAD_AGENT_HOME: agentHome, ...extra };
}

function cli(args: string[], extraEnv: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd: repoRoot,
    env: cliEnv(extraEnv),
    encoding: "utf8",
    timeout: 20_000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

describe("bothread CLI", () => {
  it("--version prints the package.json version", () => {
    const r = cli(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(`bothread ${pkgVersion}`);
    expect(JSON.parse(cli(["version", "--json"]).stdout)).toEqual({ version: pkgVersion });
  });

  it("help lists every command, and per-command help works", () => {
    const r = cli(["help"]);
    expect(r.code).toBe(0);
    for (const cmd of ["start", "setup", "status", "rooms", "new", "connect", "doctor"]) expect(r.stdout).toContain(cmd);
    expect(r.stdout).toContain("--json");
    expect(r.stdout).toContain("BOTHREAD_AUTH=on");
    expect(r.stdout).not.toMatch(/\x1b\[/); // NO_COLOR → plain

    const sub = cli(["new", "--help"]);
    expect(sub.code).toBe(0);
    expect(sub.stdout).toContain("bothread new <name>");
    expect(sub.stdout).toContain("--project");
  });

  it("connect claude --json prints the exact claude mcp add line", async () => {
    const port = await freePort();
    const r = cli(["connect", "claude", "--json", "--port", String(port)]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.agent).toBe("claude");
    expect(out.mcpUrl).toBe(`http://127.0.0.1:${port}/mcp`);
    expect(out.config).toBe(`claude mcp add --transport http --scope user bothread http://127.0.0.1:${port}/mcp`);
    expect(out.skillInstall).toBe("npx skills add AdamACE9/bothread -y");
    expect(typeof out.where).toBe("string");
  });

  it("connect with --auth and no hub uses a token placeholder", async () => {
    const port = await freePort();
    const r = cli(["connect", "codex", "--json", `--port=${port}`, "--auth"], { BOTHREAD_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "bothread-cli-")) });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.config).toContain(`url = "http://127.0.0.1:${port}/mcp"`);
    expect(out.config).toContain('http_headers = { Authorization = "Bearer <BOTHREAD_TOKEN>" }');
  });

  it("an unknown command suggests the closest one and exits 1", () => {
    const r = cli(["stat"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Unknown command 'stat'. Did you mean 'status'?");
    expect(r.stdout).toBe("");
  });

  it("status --json exits 2 when no hub is running", async () => {
    const port = await freePort();
    const r = cli(["status", "--json", "--port", String(port)]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`No Bothread hub is running on port ${port}`);
    expect(JSON.parse(r.stdout)).toMatchObject({ running: false, port });
    expect(cli(["rooms", "--port", String(port)]).code).toBe(2);
  });
});

describe("bothread CLI against a live hub", () => {
  let port = 0;
  let hub: ChildProcess | undefined;
  let hubLog = "";

  beforeAll(async () => {
    port = await freePort();
    // Own process group (POSIX), so afterAll can take down bin → tsx → hub in one go.
    hub = spawn(process.execPath, [bin, "start", "--port", String(port), "--no-open"], {
      cwd: repoRoot,
      env: cliEnv({ BOTHREAD_DB: ":memory:" }),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    hub.stdout?.on("data", (d) => (hubLog += d));
    hub.stderr?.on("data", (d) => (hubLog += d));

    // A dev clone runs through tsx and may build the UI first — be patient.
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (hub.exitCode !== null) throw new Error(`hub exited early (${hub.exitCode}):\n${hubLog}`);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`hub never came up on ${port}:\n${hubLog}`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }, 120_000);

  afterAll(async () => {
    if (!hub || hub.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => hub!.once("exit", () => resolve()));
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && hub!.pid) process.kill(-hub!.pid, signal);
        else hub!.kill(signal);
      } catch {
        /* already gone */
      }
    };
    kill("SIGTERM");
    const timedOut = await Promise.race([exited.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), 5000))]);
    if (timedOut) {
      kill("SIGKILL");
      await exited;
    }
  }, 20_000);

  it("new → status → rooms, all as JSON", () => {
    const created = cli(["new", "cli-room", "--json", "--port", String(port), "--project", "."]);
    expect(created.code, created.stderr).toBe(0);
    const room = JSON.parse(created.stdout);
    expect(room).toMatchObject({ name: "cli-room", mcpUrl: `http://127.0.0.1:${port}/mcp` });
    expect(room.roomId).toMatch(/\S/);
    expect(room.sessionId).toMatch(/\S/);
    expect(room.url).toBe(`http://127.0.0.1:${port}/#/room/${encodeURIComponent(room.roomId)}`);
    expect(path.isAbsolute(room.projectPath)).toBe(true);

    const status = cli(["status", "--json", "--port", String(port)]);
    expect(status.code, status.stderr).toBe(0);
    const s = JSON.parse(status.stdout);
    expect(s).toMatchObject({ running: true, port, version: pkgVersion, mcpUrl: `http://127.0.0.1:${port}/mcp` });
    expect(s.rooms.map((r: { id: string }) => r.id)).toContain(room.roomId);

    const rooms = cli(["rooms", "--json", "--port", String(port)]);
    expect(rooms.code, rooms.stderr).toBe(0);
    const listed = JSON.parse(rooms.stdout).rooms.find((r: { id: string }) => r.id === room.roomId);
    expect(listed).toMatchObject({ name: "cli-room", status: "active", pendingApprovals: 0 });

    // Human output: the room shows up in an aligned, uncolored table.
    const human = cli(["status", "--port", String(port)]);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("cli-room");
    expect(human.stdout).not.toMatch(/\x1b\[/);
  });

  it("new without a name is a usage error", () => {
    const r = cli(["new", "--port", String(port)]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("room name is required");
  });

  it("a second start on the same port reports the running hub and exits 0", () => {
    const r = cli(["start", "--port", String(port), "--no-open"]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(`Bothread is already running at http://127.0.0.1:${port}`);
    expect(r.stdout).toContain(pkgVersion);
  });

  it("doctor recognizes the running hub on its port", () => {
    const r = cli(["doctor", "--json", "--port", String(port)]);
    const out = JSON.parse(r.stdout);
    const portCheck = out.checks.find((k: { name: string }) => k.name === "port");
    expect(portCheck.status).toBe("pass");
    expect(portCheck.message).toContain("already running");
  });
});
