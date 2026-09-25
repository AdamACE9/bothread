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
import { sendTelemetry } from "./telemetry";
import { VERSION } from "./version";
import { detectAgents, removeAgent, resolveAgentId, setupAgent } from "../../../bin/lib/agents.mjs";

export interface HttpDeps {
  engine: Engine;
  bus: RoomBus;
  hub: McpHub;
  config: HubConfig;
  /** Effective install token agents must present as a Bearer credential. */
  token: string;
}

const isLoopbackName = (host: string): boolean => {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
};

/**
 * Is this socket's peer on this machine? Rewriting agent configs in the user's
 * home is only for someone sitting at this computer — never a LAN client, even
 * one holding the token.
 */
export const isLoopbackRemote = (remoteAddress: string | undefined | null): boolean => {
  if (!remoteAddress) return false;
  const a = remoteAddress.replace(/^::ffff:/i, "").toLowerCase();
  return a === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
};

const isLocalhostOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;
  try {
    return isLoopbackName(new URL(origin).hostname);
  } catch {
    return false;
  }
};

/**
 * May a browser page from `origin` drive this hub? Yes for no Origin (curl,
 * agents, same-origin GETs), a loopback page, or the hub's own page when it's
 * deliberately served on a LAN address (origin host === the Host header).
 */
const isAllowedOrigin = (origin: string | undefined, hostHeader: string | undefined): boolean => {
  if (isLocalhostOrigin(origin)) return true;
  try {
    return !!hostHeader && new URL(origin!).host.toLowerCase() === hostHeader.toLowerCase();
  } catch {
    return false;
  }
};

/** Hostname part of a Host header, handling bracketed IPv6 ("[::1]:4889"). */
const hostnameOf = (hostHeader: string | undefined): string => {
  if (!hostHeader) return "";
  const m = hostHeader.match(/^\[([^\]]+)\]/);
  if (m) return m[1]!;
  return hostHeader.replace(/:\d+$/, "");
};

export function buildApp(deps: HttpDeps): {
  app: express.Express;
  attachWebSocket: (server: Server) => WebSocketServer;
} {
  const { engine, bus, hub, config, token } = deps;
  const app = express();

  const loopbackBind = isLoopbackName(config.host);

  /*
   * DNS-rebinding guard. A page on attacker.example can re-point its own name at
   * 127.0.0.1 and then make same-origin requests to the hub — no Origin header on
   * a simple GET, so an Origin check alone never fires, and it could read every
   * room's session ID. The Host header still says attacker.example, though, so
   * on a loopback bind only loopback Host names are accepted.
   */
  app.use((req, res, next) => {
    if (!loopbackBind) return next();
    if (isLoopbackName(hostnameOf(req.headers.host))) return next();
    res.status(403).json({ error: "Forbidden host (DNS-rebinding protection)." });
  });

  app.use(
    cors({
      // Only the room UI (served from the hub itself, or the Vite dev server on
      // localhost) may call the API from a browser. Reflecting any origin here
      // would let every website you visit read your rooms and drive your agents.
      origin: (origin, cb) => cb(null, isLocalhostOrigin(origin)),
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

  // Cross-site writes: CORS only hides responses, it doesn't stop a form POST or
  // a no-cors fetch from landing. Refuse any browser request from a foreign page.
  api.use((req, res, next) => {
    if (isAllowedOrigin(req.headers.origin, req.headers.host)) return next();
    res.status(403).json({ error: "Forbidden origin." });
  });

  // Off loopback with auth on, the control plane needs the same token agents use —
  // otherwise anyone on the network could read session IDs straight off /api.
  api.use((req, res, next) => {
    if (!config.authRequired || req.path === "/health") return next();
    const remote = req.socket.remoteAddress ?? "";
    if (isLoopbackName(remote.replace(/^::ffff:/, ""))) return next();
    const provided = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (provided && provided === token) return next();
    res.status(401).json({ error: "Unauthorized: this hub requires its access token.", code: "unauthorized" });
  });

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

  // `app` + `version` let the CLI tell "a Bothread hub is already here" apart from
  // some other process squatting on the port.
  api.get("/health", (_req, res) =>
    res.json({ ok: true, app: "bothread", version: VERSION, sessions: hub.count, authRequired: config.authRequired })
  );

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
    wrap((req, res) => {
      if (req.query["summary"] === "1") {
        res.json({ rooms: engine.listRooms(), summaries: engine.roomSummaries() });
        return;
      }
      res.json({ rooms: engine.listRooms() });
    })
  );

  api.post(
    "/rooms",
    wrap((req, res) => {
      const { name, projectPath, settings } = req.body ?? {};
      if (!name || typeof name !== "string") throw new BothreadError("bad_input", "A room name is required.");
      const { room, sessionId } = engine.createRoom({ name, projectPath, settings });
      sendTelemetry("room_created", {
        channel: process.env.BOTHREAD_CHANNEL,
        version: process.env.BOTHREAD_VERSION,
      });
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
        room: engine.getRoom(param(req, "id")),
        sessionId: engine.getRoomSessionId(param(req, "id")),
        participants: engine.listParticipants(param(req, "id")),
        pendingApprovals: engine.pendingApprovals(param(req, "id")),
        leases: engine.activeLeases(param(req, "id")),
      });
    })
  );

  // "Load earlier messages" for the human's live thread view — pages backward past
  // OVERSEER_THREAD_LIMIT. Nothing is ever deleted from the DB; this just reaches further back.
  api.get(
    "/rooms/:id/messages",
    wrap((req, res) => {
      const before = Number(req.query["before"]);
      if (!Number.isFinite(before)) throw new BothreadError("bad_input", "?before=<seq> is required.");
      const limit = Math.min(Number(req.query["limit"] ?? 40) || 40, 200);
      res.json(engine.messagesBefore(param(req, "id"), before, limit));
    })
  );

  api.post(
    "/rooms/:id/message",
    wrap((req, res) => {
      const { text, importance, mentions, threadId, replyToSeq } = req.body ?? {};
      if (!text || typeof text !== "string") throw new BothreadError("bad_input", "Message text is required.");
      const imp = importance ?? "steering";
      if (!["info", "advisory", "steering", "interrupt"].includes(imp)) {
        throw new BothreadError("bad_input", "importance must be info | advisory | steering | interrupt.");
      }
      const msg = engine.overseerMessage(param(req, "id"), text, imp, Array.isArray(mentions) ? mentions : [], {
        threadId: typeof threadId === "string" && threadId.trim() ? threadId.trim() : undefined,
        replyToSeq: typeof replyToSeq === "number" ? replyToSeq : undefined,
      });
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
    "/rooms/:id/rename",
    wrap((req, res) => {
      const { name } = req.body ?? {};
      if (!name || typeof name !== "string" || !name.trim()) {
        throw new BothreadError("bad_input", "A non-empty room name is required.");
      }
      res.json({ room: engine.renameRoom(param(req, "id"), name.trim()) });
    })
  );

  api.post(
    "/rooms/:id/settings",
    wrap((req, res) => {
      const { requireApprovalFor, defaultLeaseTtlMs } = req.body ?? {};
      const partial: { requireApprovalFor?: string[]; defaultLeaseTtlMs?: number } = {};
      if (requireApprovalFor !== undefined) {
        if (!Array.isArray(requireApprovalFor)) throw new BothreadError("bad_input", "requireApprovalFor must be an array.");
        partial.requireApprovalFor = requireApprovalFor as string[];
      }
      if (defaultLeaseTtlMs !== undefined) {
        if (typeof defaultLeaseTtlMs !== "number" || defaultLeaseTtlMs <= 0)
          throw new BothreadError("bad_input", "defaultLeaseTtlMs must be a positive number.");
        partial.defaultLeaseTtlMs = defaultLeaseTtlMs;
      }
      res.json({ room: engine.updateRoomSettings(param(req, "id"), partial as never) });
    })
  );

  // Permanent — deletes the room row plus everything scoped to it (messages, leases,
  // approvals, audit, tasks, notes, git-branch-tracking). No undo.
  api.delete(
    "/rooms/:id",
    wrap((req, res) => {
      engine.deleteRoom(param(req, "id"));
      res.status(204).end();
    })
  );

  api.get(
    "/rooms/:id/audit",
    wrap((req, res) => {
      const limit = Math.min(Number(req.query["limit"] ?? 150) || 150, 500);
      res.json({ audit: engine.listAudit(param(req, "id"), limit) });
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
    "/rooms/:id/participants/:pid/nudge",
    wrap((req, res) => {
      res.json(engine.nudgeParticipant(param(req, "id"), param(req, "pid")));
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

  // Partial accept: keep only the selected hunks, discard the rest.
  api.post(
    "/rooms/:id/branches/:bid/apply",
    wrap((req, res) => {
      const { hunkIds, appliedBy } = req.body ?? {};
      if (!Array.isArray(hunkIds)) throw new BothreadError("bad_input", "hunkIds must be an array.");
      const branch = engine.applyBranchHunks(
        param(req, "id"),
        param(req, "bid"),
        hunkIds as string[],
        appliedBy ?? "You"
      );
      res.json({ branch });
    })
  );

  // Task board — the human can also add/update tasks from the room UI, same engine
  // methods agents call over MCP (via a synthetic overseer Caller).
  api.post(
    "/rooms/:id/tasks",
    wrap((req, res) => {
      const { title, note, claim } = req.body ?? {};
      if (!title || typeof title !== "string") throw new BothreadError("bad_input", "A task title is required.");
      const task = engine.createTask(engine.callerForOverseer(param(req, "id")), { title, note, claim });
      res.json({ task });
    })
  );

  api.post(
    "/rooms/:id/tasks/:tid",
    wrap((req, res) => {
      const { status, note, takeOwnership } = req.body ?? {};
      const task = engine.updateTask(engine.callerForOverseer(param(req, "id")), {
        taskId: param(req, "tid"),
        status,
        note,
        takeOwnership,
      });
      res.json({ task });
    })
  );

  // Notes: durable decisions / issues / verification reports.
  api.post(
    "/rooms/:id/notes",
    wrap((req, res) => {
      const { kind, title, detail } = req.body ?? {};
      if (!kind || !title) throw new BothreadError("bad_input", "kind and title are required.");
      const caller = engine.callerForOverseer(param(req, "id"));
      const note = engine.recordNote(caller, { kind, title, detail });
      res.json({ note });
    })
  );

  api.post(
    "/rooms/:id/notes/:nid/resolve",
    wrap((req, res) => {
      const { resolution } = req.body ?? {};
      const caller = engine.callerForOverseer(param(req, "id"));
      const note = engine.resolveNote(caller, { noteId: param(req, "nid"), resolution });
      res.json({ note });
    })
  );

  // Commit guard: the `bothread guard` pre-commit hook asks whether any staged
  // file is exclusively claimed by someone other than the committing agent.
  api.post(
    "/guard/check",
    wrap((req, res) => {
      const { projectPath, files, agent } = req.body ?? {};
      if (typeof projectPath !== "string" || !projectPath.trim()) {
        throw new BothreadError("bad_input", "projectPath (the repo's top-level folder) is required.");
      }
      if (!Array.isArray(files) || !files.every((f) => typeof f === "string")) {
        throw new BothreadError("bad_input", "files must be an array of repo-relative paths.");
      }
      if (files.length > 5000) throw new BothreadError("bad_input", "Too many files (max 5000).");
      if (agent !== undefined && agent !== null && typeof agent !== "string") {
        throw new BothreadError("bad_input", "agent must be a string.");
      }
      res.json(engine.guardCheck({ projectPath, files: files as string[], agent: agent || undefined }));
    })
  );

  /* ---------- One-click agent setup (the Connect panel's "Set it up for me") ---------- */
  // These read and WRITE MCP config files in the user's home (with backups), so on
  // top of the origin/host/token checks above they only answer loopback peers.
  const localOnly = (req: Request, res: Response, next: NextFunction) => {
    if (isLoopbackRemote(req.socket.remoteAddress)) return next();
    res.status(403).json({ error: "Agent setup only works from the computer the hub runs on.", code: "forbidden" });
  };
  // Agents on this machine reach the hub over loopback, whatever address it binds.
  const agentHost = ["0.0.0.0", "::", "[::]"].includes(config.host) ? "127.0.0.1" : config.host;
  const agentOpts = () => ({ mcpUrl: `http://${agentHost}:${config.port}/mcp`, token: config.authRequired ? token : null });
  // One config write at a time: two clicks must not interleave on the same file.
  let agentQueue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = agentQueue.then(fn, fn);
    agentQueue = next.catch(() => undefined);
    return next;
  };

  api.get("/agents", localOnly, (_req, res) => {
    const agents = detectAgents(agentOpts()).map((a) => ({
      id: a.id,
      label: a.label,
      detected: a.detected,
      configured: a.configured,
      target: a.target,
      canAutoSetup: a.canAutoSetup,
      ...(a.note ? { note: a.note } : {}),
      method: a.method,
      configPath: a.configPath,
    }));
    res.json({ agents });
  });

  const agentAction = (kind: "setup" | "remove") => async (req: Request, res: Response) => {
    const id = resolveAgentId(param(req, "id"));
    if (!id || id === "other") {
      res.status(404).json({ error: `Unknown agent '${param(req, "id")}'.`, code: "no_agent" });
      return;
    }
    try {
      const r = await serialized(() => (kind === "setup" ? setupAgent(id, agentOpts()) : removeAgent(id, agentOpts())));
      const meta = detectAgents(agentOpts()).find((a) => a.id === id);
      const message = r.ok && kind === "setup" && r.changed ? `${r.message} ${meta?.restart ?? "Restart it"} so the tools load.` : r.message;
      res.json({ ok: r.ok, message, target: r.target, backup: r.backup ?? undefined, changed: r.changed, action: r.action, ...(r.snippet && !r.ok ? { snippet: r.snippet } : {}) });
    } catch (err) {
      logger.error({ err }, `agent ${kind} failed`);
      res.status(500).json({ error: `Couldn't ${kind === "setup" ? "set up" : "remove"} ${id}: ${(err as Error).message}` });
    }
  };
  api.post("/agents/:id/setup", localOnly, agentAction("setup"));
  api.post("/agents/:id/remove", localOnly, agentAction("remove"));

  // Serve files agents drop in `<projectPath>/.bothread/attachments/` — the
  // shared evidence folder (screenshots, structured results). Never part of the
  // git-diff review pipeline; this is a plain static read scoped to that folder.
  const ATTACHMENT_MIME: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".log": "text/plain; charset=utf-8",
    ".pdf": "application/pdf",
  };

  api.get(
    "/rooms/:id/attachments/:filename",
    wrap((req, res) => {
      const filename = param(req, "filename");
      // Reject any path-traversal or directory-separator attempt outright —
      // this must be a bare filename, nothing else.
      if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
        throw new BothreadError("bad_input", "Invalid attachment filename.");
      }
      const room = engine.getRoom(param(req, "id"));
      if (!room) throw new BothreadError("no_room", "Room not found.");
      if (!room.projectPath) throw new BothreadError("no_project", "Room has no project path.");

      const attachmentsDir = path.resolve(room.projectPath, ".bothread", "attachments");
      const resolved = path.resolve(attachmentsDir, filename);
      // Belt-and-braces: confirm the resolved path is still inside the attachments dir.
      const rel = path.relative(attachmentsDir, resolved);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new BothreadError("bad_input", "Invalid attachment filename.");
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        res.status(404).json({ error: "Attachment not found." });
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      const stat = fs.statSync(resolved);
      res.setHeader("Content-Type", ATTACHMENT_MIME[ext] ?? "application/octet-stream");
      res.setHeader("Content-Length", String(stat.size));
      // Manual stream (not res.sendFile): the path always contains a dotfile
      // segment (`.bothread/`), which `send`'s default `dotfiles: "ignore"`
      // would otherwise silently 404.
      const stream = fs.createReadStream(resolved);
      stream.on("error", () => {
        if (!res.headersSent) res.status(500).json({ error: "Failed to read attachment." });
      });
      stream.pipe(res);
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

  /**
   * Attach the room-UI push socket to an http server.
   *
   * Returns the WebSocketServer because `ws` mirrors the http server's `error`
   * event onto it. An unhandled `error` emit throws, so a caller that only
   * guards the http server still dies — the caller must handle both.
   */
  const attachWebSocket = (server: Server): WebSocketServer => {
    // Browsers don't apply CORS to WebSockets, so the same origin/host/token rules
    // as /api are enforced here at the handshake (cross-site WebSocket hijacking).
    const wss = new WebSocketServer({
      server,
      path: "/ws",
      verifyClient: ({ origin, req }: { origin: string; req: import("node:http").IncomingMessage }) => {
        if (!isAllowedOrigin(origin || undefined, req.headers.host)) return false;
        if (loopbackBind && !isLoopbackName(hostnameOf(req.headers.host))) return false;
        if (!config.authRequired) return true;
        const remote = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
        if (isLoopbackName(remote)) return true;
        const q = new URL(req.url ?? "/ws", "http://localhost").searchParams.get("token");
        return q === token;
      },
    });
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
    return wss;
  };

  return { app, attachWebSocket };
}
