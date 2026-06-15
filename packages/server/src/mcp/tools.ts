import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ClaimFilesInput,
  GetRoomStateInput,
  JoinSessionInput,
  LeaveSessionInput,
  ReadMessagesInput,
  RenewFilesInput,
  ReleaseFilesInput,
  RequestApprovalInput,
  SendMessageInput,
  WaitForUpdateInput,
  type RoomSnapshot,
} from "@bothread/shared";
import type { Engine } from "../engine/engine";
import { BothreadError } from "../engine/errors";

/** Mutable holder for the connection's MCP session id (set on initialize). */
export interface McpConn {
  sessionId: string | undefined;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(summary: string, data?: unknown): ToolResult {
  const text =
    data === undefined
      ? summary
      : `${summary}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
  return { content: [{ type: "text", text }] };
}

function fail(err: unknown): ToolResult {
  const msg = err instanceof BothreadError ? `${err.message} (${err.code})` : err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

/** A compact, legible rendering of the room so the agent instantly orients. */
export function renderSnapshot(s: RoomSnapshot): string {
  const lines: string[] = [];
  lines.push(`Room "${s.room.name}" — ${s.room.status.toUpperCase()}. You are ${s.you.name} (${s.you.status}).`);

  const others = s.participants.filter((p) => p.id !== s.you.id);
  if (others.length) {
    lines.push("Participants:");
    for (const p of others) {
      const files = p.claimedFiles.length ? ` holding [${p.claimedFiles.join(", ")}]` : "";
      lines.push(`  • ${p.name}${p.brand ? ` (${p.brand})` : ""} — ${p.status}${files}`);
    }
  }

  if (s.locks.length) {
    lines.push("Active file locks:");
    for (const l of s.locks) {
      lines.push(`  • ${l.path} — ${l.heldByName}${l.exclusive ? " [exclusive]" : " [shared]"}`);
    }
  } else {
    lines.push("No files are currently claimed.");
  }

  if (s.pendingApprovals.length) {
    lines.push("Pending approvals (awaiting the human):");
    for (const a of s.pendingApprovals) lines.push(`  • ${a.requestedBy}: ${a.action} — ${a.details}`);
  }

  if (s.thread.length) {
    lines.push("Recent thread:");
    for (const m of s.thread.slice(-8)) {
      lines.push(`  [${m.seq}] ${m.author}${m.kind === "system" ? " (system)" : ""}: ${m.text}`);
    }
  }

  lines.push(`\nEtiquette: ${s.etiquette}`);
  return lines.join("\n");
}

const readOnly = { readOnlyHint: true } as const;

/**
 * Create a fresh McpServer for one agent connection and register the Bothread
 * tool surface (~10 tools). All room state lives in the shared Engine; this
 * server just wires the agent's calls to it, scoped by the connection's MCP
 * session id (set on initialize via `conn`).
 */
export function createMcpServer(engine: Engine, conn: McpConn): McpServer {
  const server = new McpServer(
    { name: "bothread", version: "0.1.0" },
    {
      instructions:
        "Bothread is a shared room where you collaborate with other AI agents under a human overseer. " +
        "First call join_session with the session ID the human gave you, then get_room_state. " +
        "Claim files before editing them; never edit a file another participant holds. " +
        "Communicate with send_message (your own chat text is invisible to others). " +
        "Call request_approval before risky actions. If a tool says the room is paused, wait.",
    }
  );

  server.registerTool(
    "join_session",
    {
      title: "Join a Bothread room",
      description:
        "Join the shared room using the session ID the human pasted to you. Returns a snapshot of the room: who is present, what files are claimed, the recent conversation, and the etiquette to follow. Call this before anything else.",
      inputSchema: JoinSessionInput.shape,
    },
    async (args) => {
      try {
        const { participant, snapshot } = engine.joinSession(conn.sessionId, args);
        return ok(`Joined as ${participant.name}.\n\n${renderSnapshot(snapshot)}`, snapshot);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "get_room_state",
    {
      title: "Get the current room state",
      description:
        "The canonical view of what's going on: participants and their status, files currently claimed and by whom, pending approvals, whether the room is paused, and the recent thread. Call this before acting.",
      inputSchema: GetRoomStateInput.shape,
      annotations: readOnly,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const snap = engine.buildSnapshot(caller.room, caller.participant);
        return ok(renderSnapshot(snap), snap);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "send_message",
    {
      title: "Send a message to the room",
      description:
        "Post to the shared thread so other agents and the human can see it. Your own private reasoning is NOT visible to others — use this to coordinate. Use mentions to direct it at a participant by name.",
      inputSchema: SendMessageInput.shape,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const msg = engine.sendMessage(caller, args);
        return ok(`Sent (seq ${msg.seq}).`, { seq: msg.seq });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "read_messages",
    {
      title: "Read room messages",
      description:
        "Pull messages from the thread, optionally only those after a given seq (your cursor), or only those mentioning you. Robust everywhere — use this to catch up.",
      inputSchema: ReadMessagesInput.shape,
      annotations: readOnly,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const res = engine.readMessages(caller, args);
        return ok(`${res.messages.length} message(s); latest seq ${res.latestSeq}.`, res);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "wait_for_update",
    {
      title: "Wait for new room activity",
      description:
        "Long-poll: blocks up to maxWaitMs and returns as soon as there's a new message, approval decision, or room change. Use this instead of busy-polling get_room_state.",
      inputSchema: WaitForUpdateInput.shape,
      annotations: readOnly,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const res = await engine.waitForUpdate(caller, args);
        return ok(res.changed ? `${res.newMessages.length} new message(s).` : "No new activity.", res);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "claim_files",
    {
      title: "Claim files before editing",
      description:
        "Acquire an advisory lease on one or more glob paths BEFORE you edit them. Exclusive (default) blocks others; shared allows other shared holders. If another agent holds an overlapping exclusive lease, your claim is PREVENTED and you must not edit those files — coordinate via send_message instead.",
      inputSchema: ClaimFilesInput.shape,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const res = engine.claimFiles(caller, args);
        if (res.granted) {
          return ok(`Granted ${res.leases.length} lease(s): ${res.leases.map((l) => l.pathPattern).join(", ")}.`, res);
        }
        const c = res.conflicts.map((x) => `${x.path} (held by ${x.heldByName})`).join(", ");
        return ok(`PREVENTED — do NOT edit these. Conflicts: ${c}. Coordinate with the holder before proceeding.`, res);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "release_files",
    {
      title: "Release file claims",
      description: "Release leases you hold (by path or leaseId, or all of yours if omitted) so others can work on them.",
      inputSchema: ReleaseFilesInput.shape,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const res = engine.releaseFiles(caller, args);
        return ok(`Released ${res.released} lease(s).`, res);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "renew_files",
    {
      title: "Renew file claims",
      description: "Extend the TTL on leases you hold so they don't expire while you're still working.",
      inputSchema: RenewFilesInput.shape,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const res = engine.renewFiles(caller, args);
        return ok(`Renewed ${res.renewed} lease(s).`, res);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "request_approval",
    {
      title: "Request the human's approval",
      description:
        "Ask the human overseer to approve a risky action (delete, deploy, shell, git push, …) BEFORE you do it. This BLOCKS until the human decides, then returns approved / rejected / edited (with an instruction to follow instead). Always call this for risky actions.",
      inputSchema: RequestApprovalInput.shape,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const decision = await engine.requestApproval(caller, args);
        const tail = decision.editedInstruction ? ` Instruction: ${decision.editedInstruction}` : "";
        return ok(`The overseer ${decision.status} your request.${tail}`, decision);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "leave_session",
    {
      title: "Leave the room",
      description: "Release all your file claims and leave the room. Call this when your work is done.",
      inputSchema: LeaveSessionInput.shape,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        engine.leaveSession(caller);
        return ok("You left the room. Your file claims were released.");
      } catch (e) {
        return fail(e);
      }
    }
  );

  return server;
}
