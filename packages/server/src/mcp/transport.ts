import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { Engine } from "../engine/engine";
import { logger } from "../logger";
import { createMcpServer, type McpConn } from "./tools";

/**
 * Manages MCP-over-Streamable-HTTP sessions. One McpServer + transport per
 * connected agent; shared room state lives in the Engine. The `Mcp-Session-Id`
 * header identifies a connection across its POST (JSON-RPC), GET (SSE push),
 * and DELETE (teardown) requests.
 */
export class McpHub {
  private sessions = new Map<string, { transport: StreamableHTTPServerTransport }>();

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
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newId) => {
          conn.sessionId = newId;
          this.sessions.set(newId, { transport: created });
          logger.info({ sid: newId }, "MCP session initialized");
        },
      });
      created.onclose = () => {
        const id = created.sessionId;
        if (id && this.sessions.delete(id)) logger.info({ sid: id }, "MCP session closed");
      };
      const server = createMcpServer(this.engine, conn);
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
