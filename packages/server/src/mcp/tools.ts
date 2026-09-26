import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  CancelHandoffInput,
  CheckFilesInput,
  ClaimFilesInput,
  ClaimNextTaskInput,
  CreateTaskInput,
  EditMessageInput,
  ETIQUETTE,
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
  type ApprovalDecisionView,
  type HandoffView,
  type PendingApprovalView,
  type RoomNote,
  type RoomSnapshot,
  type RoomTask,
  type ThreadEntry,
} from "@bothread/shared";
import type { Caller, Engine } from "../engine/engine";
import { BothreadError, nextStepFor } from "../engine/errors";
import { VERSION } from "../version";

/** Mutable holder for the connection's MCP session id (set on initialize). */
export interface McpConn {
  sessionId: string | undefined;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * A readable summary, then (optionally) the structured data as a trailing
 * ```json fence. The JSON is compact (no indentation) — pretty-printing roughly
 * doubled the token cost of every result for no benefit to a model.
 */
function ok(summary: string, data?: unknown): ToolResult {
  const text = data === undefined ? summary : `${summary}\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\``;
  return { content: [{ type: "text", text }] };
}

/** "Error: <message> (<code>)" plus a "Next:" line telling the agent exactly how to recover. */
function errorText(message: string, code: string | undefined): string {
  return `Error: ${message}${code ? ` (${code})` : ""}\nNext: ${nextStepFor(code)}`;
}

function fail(err: unknown): ToolResult {
  const text =
    err instanceof BothreadError
      ? errorText(err.message, err.code)
      : errorText(err instanceof Error ? err.message : String(err), undefined);
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Turn the SDK's own tool-level errors (zod input validation, unknown tool) into
 * the same "Error … / Next: …" shape. The SDK reports these as a raw
 * "MCP error -32602: Input validation error: Invalid arguments for tool X: [json issues]".
 */
export function formatSdkToolError(raw: string): string {
  const m = raw.match(/Invalid arguments for tool (\S+): ([\s\S]*)$/);
  if (m) {
    const tool = m[1]!;
    let detail = m[2]!.trim();
    try {
      const issues = JSON.parse(detail) as Array<{ path?: Array<string | number>; message?: string }>;
      if (Array.isArray(issues)) {
        detail = issues.map((i) => `${i.path?.length ? i.path.join(".") : "(arguments)"}: ${i.message ?? "invalid"}`).join("; ");
      }
    } catch {
      /* not JSON — keep the SDK's text */
    }
    return `Error: invalid arguments for ${tool} — ${detail} (invalid_arguments)\nNext: fix the arguments to match ${tool}'s input schema and call it again.`;
  }
  const unknown = raw.match(/Tool (\S+) (not found|disabled)/);
  if (unknown) return errorText(`There is no tool named ${unknown[1]}.`, "unknown_tool");
  return errorText(raw.replace(/^MCP error -?\d+:\s*/, ""), undefined);
}

/** Shared staleness phrasing for a lock/claim holder, used by renderSnapshot, check_files and claim_files. */
function staleNote(heldByLastSeen: number, heldByListening: boolean): string {
  if (heldByListening) return " (listening)";
  const idleMs = Date.now() - heldByLastSeen;
  return idleMs > 120_000 ? ` (holder idle ~${Math.round(idleMs / 60000)}m — may be stale; consider request_handoff)` : "";
}

function minutesUntil(ts: number): number {
  return Math.max(1, Math.round((ts - Date.now()) / 60000));
}

/** Does this message address `you` — an explicit mention, or an "@Name" in its text? */
function mentionsYou(m: ThreadEntry, you: string): boolean {
  const lower = you.toLowerCase();
  if (m.mentions.some((n) => n.toLowerCase() === lower)) return true;
  return m.text.toLowerCase().includes(`@${lower}`);
}

/**
 * One thread line, shared by the snapshot, wait_for_update and read_messages:
 *   [12] Cursor (↳ replying to #10) [#mario] !interrupt → YOU: text
 */
export function renderMessageLine(m: ThreadEntry, you: string): string {
  const system = m.kind === "system" ? " (system)" : "";
  const reply = m.replyToSeq !== undefined ? ` (↳ replying to #${m.replyToSeq})` : "";
  const edited = m.editedAt ? " (edited)" : "";
  const channel = m.threadId ? ` [#${m.threadId}]` : "";
  const importance = m.importance === "steering" || m.importance === "interrupt" ? ` !${m.importance}` : "";
  const toYou = m.author !== you && mentionsYou(m, you) ? " → YOU" : "";
  return `  [${m.seq}] ${m.author}${system}${reply}${edited}${channel}${importance}${toYou}: ${m.text}`;
}

function renderHandoffLine(h: HandoffView, you: string): string {
  const note = h.message ? ` ("${h.message}")` : "";
  if (h.heldBy === you) {
    return `  • ${h.id}: ${h.requestedBy} wants ${h.path}${note} ← you hold this; release_files it when you can, or reply via send_message`;
  }
  if (h.requestedBy === you) {
    return `  • ${h.id}: you want ${h.path} (held by ${h.heldBy}) ← yours; cancel_handoff({ handoffId: "${h.id}" }) if no longer needed`;
  }
  return `  • ${h.id}: ${h.requestedBy} wants ${h.path} (held by ${h.heldBy})${note}`;
}

function renderApprovalLine(a: PendingApprovalView): string {
  return `  • ${a.requestedBy}: ${a.action} — ${a.details}`;
}

/** "Your deploy request was APPROVED by You — …" for a decision delivered via wait_for_update. */
function renderApprovalDecisionLine(d: ApprovalDecisionView): string {
  const by = d.decidedBy ? ` by ${d.decidedBy}` : "";
  const head = `  • Your ${d.action} request (${d.approvalId}, "${d.details}") was`;
  if (d.status === "approved") return `${head} APPROVED${by} — go ahead with exactly what you described, nothing more.`;
  if (d.status === "rejected") return `${head} REJECTED${by} — do NOT do it; pick a different approach or ask the human.`;
  return `${head} EDITED${by}: ${d.editedInstruction ?? "(see the human's instruction)"} — do that instead of your original request.`;
}

/** The ids in a task's blockedBy that are still open / in progress (unknown ids never block). */
function blockersLeft(t: RoomTask, all: RoomTask[]): string[] {
  if (!t.blockedBy?.length) return [];
  const status = new Map(all.map((x) => [x.id, x.status]));
  return t.blockedBy.filter((id) => {
    const st = status.get(id);
    return st === "open" || st === "in_progress";
  });
}

/** One task-board line: `[open] Title (task_x) — you [blocked by task_a, task_b]`. */
function renderTaskLine(t: RoomTask, all: RoomTask[], me: string): string {
  const owner = t.ownerName ? ` — ${t.ownerName === me ? "you" : t.ownerName}` : " — unassigned";
  const left = blockersLeft(t, all);
  const blocked = left.length ? ` [blocked by ${left.join(", ")}]` : "";
  return `  • [${t.status}] ${t.title} (${t.id})${owner}${blocked}`;
}

/** The task board as markdown (the bothread://room/tasks resource). */
export function renderTaskBoardMarkdown(roomName: string, tasks: RoomTask[], me: string): string {
  const lines = [`# Task board — room "${roomName}"`, ""];
  if (!tasks.length) {
    lines.push("No tasks yet. Add one with create_task; take the next ready one with claim_next_task.");
    return lines.join("\n");
  }
  const active = tasks.filter((t) => t.status === "open" || t.status === "in_progress");
  const finished = tasks.filter((t) => t.status === "done" || t.status === "cancelled");
  const row = (t: RoomTask): string => {
    const owner = t.ownerName ? (t.ownerName === me ? "you" : t.ownerName) : "unassigned";
    const left = blockersLeft(t, tasks);
    const deps = t.blockedBy?.length
      ? ` — blocked by ${t.blockedBy.map((id) => (left.includes(id) ? id : `~~${id}~~`)).join(", ")}${left.length ? "" : " (all resolved)"}`
      : "";
    const note = t.note ? `\n  - ${t.note.replace(/\n/g, " ")}` : "";
    return `- \`${t.id}\` **[${t.status}]** ${t.title} — ${owner}${deps}${note}`;
  };
  lines.push("## Active", "");
  if (active.length) for (const t of active) lines.push(row(t));
  else lines.push("_Nothing open or in progress._");
  if (finished.length) {
    lines.push("", "## Done / cancelled", "");
    for (const t of finished) lines.push(row(t));
  }
  return lines.join("\n");
}

/** Open decisions / issues / verifications as markdown (the bothread://room/notes resource). */
export function renderNotesMarkdown(roomName: string, notes: RoomNote[]): string {
  const open = notes.filter((n) => n.status === "open");
  const lines = [`# Open notes — room "${roomName}"`, ""];
  if (!open.length) {
    lines.push("No open decisions, issues or verifications. Record one with record_note.");
    return lines.join("\n");
  }
  const sections: Array<[RoomNote["kind"], string]> = [
    ["decision", "Decisions"],
    ["issue", "Issues"],
    ["verification", "Verifications"],
  ];
  for (const [kind, heading] of sections) {
    const group = open.filter((n) => n.kind === kind);
    if (!group.length) continue;
    lines.push(`## ${heading}`, "");
    for (const n of group) {
      lines.push(`- \`${n.id}\` **${n.title}** — ${n.authorName}`);
      if (n.detail) lines.push(...n.detail.split("\n").map((l) => `  > ${l}`));
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** A compact, legible rendering of the room so the agent instantly orients — with the ids it needs to act. */
export function renderSnapshot(s: RoomSnapshot): string {
  const me = s.you.name;
  const lines: string[] = [];
  lines.push(
    `Room "${s.room.name}" — ${s.room.status.toUpperCase()}. You are ${me} (${s.you.status}). latestSeq ${s.latestSeq}.`
  );
  if (s.room.status === "paused") lines.push("⏸ The room is PAUSED — don't edit anything; call wait_for_update until it resumes.");
  if (s.room.status === "closed") lines.push("The room is CLOSED — stop working in it.");

  const mine = s.locks.filter((l) => l.heldBy === s.you.id);
  if (mine.length) {
    lines.push(
      `You hold: ${mine
        .map((l) => `${l.path}${l.exclusive ? "" : " [shared]"} (expires ~${minutesUntil(l.expiresAt)}m)`)
        .join(", ")} — release_files when done.`
    );
  } else if (s.you.leases.length) {
    lines.push(`You hold: ${s.you.leases.join(", ")} — release_files when done.`);
  }

  if (s.room.requireApprovalFor.length) {
    lines.push(`The human requires request_approval BEFORE these actions: ${s.room.requireApprovalFor.join(", ")}.`);
  }

  const others = s.participants.filter((p) => p.id !== s.you.id);
  if (others.length) {
    lines.push("Participants:");
    for (const p of others) {
      const files = p.claimedFiles.length ? ` holding [${p.claimedFiles.join(", ")}]` : "";
      const caps = p.capabilities?.length ? ` [capabilities: ${p.capabilities.join(", ")}]` : "";
      const brand = p.brand ? ` (${p.brand})` : "";
      if (p.idle) {
        const mins = Math.max(1, Math.round((Date.now() - p.lastSeen) / 60000));
        lines.push(`  • ${p.name}${brand} — idle (no activity in ${mins}m, may have dropped off)${files}${caps}`);
      } else {
        const who = p.kind === "human" ? " (human overseer)" : "";
        lines.push(`  • ${p.name}${who}${brand} — ${p.status}${p.listening ? ", listening" : ""}${files}${caps}`);
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

  const othersLocks = s.locks.filter((l) => l.heldBy !== s.you.id);
  if (othersLocks.length) {
    lines.push("File locks held by others (don't edit these):");
    for (const l of othersLocks) {
      lines.push(
        `  • ${l.path} — ${l.heldByName}${l.exclusive ? " [exclusive]" : " [shared]"}${staleNote(l.heldByLastSeen, l.heldByListening)}`
      );
    }
  } else if (!mine.length) {
    lines.push("No files are currently claimed.");
  }

  if (s.pendingApprovals.length) {
    lines.push("Pending approvals (awaiting the human):");
    for (const a of s.pendingApprovals) lines.push(renderApprovalLine(a));
  }

  if (s.handoffs.length) {
    lines.push("Open hand-off requests:");
    for (const h of s.handoffs) lines.push(renderHandoffLine(h, me));
  }

  if (s.tasks.length) {
    const active = s.tasks.filter((t) => t.status === "open" || t.status === "in_progress");
    const finished = s.tasks.length - active.length;
    lines.push("Task board:");
    for (const t of active) lines.push(renderTaskLine(t, s.tasks, me));
    if (finished) lines.push(`  (${finished} done/cancelled — ids in the JSON)`);
  }

  const openNotes = s.notes.filter((n) => n.status === "open");
  if (openNotes.length) {
    lines.push("Notes (open):");
    for (const n of openNotes) lines.push(`  • ${n.kind} ${n.id}: ${n.title}${n.authorName ? ` (${n.authorName})` : ""}`);
  }

  if (s.channels.length) {
    lines.push(`Channels in use (send_message's threadId): ${s.channels.join(", ")}`);
  }

  if (s.thread.length) {
    lines.push("Recent thread:");
    for (const m of s.thread.slice(-8)) lines.push(renderMessageLine(m, me));
  }

  lines.push(`\nEtiquette: ${s.etiquette}`);
  return lines.join("\n");
}

/**
 * Tool annotations. Bothread is a closed, local system (openWorldHint: false
 * everywhere); nothing is read-only unless it truly has no side effects.
 */
function hints(h: { readOnly?: boolean; destructive?: boolean; idempotent?: boolean }): ToolAnnotations {
  return {
    readOnlyHint: h.readOnly ?? false,
    destructiveHint: h.destructive ?? false,
    idempotentHint: h.idempotent ?? false,
    openWorldHint: false,
  };
}

const SERVER_INSTRUCTIONS = [
  "Bothread: a shared room where you work with other AI agents while a human oversees. Your loop:",
  "1. join_session with the session ID the human pasted (never guess one). Its result IS the room state.",
  "2. Orient: file holders, open tasks, messages marked → YOU. Need work? claim_next_task.",
  "3. claim_files before editing. PREVENTED = don't edit; request_handoff or pick other work.",
  "4. Work. Talk only via send_message — your own text is invisible to others.",
  "5. release_files when done (the human reviews your diff).",
  "6. Task unfinished? wait_for_update (pass since=latestSeq), act, repeat — never just stop.",
  "7. leave_session only when the human says stop or the room closes.",
  "Rules: paused = wait. Honor requireApprovalFor via request_approval. Every result's 'Next:' line tells you what to do.",
].join("\n");

/**
 * Create a fresh McpServer for one agent connection and register the Bothread
 * tool surface (20 tools), two prompts and three read-only resources. All room state lives in the shared
 * Engine; this server just wires the agent's calls to it, scoped by the
 * connection's MCP session id (set on initialize via `conn`).
 */
export function createMcpServer(engine: Engine, conn: McpConn): McpServer {
  const server = new McpServer(
    { name: "bothread", version: VERSION },
    {
      capabilities: { logging: {}, resources: {} },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  // The SDK turns zod input-validation failures (and unknown tools) into a raw
  // error result; reshape it into our "Error … / Next: …" form. `createToolError`
  // is private in the SDK's types, so patch the instance defensively.
  const sdk = server as unknown as { createToolError?: (message: string) => ToolResult };
  if (typeof sdk.createToolError === "function") {
    sdk.createToolError = (message: string): ToolResult => ({
      content: [{ type: "text", text: formatSdkToolError(message) }],
      isError: true,
    });
  }

  /* ----------------------------- Prompts ----------------------------- */

  server.registerPrompt(
    "join",
    {
      title: "Join a Bothread room",
      description: "Join a Bothread room with the session ID the human gave you, and follow the room etiquette.",
      argsSchema: {
        sessionId: z.string().describe("The room session ID from the Bothread app (Connect an agent)."),
        agentName: z.string().optional().describe("Display name for you in the room, e.g. 'Claude Code'."),
      },
    },
    ({ sessionId, agentName }) => {
      const nameArg = agentName ? `"${agentName}"` : "<a short name for you, e.g. your product name>";
      return {
        description: "Join a Bothread room",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Join the Bothread room with session ID ${sessionId}.\n\n` +
                `1. Call join_session({ sessionId: "${sessionId}", agentName: ${nameArg}, brand: <your product, lowercase> }). ` +
                "Its result is the full room state — read it; don't call get_room_state again right away.\n" +
                "2. Post a short hello with send_message: bullets saying what you'll work on.\n" +
                "3. claim_files before editing anything; never edit a file someone else holds.\n" +
                "4. When your step is done but the task isn't, call wait_for_update instead of stopping, and keep looping.\n\n" +
                `Room etiquette: ${ETIQUETTE}`,
            },
          },
        ],
      };
    }
  );

  server.registerPrompt(
    "standup",
    {
      title: "Post a standup to the room",
      description: "Check the room and post a short status update: what you did, what you're doing, what's blocking you.",
    },
    () => ({
      description: "Post a standup to the Bothread room",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Call get_room_state, then post a short standup to the room with send_message as three bullets:\n" +
              "- did: <what you finished>\n- doing: <what you're on now>\n- blocked: <what's blocking you, or 'nothing'>\n" +
              "Keep it under ~60 words, don't repeat what a teammate already confirmed, and update the task board (update_task) if a status changed. " +
              "Then call wait_for_update if the shared task isn't finished.",
          },
        },
      ],
    })
  );

  /* ---------------------------- Resources ---------------------------- */
  // Read-only, cheap views of the caller's room that users can @-attach in their client.
  // Scoped by this connection's joined room, like the tools.

  const NOT_JOINED_TEXT =
    "This connection hasn't joined a Bothread room yet, so there's nothing to show.\n\n" +
    "Call join_session with the session ID the human gave you (never guess one), then read this resource again.";

  const markdownResource =
    (render: (caller: Caller) => string) =>
    (uri: URL) => {
      let text: string;
      try {
        text = render(engine.resolveCaller(conn.sessionId));
      } catch (e) {
        text =
          e instanceof BothreadError && e.code === "not_joined"
            ? NOT_JOINED_TEXT
            : `Can't read the room: ${e instanceof Error ? e.message : String(e)}\nNext: ${nextStepFor(e instanceof BothreadError ? e.code : undefined)}`;
      }
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    };

  server.registerResource(
    "room-state",
    "bothread://room/state",
    {
      title: "Bothread room state",
      description: "The current room snapshot (same as get_room_state): participants, file claims, tasks, notes, recent thread.",
      mimeType: "text/markdown",
    },
    markdownResource((caller) => renderSnapshot(engine.snapshotForAgent(caller.room, caller.participant)))
  );

  server.registerResource(
    "room-tasks",
    "bothread://room/tasks",
    {
      title: "Bothread task board",
      description: "The room's task board: ids, status, owners and blockers.",
      mimeType: "text/markdown",
    },
    markdownResource((caller) => renderTaskBoardMarkdown(caller.room.name, engine.listTasks(caller.room.id), caller.participant.name))
  );

  server.registerResource(
    "room-notes",
    "bothread://room/notes",
    {
      title: "Bothread open notes",
      description: "Open decisions, issues and verification reports recorded in the room.",
      mimeType: "text/markdown",
    },
    markdownResource((caller) => renderNotesMarkdown(caller.room.name, engine.listNotes(caller.room.id)))
  );

  /* ------------------------------ Tools ------------------------------ */

  server.registerTool(
    "join_session",
    {
      title: "Join a Bothread room",
      description:
        "Join the shared room using the session ID the human pasted to you (never guess one). Returns the full room state: who is present, which files are claimed, tasks, notes, the recent conversation, and the etiquette. Call this before anything else — you don't need get_room_state right after.",
      inputSchema: JoinSessionInput.shape,
      annotations: hints({}),
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
        const next =
          "\n\nNext: you already have the room state above — don't call get_room_state again right now. " +
          "send_message a short hello (bullets: what you'll work on), then claim_files before editing.";
        return ok(`${switchNote}${welcomeBack}Joined as ${participant.name}.\n\n${renderSnapshot(snapshot)}${next}`, snapshot);
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
        "The canonical view of what's going on: participants and their status, files claimed and by whom (and what YOU hold), tasks and notes with their ids, pending approvals, open hand-offs, whether the room is paused, and the recent thread (messages to you are marked → YOU). Call before acting or after being away; don't busy-poll it — use wait_for_update.",
      inputSchema: GetRoomStateInput.shape,
      annotations: hints({ readOnly: true, idempotent: true }),
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        let snap = engine.snapshotForAgent(caller.room, caller.participant);
        if (args.since !== undefined) {
          const since = args.since;
          snap = { ...snap, thread: snap.thread.filter((m) => m.seq > since) };
        }
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
      annotations: hints({}),
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
              : `${m.name} is not currently listening (they'll see it on their next room check)`
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
      annotations: hints({ idempotent: true }),
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
        "Take back something you sent that turned out wrong or confusing. Only your own messages. The text is replaced with '[message retracted]' for everyone — the row stays (nothing is silently erased), it's just no longer shown. Can't be undone.",
      inputSchema: RetractMessageInput.shape,
      annotations: hints({ destructive: true, idempotent: true }),
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
        "Pull messages from the thread: after a given seq, only unread ones (unreadOnly: true — everything newer than what the hub last showed you, minus your own), or only those mentioning you. Robust everywhere — use this to catch up.",
      inputSchema: ReadMessagesInput.shape,
      annotations: hints({ readOnly: true, idempotent: true }),
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const res = engine.readMessages(caller, args);
        const me = caller.participant.name;
        const lines = res.messages.map((m) => renderMessageLine(m, me));
        const summary =
          `${res.messages.length} ${args.unreadOnly ? "unread " : ""}message(s); latest seq ${res.latestSeq}.` +
          (lines.length ? `\n${lines.join("\n")}` : "") +
          `\nNext: pass since: ${res.latestSeq} next time to get only newer messages.`;
        return ok(summary, res);
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
        "Long-poll: blocks up to maxWaitMs and returns as soon as there's a new message, approval decision (including decisions on your own requests that came back 'pending'), hand-off, or room change — with the new messages rendered inline. Returns within ~50s max so it stays under client tool timeouts. Returning with no activity is normal; just call it again. Use this instead of busy-polling get_room_state, and instead of ending your turn while the shared task is unfinished.",
      inputSchema: WaitForUpdateInput.shape,
      annotations: hints({ readOnly: true }),
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const res = await engine.waitForUpdate(caller, args);
        const me = caller.participant.name;
        const status = engine.getRoom(caller.room.id)?.status;
        const lines: string[] = [];
        if (status === "paused") lines.push("⏸ The room is PAUSED — don't edit anything until it resumes.");
        if (status === "closed") lines.push("The room is CLOSED — stop working in it and tell your human.");

        if (res.newMessages.length) {
          lines.push(`${res.newMessages.length} new message(s):`);
          for (const m of res.newMessages) lines.push(renderMessageLine(m, me));
        }
        if (res.approvalDecisions.length) {
          lines.push("The human decided on your approval request(s):");
          for (const d of res.approvalDecisions) lines.push(renderApprovalDecisionLine(d));
        }
        if (res.handoffsForYou.length) {
          lines.push(`${res.handoffsForYou.length} agent(s) waiting on files you hold — release them or reply:`);
          for (const h of res.handoffsForYou) lines.push(renderHandoffLine(h, me));
        }
        const myApprovals = res.pendingApprovals.filter((a) => a.requestedBy === me);
        if (res.changed && myApprovals.length) {
          lines.push("Your approval requests still awaiting the human:");
          for (const a of myApprovals) lines.push(renderApprovalLine(a));
        }

        const addressed = res.newMessages.filter((m) => m.author !== me && mentionsYou(m, me));
        const sinceHint = `pass since: ${res.latestSeq} to your next wait_for_update`;
        if (!lines.length) {
          lines.push(`No new activity (latestSeq ${res.latestSeq}).`);
          lines.push(`Next: this is normal — call wait_for_update again (${sinceHint}).`);
        } else {
          lines.push(`latestSeq ${res.latestSeq}.`);
          if (status === "closed") {
            lines.push("Next: stop; the room is over.");
          } else if (res.approvalDecisions.length) {
            lines.push(`Next: act on the approval decision(s) above exactly as stated, then ${sinceHint}.`);
          } else if (addressed.length) {
            lines.push(
              `Next: you were addressed (${addressed.map((m) => `#${m.seq}`).join(", ")}) — act on it or reply via send_message (replyToSeq), then ${sinceHint}.`
            );
          } else {
            lines.push(`Next: act on anything relevant, then ${sinceHint}.`);
          }
        }
        return ok(lines.join("\n"), res);
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
        "Acquire an advisory lease on one or more glob paths BEFORE you edit them. Exclusive (default) blocks others; shared allows other shared holders. All-or-nothing. If another agent holds an overlapping exclusive lease, your claim is PREVENTED (visible to the room) and you must not edit those files. Use check_files first for a silent peek.",
      inputSchema: ClaimFilesInput.shape,
      annotations: hints({}),
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const res = engine.claimFiles(caller, args);
        if (res.granted) {
          const expiresAt = res.leases[0]?.expiresAt;
          const ttl = expiresAt ? ` for ~${minutesUntil(expiresAt)}m` : "";
          return ok(
            `Granted ${res.leases.length} lease(s)${ttl}: ${res.leases.map((l) => l.pathPattern).join(", ")}.\n` +
              "Next: make your edits, then release_files when done — releasing submits your diff for the human's review and frees the files for others. " +
              "Call renew_files if you need longer.",
            res
          );
        }
        // Per-conflict holder + staleness (deduped: a holder may match via several leases).
        const peek = engine.checkFiles(caller, [...new Set(res.conflicts.map((c) => c.path))]);
        const seen = new Set<string>();
        const conflictLines: string[] = [];
        for (const c of res.conflicts) {
          const key = `${c.path}|${c.heldBy}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const p = peek.find((x) => x.path === c.path && x.heldBy === c.heldBy);
          const stale = p ? staleNote(p.heldByLastSeen ?? 0, p.heldByListening ?? false) : "";
          conflictLines.push(`  • ${c.path} — held by ${c.heldByName}${c.exclusive ? " [exclusive]" : " [shared]"}${stale}`);
        }
        const firstPath = res.conflicts[0]?.path ?? args.paths[0];
        return ok(
          `PREVENTED — do NOT edit these. Nothing was claimed. Conflicts:\n${conflictLines.join("\n")}\n` +
            "Bothread has already routed a hand-off request to the holder(s); you'll be notified in wait_for_update when it's free.\n" +
            `Next: call request_handoff({ path: "${firstPath}", message: "<why you need it>" }) to explain, or pick other work — then wait_for_update. ` +
            "Tip: check_files is the silent way to peek before claiming.",
          res
        );
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
      annotations: hints({ readOnly: true, idempotent: true }),
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const res = engine.checkFiles(caller, args.paths);
        const summary = res
          .map((r) =>
            r.held
              ? `${r.path}: held by ${r.heldBy === caller.participant.id ? "you" : r.heldByName} (${r.exclusive ? "exclusive" : "shared"})${staleNote(r.heldByLastSeen ?? 0, r.heldByListening ?? false)}.`
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
      description:
        "Release leases you hold (by path or leaseId, or all of yours if both are omitted) so others can work on them. Releasing also submits your changes to those files for the human's diff review and notifies anyone waiting on them.",
      inputSchema: ReleaseFilesInput.shape,
      annotations: hints({ idempotent: true }),
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const res = engine.releaseFiles(caller, args);
        const tail =
          res.released > 0
            ? " Your changes are queued for the human's review; anyone waiting on these files was notified."
            : " You held no matching leases — paths must match what you claimed exactly (see 'You hold:' in get_room_state), or omit both to release all.";
        return ok(`Released ${res.released} lease(s).${tail}`, res);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "renew_files",
    {
      title: "Renew file claims",
      description:
        "Extend the TTL on leases you hold so they don't expire while you're still working. Omit paths and leaseIds to renew all of yours.",
      inputSchema: RenewFilesInput.shape,
      annotations: hints({ idempotent: true }),
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const res = engine.renewFiles(caller, args);
        const tail =
          res.renewed > 0
            ? ""
            : " You held no matching leases — claim_files first (paths must match what you claimed exactly).";
        return ok(`Renewed ${res.renewed} lease(s).${tail}`, res);
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
      annotations: hints({ idempotent: true }),
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const res = engine.requestHandoff(caller, args);
        return ok(
          res.routed
            ? `Requested ${args.path} from ${res.holder}. They've been notified.\nNext: work on something else and wait_for_update — you'll hear when it's free, then claim_files it.`
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
        "Cancel a request_handoff you made yourself if you no longer need the file (e.g. you found another way, or the task changed). Only cancels YOUR pending requests; ids are shown under 'Open hand-off requests' in get_room_state.",
      inputSchema: CancelHandoffInput.shape,
      annotations: hints({ idempotent: true }),
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
"Add a task to the room's shared task board (task → owner → status) so the team doesn't have to reconstruct 'who owns what' from chat. Set claim:true to take it yourself immediately. Pass blockedBy (task ids) when it can't start until other tasks are done — claim_next_task skips it until then. Everyone sees the board in get_room_state.",
      inputSchema: CreateTaskInput.shape,
      annotations: hints({}),
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const task = engine.createTask(caller, args);
        const left = blockersLeft(task, engine.listTasks(caller.room.id));
        const blocked = left.length
          ? ` It's blocked by ${left.join(", ")} — claim_next_task will skip it until those are done or cancelled.`
          : "";
        const heads = left.length && task.ownerName ? `\nheads-up: you claimed it but it's still blocked by ${left.join(", ")}.` : "";
        return ok(
          `Task added (${task.id})${task.ownerName ? ` and claimed by ${task.ownerName}` : ""}. Use update_task({ taskId: "${task.id}", … }) to change it.${blocked}${heads}`,
          task
        );
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
        "Update a task's status (open/in_progress/done/cancelled), set its note, take ownership, or replace its blockedBy list ([] clears it). Use this instead of narrating status in chat — it's a non-locking way to signal 'I'm on this' without claiming any files. Marking a task done announces any tasks it was blocking that are now ready. Task ids are shown on the task board in get_room_state.",
      inputSchema: UpdateTaskInput.shape,
      annotations: hints({ idempotent: true }),
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const task = engine.updateTask(caller, args);
        const left = blockersLeft(task, engine.listTasks(caller.room.id));
        let summary = `Task "${task.title}" (${task.id}) updated: [${task.status}]${task.ownerName ? ` — ${task.ownerName}` : ""}.`;
        if (left.length) {
          summary += ` Blocked by ${left.join(", ")}.`;
          if (task.status === "in_progress" && (args.takeOwnership || args.status === "in_progress")) {
            summary += `\nheads-up: still blocked by ${left.join(", ")} — make sure that work is really done (or coordinate via send_message) before building on it.`;
          }
        } else if (args.blockedBy !== undefined) {
          summary += args.blockedBy.length ? " Its blockers are all resolved — it's ready." : " Blockers cleared.";
        }
        return ok(summary, task);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "claim_next_task",
    {
      title: "Take the next ready task",
      description:
        "Atomically take the oldest open, unassigned task that isn't blocked (every task in its blockedBy is done or cancelled): you become its owner and it moves to in_progress. Two agents calling this at once never get the same task — use it instead of picking from the board by hand to avoid duplicated work.",
      inputSchema: ClaimNextTaskInput.shape,
      annotations: hints({}),
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const { task, blockedCount } = engine.claimNextTask(caller);
        if (!task) {
          const waiting = blockedCount
            ? ` (${blockedCount} open task${blockedCount !== 1 ? "s are" : " is"} waiting on blockers)`
            : "";
          return ok(
            `No unblocked open tasks right now${waiting}.\n` +
              "Next: if you see work that needs doing, create_task it (claim: true to take it); otherwise call wait_for_update — new tasks and \"is unblocked\" notices show up there.",
            { task: null, blockedCount }
          );
        }
        const note = task.note ? `\nNote: ${task.note}` : "";
        return ok(
          `You took "${task.title}" (${task.id}) — now in progress.${note}\n` +
            `Next: claim_files for what it touches, do the work, then update_task({ taskId: "${task.id}", status: "done" }).`,
          { task, blockedCount }
        );
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
        "Ask the human overseer to approve a risky action (delete, deploy, shell, git push, …) BEFORE you do it. Waits up to ~45s for the decision and returns approved / rejected / edited (with an instruction to follow instead). If the human hasn't decided by then it returns 'pending' with an approvalId — don't do the action; call request_approval({ approvalId }) to keep waiting, or keep working and watch wait_for_update. Required for any action in the room's requireApprovalFor list, or when the human asks.",
      inputSchema: RequestApprovalInput.shape,
      annotations: hints({}),
    },
    async (args) => {
      try {
        const caller = engine.resolveCaller(conn.sessionId, args.sessionId);
        const decision = await engine.requestApproval(caller, args);
        if (decision.status === "pending") {
          const id = decision.approvalId ?? args.approvalId ?? "";
          return ok(
            `Still pending — the human hasn't decided on approval ${id} yet.\n` +
              `Next: The human hasn't decided yet. Don't do the action. Call request_approval({ approvalId: "${id}" }) to keep waiting, ` +
              "or keep working on something else and call wait_for_update — the decision will show up there.",
            decision
          );
        }
        let next: string;
        if (decision.status === "approved") {
          next = "Next: go ahead with exactly what you described — nothing more.";
        } else if (decision.status === "rejected") {
          next =
            "Next: do NOT do it. Acknowledge via send_message and pick a different approach, or ask the human what they'd prefer.";
        } else if (decision.status === "edited") {
          next = `Next: do NOT do what you originally asked. Do this instead: ${decision.editedInstruction ?? "(see the human's instruction)"}`;
        } else {
          next = "Next: don't proceed until the human decides.";
        }
        const tail = decision.editedInstruction && decision.status !== "edited" ? ` Instruction: ${decision.editedInstruction}` : "";
        return ok(`The overseer ${decision.status} your request.${tail}\n${next}`, decision);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "leave_session",
    {
      title: "Leave the room",
      description:
        "Release all your file claims and leave the room. Only call this when the human explicitly says to stop or the room is closed — not just because your step is done (use wait_for_update for that).",
      inputSchema: LeaveSessionInput.shape,
      annotations: hints({ destructive: true, idempotent: true }),
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
      annotations: hints({}),
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
        "Mark a previously recorded decision/issue/verification note as resolved, optionally appending what was done about it. Note ids are shown under 'Notes' in get_room_state.",
      inputSchema: ResolveNoteInput.shape,
      annotations: hints({}),
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
