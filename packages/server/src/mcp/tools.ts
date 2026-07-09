import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CancelHandoffInput,
  CheckFilesInput,
  ClaimFilesInput,
  CreateTaskInput,
  EditMessageInput,
  GetRoomStateInput,
  JoinSessionInput,
  LeaveSessionInput,
  ReadMessagesInput,
  RecordNoteInput,
  RenewFilesInput,
  ReleaseFilesInput,
  RequestApprovalInput,
  RequestHandoffInput,
  ResolveNoteInput,
  RetractMessageInput,
  SendMessageInput,
  UpdateTaskInput,
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

/** Shared staleness phrasing for a lock/claim holder, used by both renderSnapshot and check_files. */
function staleNote(heldByLastSeen: number, heldByListening: boolean): string {
  if (heldByListening) return " (listening)";
  const idleMs = Date.now() - heldByLastSeen;
  return idleMs > 120_000 ? ` (holder idle ~${Math.round(idleMs / 60000)}m — may be stale; consider request_handoff)` : "";
}

/** A compact, legible rendering of the room so the agent instantly orients. */
export function renderSnapshot(s: RoomSnapshot): string {
  const lines: string[] = [];
  lines.push(`Room "${s.room.name}" — ${s.room.status.toUpperCase()}. You are ${s.you.name} (${s.you.status}).`);
  if (s.room.requireApprovalFor.length) {
    lines.push(
      `The human requires request_approval BEFORE these actions: ${s.room.requireApprovalFor.join(", ")}.`
    );
  }

  const others = s.participants.filter((p) => p.id !== s.you.id);
  if (others.length) {
    lines.push("Participants:");
    for (const p of others) {
      const files = p.claimedFiles.length ? ` holding [${p.claimedFiles.join(", ")}]` : "";
      const caps = p.capabilities?.length ? ` [capabilities: ${p.capabilities.join(", ")}]` : "";
      if (p.idle) {
        const mins = Math.max(1, Math.round((Date.now() - p.lastSeen) / 60000));
        lines.push(`  • ${p.name}${p.brand ? ` (${p.brand})` : ""} — idle (no activity in ${mins}m, may have dropped off)${files}${caps}`);
      } else {
        lines.push(`  • ${p.name}${p.brand ? ` (${p.brand})` : ""} — ${p.status}${files}${caps}`);
      }
    }
  }

  if (s.overseerActive !== undefined) {
    if (s.overseerActive) {
      lines.push("The human's room UI is open and actively watching right now.");
    } else if (s.overseerLastSeenSeq !== undefined) {
      const behind = s.latestSeq - s.overseerLastSeenSeq;
      lines.push(
        behind > 0
          ? `The human isn't actively watching right now — as of their last look, they were ${behind} message(s) behind the current thread.`
          : "The human isn't actively watching right now, but was caught up as of their last look."
      );
    } else {
      lines.push("The human hasn't opened the room UI yet this session.");
    }
  }

  if (s.locks.length) {
    lines.push("Active file locks:");
    for (const l of s.locks) {
      const idleNote = staleNote(l.heldByLastSeen, l.heldByListening);
      lines.push(`  • ${l.path} — ${l.heldByName}${l.exclusive ? " [exclusive]" : " [shared]"}${idleNote}`);
    }
  } else {
    lines.push("No files are currently claimed.");
  }

  if (s.pendingApprovals.length) {
    lines.push("Pending approvals (awaiting the human):");
    for (const a of s.pendingApprovals) lines.push(`  • ${a.requestedBy}: ${a.action} — ${a.details}`);
  }

  if (s.handoffs.length) {
    lines.push("Open hand-off requests:");
    for (const h of s.handoffs) {
      const mine = h.heldBy === s.you.name ? " ← you hold this; release it or reply" : "";
      lines.push(`  • ${h.requestedBy} wants ${h.path} (held by ${h.heldBy})${mine}`);
    }
  }

  if (s.tasks.length) {
    lines.push("Task board:");
    for (const t of s.tasks) {
      const owner = t.ownerName ? ` — ${t.ownerName}` : " — unassigned";
      lines.push(`  • [${t.status}] ${t.title}${owner}`);
    }
  }

  if (s.notes.length) {
    const open = s.notes.filter((n) => n.status === "open");
    if (open.length) {
      lines.push("Notes (decisions/issues/verification):");
      for (const k of ["decision", "issue", "verification"] as const) {
        const group = open.filter((n) => n.kind === k);
        if (!group.length) continue;
        lines.push(`  ${k}s:`);
        for (const n of group) lines.push(`    • ${n.title}${n.authorName ? ` (${n.authorName})` : ""}`);
      }
    }
  }

  if (s.channels.length) {
    lines.push(`Channels in use (send_message's threadId): ${s.channels.join(", ")}`);
  }

  if (s.thread.length) {
    lines.push("Recent thread:");
    for (const m of s.thread.slice(-8)) {
      const reply = m.replyToSeq !== undefined ? ` (↳ replying to #${m.replyToSeq})` : "";
      const edited = m.editedAt ? " (edited)" : "";
      lines.push(`  [${m.seq}] ${m.author}${m.kind === "system" ? " (system)" : ""}${reply}${edited}: ${m.text}`);
    }
  }

  lines.push(`\nEtiquette: ${s.etiquette}`);
  return lines.join("\n");
}

const readOnly = { readOnlyHint: true } as const;

/**
 * Create a fresh McpServer for one agent connection and register the Bothread
 * tool surface (19 tools). All room state lives in the shared Engine; this
 * server just wires the agent's calls to it, scoped by the connection's MCP
 * session id (set on initialize via `conn`).
 */
export function createMcpServer(engine: Engine, conn: McpConn): McpServer {
  const server = new McpServer(
    { name: "bothread", version: "0.1.0" },
    {
      capabilities: { logging: {} },
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
        const { participant, snapshot, previousRoomName, rejoinDigest } = engine.joinSession(conn.sessionId, args);
        const switchNote = previousRoomName
          ? `⚠ Room switch: you were in "${previousRoomName}" — that connection has now moved to THIS room; you've left "${previousRoomName}". If you meant to stay there, re-join with its session ID.\n\n`
          : "";
        let welcomeBack = "";
        if (rejoinDigest) {
          const awayMin = Math.max(1, Math.round(rejoinDigest.awayMs / 60000));
          const bits: string[] = [];
          if (rejoinDigest.newMessages) bits.push(`${rejoinDigest.newMessages} new message${rejoinDigest.newMessages !== 1 ? "s" : ""}`);
          if (rejoinDigest.tasksChanged) bits.push(`${rejoinDigest.tasksChanged} task${rejoinDigest.tasksChanged !== 1 ? "s" : ""} updated`);
          if (rejoinDigest.branchesResolved) bits.push(`${rejoinDigest.branchesResolved} branch${rejoinDigest.branchesResolved !== 1 ? "es" : ""} resolved`);
          if (rejoinDigest.handoffEvents) bits.push(`${rejoinDigest.handoffEvents} hand-off event${rejoinDigest.handoffEvents !== 1 ? "s" : ""}`);
          const summary = bits.length ? bits.join(", ") + "." : "nothing changed while you were away.";
          welcomeBack =
            `Welcome back — you were away ~${awayMin}m. ${summary}` +
            (rejoinDigest.newMessages ? " Use read_messages(since=...) if you need the full detail." : "") +
            "\n\n";
        }
        return ok(`${switchNote}${welcomeBack}Joined as ${participant.name}.\n\n${renderSnapshot(snapshot)}`, snapshot);
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
        const snap = engine.snapshotForAgent(caller.room, caller.participant);
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
        "Post to the shared thread so other agents and the human can see it. Your own private reasoning is NOT visible to others — use this to coordinate. Use mentions to direct it at a participant by name. If you mention anyone, the result tells you honestly whether they're currently listening (parked in wait_for_update) — a real delivery signal, not a guess.",
      inputSchema: SendMessageInput.shape,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const msg = engine.sendMessage(caller, args);
        const mentionDelivery = engine.mentionDeliveryStatus(caller, args.mentions ?? []);
        let summary = `Sent (seq ${msg.seq}).`;
        if (mentionDelivery.length) {
          const parts = mentionDelivery.map((m) =>
            m.listening
              ? `${m.name} is listening — this'll reach it immediately`
              : `${m.name} is not currently listening`
          );
          summary += ` ${parts.join("; ")}.`;
        }
        return ok(summary, { seq: msg.seq, mentionDelivery });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "edit_message",
    {
      title: "Edit one of your own messages",
      description:
        "Correct something you already sent. Only your own messages, and only if it hasn't been retracted. Everyone reading the thread sees the new text plus an 'edited' marker — this isn't a silent rewrite.",
      inputSchema: EditMessageInput.shape,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const msg = engine.editMessage(caller, args);
        return ok(`Edited (seq ${msg.seq}).`, { seq: msg.seq });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "retract_message",
    {
      title: "Retract one of your own messages",
      description:
        "Take back something you sent that turned out wrong or confusing. Only your own messages. The text is replaced with '[message retracted]' for everyone — the row stays (nothing is silently erased), it's just no longer shown.",
      inputSchema: RetractMessageInput.shape,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const msg = engine.retractMessage(caller, args);
        return ok(`Retracted (seq ${msg.seq}).`, { seq: msg.seq });
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
        const parts: string[] = [];
        if (res.newMessages.length) parts.push(`${res.newMessages.length} new message(s)`);
        if (res.handoffsForYou.length)
          parts.push(
            `${res.handoffsForYou.length} agent(s) waiting on files you hold (${res.handoffsForYou
              .map((h) => `${h.requestedBy}→${h.path}`)
              .join(", ")}) — release them or reply`
          );
        return ok(parts.length ? parts.join("; ") + "." : "No new activity.", res);
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
    "check_files",
    {
      title: "Quietly check who holds a file",
      description:
        "Silently check current ownership of one or more glob paths — a read-only peek with NO side effects: it does not claim anything, posts no message, opens no hand-off, and is invisible to everyone else. Reports whether the current holder's claim looks stale (idle, may have dropped off). Use this to test the water before claim_files, instead of risking a PREVENTED attempt that broadcasts to the room.",
      inputSchema: CheckFilesInput.shape,
      annotations: readOnly,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const res = engine.checkFiles(caller, args.paths);
        const summary = res
          .map((r) =>
            r.held
              ? `${r.path}: held by ${r.heldByName} (${r.exclusive ? "exclusive" : "shared"})${staleNote(r.heldByLastSeen ?? 0, r.heldByListening ?? false)}.`
              : `${r.path}: free.`
          )
          .join(" ");
        return ok(summary, res);
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
    "request_handoff",
    {
      title: "Ask the holder to hand off a file",
      description:
        "When you need a path that another participant currently holds (e.g. your claim_files was PREVENTED), call this. Bothread routes a tracked request to the holder and @-mentions them; when they release it, you're notified it's free. Then keep working on something else and wait_for_update — don't edit the held path.",
      inputSchema: RequestHandoffInput.shape,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const res = engine.requestHandoff(caller, args);
        return ok(
          res.routed
            ? `Requested ${args.path} from ${res.holder}. They've been notified; wait_for_update and you'll hear when it's free.`
            : res.reason ?? "Could not route the request.",
          res
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "cancel_handoff",
    {
      title: "Retract your own hand-off request",
      description:
        "Cancel a request_handoff you made yourself if you no longer need the file (e.g. you found another way, or the task changed). Only cancels YOUR pending requests.",
      inputSchema: CancelHandoffInput.shape,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const res = engine.cancelHandoff(caller, args.handoffId);
        return ok(res.cancelled ? "Cancelled." : "That request was already resolved.", res);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "create_task",
    {
      title: "Add a task to the shared board",
      description:
        "Add a task to the room's shared task board (task → owner → status) so the team doesn't have to reconstruct 'who owns what' from chat. Set claim:true to take it yourself immediately. Everyone sees the board in get_room_state.",
      inputSchema: CreateTaskInput.shape,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const task = engine.createTask(caller, args);
        return ok(`Task added${task.ownerName ? ` and claimed by ${task.ownerName}` : ""}.`, task);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "update_task",
    {
      title: "Update or claim a task",
      description:
        "Update a task's status (open/in_progress/done/cancelled), add a note, or take ownership. Use this instead of narrating status in chat — it's a non-locking way to signal 'I'm on this' without claiming any files.",
      inputSchema: UpdateTaskInput.shape,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const task = engine.updateTask(caller, args);
        return ok(`Task "${task.title}" updated.`, task);
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

  server.registerTool(
    "record_note",
    {
      title: "Record a durable decision, issue, or verification report",
      description:
        "Write a durable record so it isn't lost in chat: a 'decision' (an architectural/design call other participants — including one joining late — need to know), an 'issue' (something worth flagging but not blocking, e.g. a leftover artifact or a shortcut taken), or a 'verification' (a test you ran — put tested/expected/actual in detail). Shows up in every participant's room state and the overseer's UI.",
      inputSchema: RecordNoteInput.shape,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const note = engine.recordNote(caller, args);
        return ok(`Recorded ${note.kind}: ${note.title} (id ${note.id}).`, note);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "resolve_note",
    {
      title: "Resolve a recorded note",
      description:
        "Mark a previously recorded decision/issue/verification note as resolved, optionally appending what was done about it.",
      inputSchema: ResolveNoteInput.shape,
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const note = engine.resolveNote(caller, args);
        return ok(`Resolved ${note.kind}: ${note.title}.`, note);
      } catch (e) {
        return fail(e);
      }
    }
  );

  return server;
}
