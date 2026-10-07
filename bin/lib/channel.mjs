/**
 * `bothread channel --agent "<room name>" [--port <hub port>] [--path <project>]`
 *
 * A Claude Code *channel*: a tiny stdio MCP server that Claude Code spawns and that pushes
 * an event into the running session whenever the agent is @mentioned or interrupted in
 * its Bothread room — so an idle Claude Code (turn ended, waiting at the prompt) wakes up
 * and reacts, like a push notification. Mid-turn, the PostToolUse hook and the tool-result
 * banner deliver the same thing at the next tool call.
 *
 * Contract (https://code.claude.com/docs/en/channels-reference): declare
 * `capabilities.experimental["claude/channel"] = {}`, connect over stdio, and emit
 * `notifications/claude/channel` with `{ content, meta }` (meta keys: identifiers only).
 * Channels are a research preview: register this server in `.mcp.json` (bothread hooks
 * install --channel does it) and start Claude Code with
 *   claude --dangerously-load-development-channels server:bothread-channel
 *
 * Zero dependencies: newline-delimited JSON-RPC over stdio, written by hand. The server
 * answers the initialize handshake with a protocol revision it knows (never 2026-07-28 —
 * Claude Code doesn't register channels on that revision), so it stays on the handshake
 * channels work with. It long-polls the hub's POST /api/agent-inbox with its own per-room
 * cursor (it never marks anything as notified, so the hook / banner still fire mid-turn).
 * stdout carries only JSON-RPC; diagnostics go to stderr.
 */
import { CHANNEL_SERVER_NAME, hubCall as defaultHubCall, portFromEnv, projectOf } from "./hooks.mjs";

export { CHANNEL_SERVER_NAME };
const DEFAULT_AGENT = "Claude Code";
/** Revisions this server speaks, newest first. 2026-07-28 is deliberately absent. */
export const CHANNEL_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const FALLBACK_PROTOCOL = "2025-06-18";
const WAIT_MS = 25_000;

const INSTRUCTIONS =
  `Events from your Bothread room arrive as <channel source="${CHANNEL_SERVER_NAME}" room="…" from="…" seq="…" kind="mention|interrupt">. ` +
  "Each one means another AI agent or the human overseer in your Bothread room @mentioned or interrupted you. " +
  "Read it, then answer in the room with the bothread send_message tool (pass replyToSeq: the seq attribute) before carrying on; " +
  "if it tells you to stop or change course, do that. There is no reply tool on this channel — reply through the room.";

const one = (text, max = 600) => {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The channel event for one interrupt. */
export function channelEvent(room, i) {
  const from = i.authorKind === "human" ? `${i.author} (the human overseer)` : i.authorKind === "system" ? "Bothread" : i.author;
  const what = i.mentioned ? `@mentioned you` : `sent an interrupt`;
  return {
    content:
      `${from} ${what} in Bothread room "${room.roomName}" [#${i.seq}]: ${one(i.text)}\n` +
      `Read it and respond in the room (send_message with replyToSeq: ${i.seq}) before continuing.`,
    meta: {
      room: String(room.roomName),
      from: String(i.author),
      from_kind: String(i.authorKind),
      seq: String(i.seq),
      kind: i.mentioned ? "mention" : "interrupt",
      importance: String(i.importance),
    },
  };
}

/**
 * The channel, transport-agnostic so it can be tested: `write(obj)` sends one JSON-RPC
 * message, `handle(obj)` processes one incoming. `pollOnce()` asks the hub once and
 * pushes what it finds; `start()` loops it after `notifications/initialized`.
 */
export function createChannel({ agent, port, projectPath, write, hubCall = defaultHubCall, log = () => {}, version = "0" }) {
  const since = {}; // roomId → newest seq already pushed (or skipped)
  let initialized = false;
  let stopped = false;
  let looping = false;

  const respond = (id, result) => write({ jsonrpc: "2.0", id, result });
  const error = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });

  async function pollOnce(waitMs = 0) {
    const body = { projectPath, agent, since: Object.keys(since).length ? since : undefined, waitMs };
    const r = await hubCall(port, "POST", "/api/agent-inbox", body, waitMs + 5000);
    if (r.status !== 200 || !Array.isArray(r.json?.rooms)) throw new Error(`hub answered ${r.status}`);
    let pushed = 0;
    for (const room of r.json.rooms) {
      for (const i of Array.isArray(room.interrupts) ? room.interrupts : []) {
        if (typeof since[room.roomId] === "number" && i.seq <= since[room.roomId]) continue;
        write({ jsonrpc: "2.0", method: "notifications/claude/channel", params: channelEvent(room, i) });
        pushed++;
      }
      if (typeof room.latestSeq === "number") since[room.roomId] = Math.max(since[room.roomId] ?? 0, room.latestSeq);
    }
    return pushed;
  }

  async function loop() {
    if (looping) return;
    looping = true;
    let backoff = 2000;
    while (!stopped) {
      try {
        await pollOnce(WAIT_MS);
        backoff = 2000;
      } catch (err) {
        log(`bothread channel: hub not reachable on port ${port} (${err?.message ?? err}); retrying in ${Math.round(backoff / 1000)}s`);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(15_000, backoff * 2);
      }
    }
    looping = false;
  }

  function handle(msg) {
    if (!msg || typeof msg !== "object") return;
    const { id, method } = msg;
    const isRequest = id !== undefined && id !== null && typeof method === "string";
    if (method === "initialize" && isRequest) {
      const asked = msg.params?.protocolVersion;
      respond(id, {
        protocolVersion: CHANNEL_PROTOCOLS.includes(asked) ? asked : FALLBACK_PROTOCOL,
        capabilities: { experimental: { "claude/channel": {} } },
        serverInfo: { name: CHANNEL_SERVER_NAME, version },
        instructions: `${INSTRUCTIONS} You are "${agent}" in the room.`,
      });
      return;
    }
    if (method === "notifications/initialized") {
      if (!initialized) {
        initialized = true;
        loop();
      }
      return;
    }
    if (method === "ping" && isRequest) return respond(id, {});
    if (isRequest) error(id, -32601, `Method not found: ${method}`);
    // other notifications (cancelled, roots/list_changed, …) need no answer
  }

  return {
    handle,
    pollOnce,
    stop: () => {
      stopped = true;
    },
    get since() {
      return { ...since };
    },
  };
}

/** `bothread channel`: run over this process's stdio until stdin closes. */
export async function cmdChannel({ flags }, { CliError, version }) {
  const agent = (process.env.BOTHREAD_AGENT ?? "").trim() || String(flags.agent ?? "").trim() || DEFAULT_AGENT;
  if (agent.length > 64) throw new CliError("--agent must be at most 64 characters.");
  const port = portFromEnv(flags);
  const projectPath = projectOf({ cwd: typeof flags.path === "string" ? flags.path : undefined });
  const write = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
  const log = (s) => process.stderr.write(s.endsWith("\n") ? s : s + "\n");
  const ch = createChannel({ agent, port, projectPath, write, log, version });
  log(`bothread channel: pushing @mentions/interrupts for "${agent}" (project ${projectPath}, hub port ${port})`);

  await new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
          continue;
        }
        for (const m of Array.isArray(msg) ? msg : [msg]) ch.handle(m);
      }
    });
    process.stdin.on("end", resolve);
    process.stdin.on("close", resolve);
  });
  ch.stop();
  process.exit(0); // don't wait out an in-flight long-poll once Claude Code has gone
}
