import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { Engine } from "../engine/engine";
import { logger } from "../logger";
import { createMcpServer, type McpConn } from "./tools";

const ROOM_STATE_URI = "bothread://room/state";

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  conn: McpConn;
}

/** The parts of a room message the push needs. */
export interface PushedMessage {
  seq: number;
  authorId: string;
  authorName: string;
  kind: string;
  importance: string;
  text: string;
  mentions: string[];
  editedAt?: number;
  retractedAt?: number;
}

/** What one agent should be pushed for a message: nothing, or a log level + text. */
export function pushFor(m: PushedMessage, agentName: string): { level: "alert" | "warning" | "info"; text: string } | null {
  const me = agentName.trim().toLowerCase();
  const mentioned = m.mentions.some((n) => n.trim().toLowerCase() === me);
  const interrupt = m.importance === "interrupt" && (m.kind === "human" || m.mentions.length === 0);
  const body = m.text.replace(/\s+/g, " ").trim().slice(0, 240);
  const from = m.kind === "human" ? `${m.authorName} (human)` : m.authorName;
  const reply = `reply with send_message replyToSeq: ${m.seq}`;
  if (mentioned || interrupt) {
    const level = m.importance === "interrupt" ? "alert" : "warning";
    const what = mentioned ? `@mention from ${from}` : `Interrupt from ${from}`;
    return { level, text: `📣 ${what} [#${m.seq}]: ${body} — read and respond before continuing (${reply}).` };
  }
  // Unaddressed chatter stays quiet; only the human's messages get a low-priority note.
  if (m.kind === "human") return { level: "info", text: `Message from ${from} [#${m.seq}]: ${body}` };
  return null;
}

/**
 * Manages MCP-over-Streamable-HTTP sessions. One McpServer + transport per
 * connected agent; shared room state lives in the Engine. The `Mcp-Session-Id`
 * header identifies a connection across its POST (JSON-RPC), GET (SSE push),
 * and DELETE (teardown) requests.
 */
export class McpHub {
  private sessions = new Map<string, Session>();

  constructor(private engine: Engine) {}

  get count(): number {
    return this.sessions.size;
  }

  /** POST /mcp — JSON-RPC. Creates a session on `initialize`, else routes by id. */
  async handlePost(req: Request, res: Response): Promise<void> {
    const sid = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sid && this.sessions.has(sid)) {
      transport = this.sessions.get(sid)!.transport;
    } else if (!sid && isInitializeRequest(req.body)) {
      const conn: McpConn = { sessionId: undefined };
      const server = createMcpServer(this.engine, conn);
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newId) => {
          conn.sessionId = newId;
          this.sessions.set(newId, { transport: created, server, conn });
          logger.info({ sid: newId }, "MCP session initialized");
        },
      });
      created.onclose = () => {
        const id = created.sessionId;
        if (id && this.sessions.delete(id)) logger.info({ sid: id }, "MCP session closed");
      };
      await server.connect(created);
      transport = created;
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: no valid session ID. Send an initialize request first." },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  }

  /** GET /mcp (open SSE stream) and DELETE /mcp (teardown). */
  async handleSession(req: Request, res: Response): Promise<void> {
    const sid = req.headers["mcp-session-id"] as string | undefined;
    if (!sid || !this.sessions.has(sid)) {
      res.status(400).send("Invalid or missing Mcp-Session-Id");
      return;
    }
    await this.sessions.get(sid)!.transport.handleRequest(req, res);
  }

  /**
   * Best-effort server→client push when a room message lands, over each agent's SSE
   * stream (clients that keep the GET stream open receive it):
   *  • an agent the message @mentions (incl. @all) — or any agent, for the human's
   *    interrupts and interrupt broadcasts — gets notifications/message at level
   *    "warning" ("alert" for interrupt importance) with "📣 @mention from X …";
   *  • unaddressed agents get nothing, except a low-priority "info" for the human's messages;
   *  • a client that subscribed to bothread://room/state gets notifications/resources/updated.
   * Edits / retractions don't re-push. Never throws: the reliable paths are still the
   * tool-result banner and wait_for_update.
   */
  notifyRoomMessage(roomId: string, m: PushedMessage): void {
    if (m.editedAt || m.retractedAt) return;
    let agents;
    try {
      agents = this.engine
        .listParticipants(roomId)
        .filter((p) => p.kind === "agent" && (p.status === "active" || p.status === "idle") && p.mcpSessionId && p.id !== m.authorId);
    } catch {
      return;
    }
    for (const a of agents) {
      const sess = this.sessions.get(a.mcpSessionId!);
      if (!sess) continue;
      const push = pushFor(m, a.name);
      const swallow = () => {
        /* no open SSE stream / client doesn't accept it — the banner and wait_for_update cover it */
      };
      try {
        if (push) {
          sess.server.server
            .notification({ method: "notifications/message", params: { level: push.level, logger: "bothread", data: push.text } })
            .catch(swallow);
        }
        if (sess.conn.subscriptions?.has(ROOM_STATE_URI)) {
          sess.server.server.notification({ method: "notifications/resources/updated", params: { uri: ROOM_STATE_URI } }).catch(swallow);
        }
      } catch {
        swallow();
      }
    }
  }

  async closeAll(): Promise<void> {
    for (const { transport } of this.sessions.values()) {
      try {
        await transport.close();
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear();
  }
}
