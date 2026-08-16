import http from "node:http";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database";
import { Engine } from "../src/engine/engine";
import { buildApp } from "../src/http";
import { McpHub } from "../src/mcp/transport";
import { RoomBus } from "../src/realtime";

/**
 * Regression cover for a crash on hosts without IPv6.
 *
 * `ws` mirrors the http server's `error` event onto the WebSocketServer it
 * creates, and registers that mirror BEFORE any handler the caller adds
 * afterwards. Node throws on an unhandled `error` emit, so guarding only the
 * http server still killed the process — the throw happened in ws's listener
 * and the caller's handler never ran.
 *
 * Symptom: `bothread start` died with EAFNOSUPPORT on the optional `::1`
 * listener, and the friendly EADDRINUSE message on the primary listener was
 * unreachable for the same reason.
 */
function harness() {
  const db = openDatabase(":memory:");
  const bus = new RoomBus();
  const engine = new Engine(db, bus);
  const hub = new McpHub(engine);
  const config = {
    host: "127.0.0.1",
    port: 0,
    dbPath: ":memory:",
    installToken: "test",
    authRequired: false,
  };
  const { app, attachWebSocket } = buildApp({ engine, bus, hub, config, token: "test" });
  const server = http.createServer(app);
  const wss = attachWebSocket(server);
  return { server, wss, close: () => db.close() };
}

const listenError = (code: string) =>
  Object.assign(new Error(`listen ${code}`), { code }) as NodeJS.ErrnoException;

describe("listen-failure handling", () => {
  it("attachWebSocket returns the WebSocketServer so callers can guard it", () => {
    const { wss, close } = harness();
    expect(typeof wss.on).toBe("function");
    close();
  });

  it("survives a listen failure when BOTH the server and its socket are guarded", () => {
    const { server, wss, close } = harness();
    server.on("error", () => {});
    wss.on("error", () => {});

    // This is what a host with IPv6 disabled produces on server6.listen("::1").
    expect(() => server.emit("error", listenError("EAFNOSUPPORT"))).not.toThrow();
    close();
  });

  it("still runs the caller's handler, rather than dying inside ws's mirror", () => {
    const { server, wss, close } = harness();
    const seen: string[] = [];
    wss.on("error", () => {});
    server.on("error", (err: NodeJS.ErrnoException) => seen.push(err.code ?? "?"));

    server.emit("error", listenError("EADDRINUSE"));

    // The friendly "port already in use" message hangs off this handler.
    expect(seen).toEqual(["EADDRINUSE"]);
    close();
  });

  it("documents the bug: guarding only the http server is not enough", () => {
    const { server, close } = harness();
    server.on("error", () => {});

    // No wss handler: ws re-emits onto the WebSocketServer, which throws.
    expect(() => server.emit("error", listenError("EAFNOSUPPORT"))).toThrow();
    close();
  });
});
