import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { Engine } from "../engine/engine";
import { logger } from "../logger";
import { createMcpServer, type McpConn } from "./tools";

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
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
          this.sessions.set(newId, { transport: created, server });
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
   * Best-effort server→client push: when a room message lands, send a logging
   * notification to every *other* connected agent in that room over their SSE
   * stream. It's belt-and-suspenders — clients that keep the GET stream open
   * receive it; the reliable path is still the agents' own `wait_for_update`.
   */
  notifyRoomMessage(roomId: string, authorId: string, summary: string): void {
    const agents = this.engine
      .listParticipants(roomId)
      .filter((p) => p.kind === "agent" && p.status === "active" && p.mcpSessionId && p.id !== authorId);
    for (const a of agents) {
      const sess = this.sessions.get(a.mcpSessionId!);
      if (!sess) continue;
      sess.server.server
        .notification({
          method: "notifications/message",
          params: { level: "info", logger: "bothread", data: summary },
        })
        .catch(() => {
          /* no open SSE stream / client doesn't accept — fine, wait_for_update covers it */
        });
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
