import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir, isLoopbackHost, loadConfig, type HubConfig } from "./config";
import { openDatabase } from "./db/database";
import { Engine } from "./engine/engine";
import { newSessionId } from "./engine/ids";
import { buildApp } from "./http";
import { logger } from "./logger";
import { McpHub } from "./mcp/transport";
import { RoomBus } from "./realtime";
import { sendTelemetry } from "./telemetry";
import { VERSION } from "./version";
import { startDemo, stopDemo } from "./demo";
import { detectAgents, type DetectedAgent } from "../../../bin/lib/agents.mjs";
import { box, colorEnabled, hyperlinksEnabled, link, palette } from "../../../bin/lib/term.mjs";

function resolveUiDir(): string | undefined {
  if (process.env.BOTHREAD_UI_DIR) return process.env.BOTHREAD_UI_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Two layouts:
  //  • dev (tsx):       packages/server/src/index.ts → ../../../apps/room-ui/dist
  //  • published bundle: <pkg>/dist-server/server.js  → ../apps/room-ui/dist
  const candidates = [
    path.resolve(here, "../../../apps/room-ui/dist"),
    path.resolve(here, "../apps/room-ui/dist"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return undefined;
}

/** A stable install token, persisted to the data dir so agent configs keep working across restarts. */
function resolveInstallToken(config: HubConfig): string {
  if (config.installToken) return config.installToken;
  if (!config.authRequired) return "dev-no-auth";
  const file = path.join(dataDir(), "install-token");
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
    fs.mkdirSync(dataDir(), { recursive: true });
    const token = newSessionId();
    fs.writeFileSync(file, token, "utf8");
    return token;
  } catch {
    return newSessionId();
  }
}

function openBrowser(url: string): void {
  if (process.env.BOTHREAD_NO_OPEN) return;
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    /* opening the browser is best-effort */
  }
}

/** How to run another bothread command the way this one was launched. */
function selfCommand(sub: string): string {
  const channel = process.env.BOTHREAD_CHANNEL;
  if (channel === "global") return `bothread ${sub}`;
  if (channel === "dev-clone") return `node bin/bothread.mjs ${sub}`;
  return `npx bothread ${sub}`;
}

interface StartScreen {
  readyMs: number;
  base: string;
  mcpUrl: string;
  authRequired: boolean;
  token: string;
  uiBuilt: boolean;
  agents: DetectedAgent[];
  /** The parent CLI handles o / s / c / q keys (interactive terminal). */
  keys: boolean;
}

/**
 * The startup screen: a compact title box, each URL alone on its own line (so a
 * double-click copies it cleanly, and it's an OSC 8 link where supported), the
 * agents found on this machine, and next steps tailored to what's set up.
 */
function renderStartScreen(s: StartScreen, stream: { isTTY?: boolean } = process.stdout): string {
  const tty = !!stream.isTTY;
  const c = palette(colorEnabled(stream));
  const links = hyperlinksEnabled(stream);
  const url = (u: string) => c.cyan(link(u, u, links));
  const out: string[] = tty ? [] : [""];
  const title = `${c.bold(c.accent("✦ Bothread"))} ${c.accent(`v${VERSION}`)}  ${c.dim("ready in")} ${c.bold(String(s.readyMs))} ${c.dim("ms")}`;
  if (tty) out.push(...box([title], { border: c.accent }).map((l) => `  ${l}`));
  else out.push(`  ${title}`);
  out.push("");
  const arrow = tty ? `${c.green("➜")}  ` : "";
  out.push(`  ${arrow}${c.bold("Room:")}  ${url(`${s.base}/`)}`);
  out.push(`  ${arrow}${c.bold("MCP:")}   ${url(s.mcpUrl)}`);
  if (s.authRequired) out.push(`  ${arrow}${c.bold("Auth:")}  Authorization: Bearer ${s.token}`);
  if (!s.uiBuilt) out.push(`  ${c.yellow("!")}  ${c.yellow("Room UI not built — run: npm run build:ui")}`);

  const found = s.agents.filter((a) => a.detected || a.configured);
  const connected = found.filter((a) => a.configured);
  const waiting = found.filter((a) => !a.configured);
  out.push("", `  ${c.bold("Agents")}`);
  if (!found.length) out.push(`    ${c.dim("No AI coding agents found on this machine yet.")}`);
  const width = Math.max(0, ...found.map((a) => a.label.length)) + 2;
  for (const a of connected) out.push(`    ${c.green("✓")} ${a.label.padEnd(width)}${c.dim("connected")}`);
  for (const a of waiting)
    out.push(`    ${c.yellow("!")} ${a.label.padEnd(width)}${c.dim(a.canAutoSetup ? "found, not connected" : "found, needs manual setup")}`);

  const setupCmd = c.bold(selfCommand("setup"));
  const orKey = s.keys ? c.dim(" (or press s)") : "";
  const join = `${c.dim("say:")} This is a Bothread session: <id>`;
  const steps: string[] = [];
  if (!found.length) {
    steps.push(`Install an AI coding agent (Claude Code, Cursor, Codex, …), then run ${setupCmd}`);
    steps.push(`Any other MCP client: ${c.bold(selfCommand("connect"))} prints the config`);
  } else if (!connected.length) {
    steps.push(`Run ${setupCmd} in a new terminal${orKey}`);
    steps.push(`Open the room${s.keys ? c.dim(" (press o)") : ""} and create a room`);
    steps.push(`In each agent, ${join}`);
  } else {
    steps.push(`Open the room${s.keys ? c.dim(" (press o)") : ""} and create a room`);
    steps.push(`In each agent, ${join}  ${c.dim("(or use the room's Connect panel)")}`);
    if (waiting.some((a) => a.canAutoSetup)) steps.push(`Connect the rest: ${setupCmd}${orKey}`);
  }
  if (process.env.BOTHREAD_DEMO !== "1") steps.push(`Just looking? Run ${c.bold(selfCommand("demo"))}`);
  out.push("", `  ${c.bold("Next")}`, ...steps.map((t, i) => `    ${c.accent(`${i + 1}.`)} ${t}`), "");
  if (s.keys) {
    const k = (key: string, what: string) => `${c.cyan(key)} ${c.dim(what)}`;
    const sep = c.dim(" · ");
    out.push(`  ${c.dim("press")} ${[k("o", "to open the room"), k("s", "to set up agents"), k("c", "to copy the MCP URL"), k("q", "to quit")].join(sep)}`, "");
  }
  else out.push(`  ${c.dim("Stop with Ctrl-C.")}`, "");
  return out.join("\n");
}

async function main(): Promise<void> {
  const config = loadConfig();

  // Binding past loopback puts the hub — every room, every message, and the
  // control plane that drives your agents — on the local network. Auth is off by
  // default because 127.0.0.1 is already a boundary; off *and* on the network is
  // open access for anyone who can reach the port. Refuse rather than surprise.
  if (!isLoopbackHost(config.host) && !config.authRequired) {
    if (process.env.BOTHREAD_ALLOW_INSECURE_HOST === "1") {
      console.warn(
        `\n  \x1b[33m⚠ Bothread is listening on ${config.host} with agent auth OFF.\x1b[0m\n` +
          `  Anyone who can reach this machine can read your rooms and drive your agents.\n` +
          `  You set BOTHREAD_ALLOW_INSECURE_HOST=1, so continuing.\n`
      );
    } else {
      console.error(
        `\n  Refusing to start: BOTHREAD_HOST=${config.host} exposes Bothread to your\n` +
          `  network, and agent auth is off — anyone who can reach this machine could\n` +
          `  read your rooms and drive your agents.\n\n` +
          `  Pick one:\n` +
          `    • Keep it on this machine (recommended):  unset BOTHREAD_HOST\n` +
          `    • Require a token:                        BOTHREAD_AUTH=on bothread start\n` +
          `    • Already isolated (Docker, VM, tunnel):  BOTHREAD_ALLOW_INSECURE_HOST=1\n`
      );
      process.exit(1);
    }
  }

  config.uiDir = resolveUiDir();
  const token = resolveInstallToken(config);

  let db;
  try {
    db = openDatabase(config.dbPath);
  } catch (err) {
    console.error(
      `\n  Couldn't start Bothread's database engine.\n` +
        `  This usually means dependencies need (re)installing — run:  npm install\n` +
        `  Details: ${(err as Error).message}\n`
    );
    process.exit(1);
  }
  const bus = new RoomBus();
  const engine = new Engine(db, bus);
  const hub = new McpHub(engine);

  // Best-effort server→client push: notify other connected agents when a message lands.
  bus.onAny((ev) => {
    if (ev.type !== "message") return;
    const m = (ev.data as { message?: { authorId: string; authorName: string; text: string } }).message;
    if (!m) return;
    hub.notifyRoomMessage(ev.roomId, m.authorId, `${m.authorName}: ${m.text.slice(0, 240)}`);
  });

  const { app, attachWebSocket } = buildApp({ engine, bus, hub, config, token });
  const server = http.createServer(app);
  const wss = attachWebSocket(server);

  // `ws` mirrors this server's `error` onto the WebSocketServer. That mirror is
  // registered first, and an unhandled `error` emit throws — so without a
  // listener here the process dies before the message below ever prints.
  wss.on("error", () => {
    /* reported on the http server just below */
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `\n  Port ${config.port} is already in use — Bothread may already be running.\n` +
          `  Open http://${config.host}:${config.port} in your browser, or start on a different port:\n` +
          `      BOTHREAD_PORT=4890 bothread start\n`
      );
    } else {
      console.error(`\n  Couldn't start the hub: ${err.message}\n`);
    }
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    const base = `http://${config.host}:${config.port}`;
    const agentHost = ["0.0.0.0", "::"].includes(config.host) ? "127.0.0.1" : config.host;
    let agents: DetectedAgent[] = [];
    try {
      agents = detectAgents({ mcpUrl: `http://${agentHost}:${config.port}/mcp`, token: config.authRequired ? token : null });
    } catch {
      /* detection is best-effort; the screen just shows no agents */
    }
    console.log(
      renderStartScreen({
        readyMs: Math.round(performance.now()),
        base,
        mcpUrl: `${base}/mcp`,
        authRequired: config.authRequired,
        token,
        uiBuilt: !!config.uiDir,
        agents,
        keys: process.env.BOTHREAD_KEYS === "1",
      })
    );
    logger.debug({ port: config.port }, "Bothread hub listening");
    sendTelemetry("bothread_start", {
      channel: process.env.BOTHREAD_CHANNEL,
      version: process.env.BOTHREAD_VERSION,
    });
    if (process.env.BOTHREAD_DEMO === "1") {
      // `bothread demo`: start the simulated agents and open straight into their room.
      startDemo(engine, { mcpUrl: `http://${agentHost}:${config.port}/mcp`, token: config.authRequired ? token : null, dbPath: config.dbPath }).then(
        ({ roomId }) => {
          console.log(`  Demo room: ${base}/#/room/${roomId}\n`);
          if (config.uiDir) openBrowser(`${base}/#/room/${roomId}`);
        },
        (err) => console.error(`  Couldn't start the demo: ${(err as Error).message}\n`)
      );
    } else if (config.uiDir) openBrowser(`${base}/`);
  });

  // Also answer on the IPv6 loopback so agents that resolve "localhost" to ::1
  // (the default on Windows) connect too — not just literal 127.0.0.1. Best-effort.
  let server6: http.Server | undefined;
  if (config.host === "127.0.0.1") {
    server6 = http.createServer(app);
    const wss6 = attachWebSocket(server6);
    // Both halves must be guarded: on a host without IPv6, `listen` fails with
    // EAFNOSUPPORT and `ws` re-emits that on the WebSocketServer, which is fatal
    // if unhandled. Either one left bare takes the whole hub down.
    const ignoreIpv6Failure = () => {
      /* IPv6 loopback unavailable or busy — 127.0.0.1 still serves; ignore. */
    };
    server6.on("error", ignoreIpv6Failure);
    wss6.on("error", ignoreIpv6Failure);
    server6.listen(config.port, "::1");
  }

  const shutdown = async () => {
    logger.debug("shutting down");
    await stopDemo(engine);
    engine.drainApprovals();
    await hub.closeAll();
    server.close();
    server6?.close();
    try {
      db.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error({ err }, "fatal");
  process.exit(1);
});
