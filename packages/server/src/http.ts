import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import { ApprovalStatus, type ServerEvent } from "@bothread/shared";
import type { HubConfig } from "./config";
import type { Engine } from "./engine/engine";
import { BothreadError } from "./engine/errors";
import { logger } from "./logger";
import type { McpHub } from "./mcp/transport";
import type { RoomBus } from "./realtime";

export interface HttpDeps {
  engine: Engine;
  bus: RoomBus;
  hub: McpHub;
  config: HubConfig;
  /** Effective install token agents must present as a Bearer credential. */
  token: string;
}

const isLocalhostOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;
  try {
    const h = new URL(origin).hostname.replace(/^\[|\]$/g, "");
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    return false;
  }
};

export function buildApp(deps: HttpDeps): { app: express.Express; attachWebSocket: (server: Server) => void } {
  const { engine, bus, hub, config, token } = deps;
  const app = express();

  app.use(
    cors({
      origin: true,
      exposedHeaders: ["Mcp-Session-Id"],
      allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id", "Mcp-Protocol-Version", "Last-Event-ID"],
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
    })
  );
  app.use(express.json({ limit: "4mb" }));

  /* ----------------------------- MCP endpoint ----------------------------- */

  const originGuard = (req: Request, res: Response, next: NextFunction) => {
    if (isLocalhostOrigin(req.headers.origin)) return next();
    res.status(403).json({ error: "Forbidden origin (DNS-rebinding protection)." });
  };
  const mcpAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!config.authRequired) return next();
    const provided = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (provided && provided === token) return next();
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: missing or invalid bearer token." },
      id: null,
    });
  };

  app.post("/mcp", originGuard, mcpAuth, (req, res) => {
    hub.handlePost(req, res).catch((err) => {
      logger.error({ err }, "MCP POST failed");
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    });
  });
  app.get("/mcp", originGuard, mcpAuth, (req, res) => {
    hub.handleSession(req, res).catch((err) => logger.error({ err }, "MCP GET failed"));
  });
  app.delete("/mcp", originGuard, mcpAuth, (req, res) => {
    hub.handleSession(req, res).catch((err) => logger.error({ err }, "MCP DELETE failed"));
  });

  /* ------------------------------- REST API ------------------------------- */
  // Local UI control plane. Bound to 127.0.0.1; the UI is same-origin.

  const api = express.Router();

  // express-5 types route params as string | string[]; coerce to a plain string.
  const param = (req: Request, name: string): string => {
    const v = (req.params as Record<string, string | string[] | undefined>)[name];
    return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  };

  const wrap =
    (fn: (req: Request, res: Response) => void) =>
    (req: Request, res: Response) => {
      try {
        fn(req, res);
      } catch (err) {
        if (err instanceof BothreadError) {
          res.status(400).json({ error: err.message, code: err.code });
        } else {
          logger.error({ err }, "API error");
          res.status(500).json({ error: "Internal error" });
        }
      }
    };

  api.get("/health", (_req, res) => res.json({ ok: true, sessions: hub.count }));

  // Everything the UI needs to render copy-paste agent-connect snippets.
  api.get("/connect-info", (_req, res) =>
    res.json({
      mcpUrl: `http://${config.host}:${config.port}/mcp`,
      token: config.authRequired ? token : null,
      authRequired: config.authRequired,
    })
  );

  api.get(
    "/rooms",
    wrap((_req, res) => res.json({ rooms: engine.listRooms() }))
  );

  api.post(
    "/rooms",
    wrap((req, res) => {
      const { name, projectPath, settings } = req.body ?? {};
      if (!name || typeof name !== "string") throw new BothreadError("bad_input", "A room name is required.");
      const { room, sessionId } = engine.createRoom({ name, projectPath, settings });
      res.json({ room, sessionId });
    })
  );

  api.get(
    "/rooms/:id",
    wrap((req, res) => {
      const snapshot = engine.snapshotForOverseer(param(req, "id"));
      if (!snapshot) throw new BothreadError("no_room", "Room not found.");
      res.json({
        snapshot,
        sessionId: engine.getRoomSessionId(param(req, "id")),
        participants: engine.listParticipants(param(req, "id")),
        pendingApprovals: engine.pendingApprovals(param(req, "id")),
        leases: engine.activeLeases(param(req, "id")),
      });
    })
  );

  api.post(
    "/rooms/:id/message",
    wrap((req, res) => {
      const { text, importance, mentions } = req.body ?? {};
      if (!text) throw new BothreadError("bad_input", "Message text is required.");
      const msg = engine.overseerMessage(param(req, "id"), text, importance ?? "steering", mentions ?? []);
      res.json({ message: msg });
    })
  );

  api.post(
    "/rooms/:id/status",
    wrap((req, res) => {
      const { status } = req.body ?? {};
      if (status !== "active" && status !== "paused" && status !== "closed") {
        throw new BothreadError("bad_input", "status must be active | paused | closed.");
      }
      res.json({ room: engine.setRoomStatus(param(req, "id"), status) });
    })
  );

  api.post(
    "/rooms/:id/participants/:pid/status",
    wrap((req, res) => {
      const { status } = req.body ?? {};
      const ok = ["active", "muted", "revoked", "idle"];
      if (!ok.includes(status)) throw new BothreadError("bad_input", "Invalid participant status.");
      res.json({ participant: engine.setParticipantStatus(param(req, "id"), param(req, "pid"), status) });
    })
  );

  api.post(
    "/rooms/:id/approvals/:aid/decide",
    wrap((req, res) => {
      const { decision, instruction, decidedBy } = req.body ?? {};
      const parsed = ApprovalStatus.safeParse(decision);
      if (!parsed.success || decision === "pending") {
        throw new BothreadError("bad_input", "decision must be approved | rejected | edited.");
      }
      const approval = engine.decideApproval(
        param(req, "id"),
        param(req, "aid"),
        decision as "approved" | "rejected" | "edited",
        decidedBy ?? "You",
        instruction
      );
      res.json({ approval });
    })
  );

  // Git micro-branch endpoints
  api.get(
    "/rooms/:id/branches",
    wrap((req, res) => {
      const all = req.query["all"] === "true";
      const branches = all ? engine.listAllBranches(param(req, "id")) : engine.listBranches(param(req, "id"));
      res.json({ branches });
    })
  );

  api.post(
    "/rooms/:id/branches/:bid/merge",
    wrap((req, res) => {
      const { mergedBy } = req.body ?? {};
      const branch = engine.mergeBranch(param(req, "id"), param(req, "bid"), mergedBy ?? "You");
      res.json({ branch });
    })
  );

  api.post(
    "/rooms/:id/branches/:bid/discard",
    wrap((req, res) => {
      const { discardedBy } = req.body ?? {};
      const branch = engine.discardBranch(param(req, "id"), param(req, "bid"), discardedBy ?? "You");
      res.json({ branch });
    })
  );

  app.use("/api", api);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  /* --------------------------- Serve built UI ----------------------------- */
  if (config.uiDir && fs.existsSync(config.uiDir)) {
    app.use(express.static(config.uiDir));
    // SPA fallback as a terminal middleware (avoids express-5 wildcard routing).
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      res.sendFile(path.join(config.uiDir!, "index.html"));
    });
  }

  /* ---------------------------- WebSocket push ---------------------------- */

  const attachWebSocket = (server: Server) => {
    const wss = new WebSocketServer({ server, path: "/ws" });
    wss.on("connection", (ws, req) => {
      const url = new URL(req.url ?? "/ws", "http://localhost");
      const roomId = url.searchParams.get("room") ?? "";
      // Initial snapshot so the UI paints immediately.
      const snapshot = engine.snapshotForOverseer(roomId);
      if (snapshot) {
        const ev: ServerEvent = { type: "snapshot", roomId, data: snapshot, ts: Date.now() };
        ws.send(JSON.stringify(ev));
      }
      const off = bus.on(roomId, (ev) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ev));
      });
      ws.on("close", off);
      ws.on("error", off);
    });
  };

  return { app, attachWebSocket };
}
