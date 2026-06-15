import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir, loadConfig, type HubConfig } from "./config";
import { openDatabase } from "./db/database";
import { Engine } from "./engine/engine";
import { newSessionId } from "./engine/ids";
import { buildApp } from "./http";
import { logger } from "./logger";
import { McpHub } from "./mcp/transport";
import { RoomBus } from "./realtime";

function resolveUiDir(): string | undefined {
  if (process.env.BOTHREAD_UI_DIR) return process.env.BOTHREAD_UI_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const guess = path.resolve(here, "../../../apps/room-ui/dist");
  return fs.existsSync(path.join(guess, "index.html")) ? guess : undefined;
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

async function main(): Promise<void> {
  const config = loadConfig();
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

  const { app, attachWebSocket } = buildApp({ engine, bus, hub, config, token });
  const server = http.createServer(app);
  attachWebSocket(server);

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
    /* eslint-disable no-console */
    console.log("");
    console.log("  \x1b[1m\x1b[38;5;208m✦ Bothread is running\x1b[0m");
    console.log("  ─────────────────────────────────────────────");
    console.log(`  \x1b[1mOpen the room:\x1b[0m   ${base}`);
    console.log(`  Agents connect to: ${base}/mcp   (MCP · Streamable HTTP)`);
    if (config.authRequired) console.log(`  Agent auth header: Authorization: Bearer ${token}`);
    else console.log("  Agent auth:        open on 127.0.0.1 (add a token with BOTHREAD_AUTH=on)");
    console.log("");
    console.log("  Next: open the room → create a room → click \x1b[1m“Connect an agent”\x1b[0m for copy-paste setup.");
    if (!config.uiDir) console.log("  \x1b[33m(room UI not built — run: npm run build:ui)\x1b[0m");
    console.log("  Stop with Ctrl-C.");
    console.log("");
    logger.info({ port: config.port }, "Bothread hub listening");
    if (config.uiDir) openBrowser(`${base}/`);
  });

  const shutdown = async () => {
    logger.info("shutting down");
    engine.drainApprovals();
    await hub.closeAll();
    server.close();
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
