import type {
  AgentBranch,
  Approval,
  ApprovalResult,
  ApprovalStatus,
  ClaimFilesInput,
  ClaimResult,
  Handoff,
  HandoffView,
  Importance,
  Lease,
  LeaseConflict,
  Message,
  Participant,
  ParticipantStatus,
  ParticipantView,
  ReadMessagesInput,
  RiskAction,
  Room,
  RoomSettings,
  RoomSnapshot,
  ThreadEntry,
  WaitForUpdateResult,
} from "@bothread/shared";
import { ETIQUETTE, RECENT_THREAD_LIMIT, SNAPSHOT_THREAD_LIMIT, RoomSettings as RoomSettingsSchema } from "@bothread/shared";
import {
  applySelectedHunks,
  commitToCurrentBranch,
  createBranchCommit,
  currentSha,
  deleteTrackingBranch,
  diffWorkingTree,
  isGitRepo,
  restoreFilesToSha,
  sanitizeBranchSegment,
  snapshotPaths,
} from "./git";
import { buildPatch, listHunks } from "./diffHunks";
import type { DB } from "../db/database";
import type { RoomBus } from "../realtime";
import { BothreadError } from "./errors";
import { newId, newSessionId } from "./ids";
import { globsOverlap, leasesConflict } from "./leases";

/* ----- Raw row shapes ----- */
interface RoomRow {
  id: string;
  name: string;
  project_path: string | null;
  session_id: string;
  status: string;
  created_at: number;
  settings: string;
}
interface PartRow {
  id: string;
  room_id: string;
  name: string;
  brand: string | null;
  kind: string;
  status: string;
  capabilities: string | null;
  mcp_session_id: string | null;
  joined_at: number;
  last_seen_at: number;
}
interface MsgRow {
  id: string;
  room_id: string;
  seq: number;
  author_id: string;
  author_name: string;
  kind: string;
  importance: string;
  text: string;
  mentions: string;
  thread_id: string | null;
  created_at: number;
}
interface LeaseRow {
  id: string;
  room_id: string;
  participant_id: string;
  participant_name: string;
  path_pattern: string;
  exclusive: number;
  reason: string | null;
  status: string;
  created_at: number;
  expires_at: number;
  released_at: number | null;
}
interface ApprovalRow {
  id: string;
  room_id: string;
  requested_by_id: string;
  requested_by_name: string;
  action: string;
  details: string;
  files: string | null;
  status: string;
  decided_by: string | null;
  edited_instruction: string | null;
  created_at: number;
  decided_at: number | null;
}
interface BranchRow {
  id: string;
  room_id: string;
  participant_id: string;
  participant_name: string;
  branch_name: string;
  base_sha: string;
  base_tree: string | null;
  paths: string;
  diff: string | null;
  commit_sha: string | null;
  status: string;
  created_at: number;
  finalized_at: number | null;
}
interface HandoffRow {
  id: string;
  room_id: string;
  requester_id: string;
  requester_name: string;
  holder_id: string;
  holder_name: string;
  path: string;
  message: string | null;
  status: string;
  created_at: number;
  resolved_at: number | null;
}

export interface Caller {
  room: Room;
  participant: Participant;
}

export interface CreateRoomOptions {
  name: string;
  projectPath?: string;
  settings?: Partial<RoomSettings>;
  overseerName?: string;
}

const now = (): number => Date.now();

/**
 * The coordination engine — the framework-agnostic heart of Bothread.
 * Owns all state mutation, keeps it atomic (synchronous better-sqlite3, with an
 * IMMEDIATE-style transaction for the race-critical lease grant), writes the
 * append-only audit log, and publishes events for the UI + agent long-polls.
 */
export class Engine {
  private db: DB;
  private bus: RoomBus;

  /** Pending blocking approvals: approvalId -> resolver. */
  private approvalWaiters = new Map<string, (r: ApprovalResult) => void>();

  /** Participants currently parked in wait_for_update (actively listening). */
  private parkedWaiters = new Set<string>();
  /** Last time each participant entered wait_for_update — smooths the "listening" flag across poll cycles. */
  private lastWaitAt = new Map<string, number>();

  constructor(db: DB, bus: RoomBus) {
    this.db = db;
    this.bus = bus;
  }

  /* ===================== Sequencing + audit ===================== */

  private nextSeq(roomId: string, name: "msg" | "audit"): number {
    const row = this.db
      .prepare(
        `INSERT INTO counters (room_id, name, value) VALUES (?, ?, 1)
         ON CONFLICT(room_id, name) DO UPDATE SET value = value + 1
         RETURNING value`
      )
      .get(roomId, name) as { value: number };
    return row.value;
  }

  private audit(
    roomId: string,
    type: string,
    actor?: { id?: string; name?: string },
    payload?: Record<string, unknown>
  ): void {
    const seq = this.nextSeq(roomId, "audit");
    const ts = now();
    const id = newId("aud");
    this.db
      .prepare(
        `INSERT INTO audit (id, room_id, seq, ts, actor_id, actor_name, type, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, roomId, seq, ts, actor?.id ?? null, actor?.name ?? null, type, payload ? JSON.stringify(payload) : null);
    this.publish(roomId, "audit", { id, seq, ts, type, actorName: actor?.name, payload });
  }

  private publish(roomId: string, type: import("@bothread/shared").ServerEventType, data: unknown, seq?: number): void {
    this.bus.publish({ type, roomId, seq, data, ts: now() });
  }

  /* ===================== Mappers ===================== */

  private mapRoom(r: RoomRow): Room {
    return {
      id: r.id,
      name: r.name,
      projectPath: r.project_path ?? undefined,
      status: r.status as Room["status"],
      createdAt: r.created_at,
      settings: JSON.parse(r.settings) as RoomSettings,
    };
  }
  private mapParticipant(p: PartRow): Participant {
    return {
      id: p.id,
      roomId: p.room_id,
      name: p.name,
      brand: p.brand ?? undefined,
      kind: p.kind as Participant["kind"],
      status: p.status as ParticipantStatus,
      capabilities: p.capabilities ? (JSON.parse(p.capabilities) as string[]) : undefined,
      mcpSessionId: p.mcp_session_id ?? undefined,
      joinedAt: p.joined_at,
      lastSeenAt: p.last_seen_at,
    };
  }
  private mapMessage(m: MsgRow): Message {
    return {
      id: m.id,
      roomId: m.room_id,
      seq: m.seq,
      authorId: m.author_id,
      authorName: m.author_name,
      kind: m.kind as Message["kind"],
      importance: m.importance as Importance,
      text: m.text,
      mentions: JSON.parse(m.mentions) as string[],
      threadId: m.thread_id ?? undefined,
      createdAt: m.created_at,
    };
  }
  private mapLease(l: LeaseRow): Lease {
    return {
      id: l.id,
      roomId: l.room_id,
      participantId: l.participant_id,
      participantName: l.participant_name,
      pathPattern: l.path_pattern,
      exclusive: !!l.exclusive,
      reason: l.reason ?? undefined,
      status: l.status as Lease["status"],
      createdAt: l.created_at,
      expiresAt: l.expires_at,
      releasedAt: l.released_at ?? undefined,
    };
  }
  private mapApproval(a: ApprovalRow): Approval {
    return {
      id: a.id,
      roomId: a.room_id,
      requestedById: a.requested_by_id,
      requestedByName: a.requested_by_name,
      action: a.action as RiskAction,
      details: a.details,
      files: a.files ? (JSON.parse(a.files) as string[]) : undefined,
      status: a.status as ApprovalStatus,
      decidedBy: a.decided_by ?? undefined,
      editedInstruction: a.edited_instruction ?? undefined,
      createdAt: a.created_at,
      decidedAt: a.decided_at ?? undefined,
    };
  }
  private mapBranch(b: BranchRow): AgentBranch {
    return {
      id: b.id,
      roomId: b.room_id,
      participantId: b.participant_id,
      participantName: b.participant_name,
      branchName: b.branch_name,
      baseSha: b.base_sha,
      paths: JSON.parse(b.paths) as string[],
      diff: b.diff ?? undefined,
      hunks: b.diff ? listHunks(b.diff) : undefined,
      commitSha: b.commit_sha ?? undefined,
      status: b.status as AgentBranch["status"],
      createdAt: b.created_at,
      finalizedAt: b.finalized_at ?? undefined,
    };
  }
  private mapHandoff(h: HandoffRow): Handoff {
    return {
      id: h.id,
      roomId: h.room_id,
      requesterId: h.requester_id,
      requesterName: h.requester_name,
      holderId: h.holder_id,
      holderName: h.holder_name,
      path: h.path,
      message: h.message ?? undefined,
      status: h.status as Handoff["status"],
      createdAt: h.created_at,
      resolvedAt: h.resolved_at ?? undefined,
    };
  }

  /* ===================== Rooms ===================== */

  createRoom(opts: CreateRoomOptions): { room: Room; sessionId: string } {
    const id = newId("room");
    const sessionId = newSessionId();
    const settings = RoomSettingsSchema.parse(opts.settings ?? {});
    const createdAt = now();
    this.db
      .prepare(
        `INSERT INTO rooms (id, name, project_path, session_id, status, created_at, settings)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(id, opts.name, opts.projectPath ?? null, sessionId, createdAt, JSON.stringify(settings));

    // Every room has a human overseer participant (the person at the UI).
    const overseerId = newId("part");
    this.db
      .prepare(
        `INSERT INTO participants (id, room_id, name, brand, kind, status, capabilities, mcp_session_id, joined_at, last_seen_at)
         VALUES (?, ?, ?, NULL, 'human', 'active', NULL, NULL, ?, ?)`
      )
      .run(overseerId, id, opts.overseerName ?? "You", createdAt, createdAt);

    const room = this.mapRoom(this.roomRow(id)!);
    this.audit(id, "room.create", { id: overseerId, name: opts.overseerName ?? "You" }, { name: opts.name });
    this.publish(id, "room", { room });
    return { room, sessionId };
  }

  private roomRow(id: string): RoomRow | undefined {
    return this.db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(id) as RoomRow | undefined;
  }
  private roomRowBySession(sessionId: string): RoomRow | undefined {
    return this.db.prepare(`SELECT * FROM rooms WHERE session_id = ?`).get(sessionId) as RoomRow | undefined;
  }

  getRoom(id: string): Room | undefined {
    const r = this.roomRow(id);
    return r ? this.mapRoom(r) : undefined;
  }
  /** The room's secret session id — only for the UI to reveal to the human. */
  getRoomSessionId(id: string): string | undefined {
    return this.roomRow(id)?.session_id;
  }
  listRooms(): Room[] {
    return (this.db.prepare(`SELECT * FROM rooms ORDER BY created_at DESC`).all() as RoomRow[]).map((r) =>
      this.mapRoom(r)
    );
  }

  setRoomStatus(roomId: string, status: Room["status"], by = "You"): Room {
    const r = this.roomRow(roomId);
    if (!r) throw new BothreadError("no_room", "Room not found.");
    this.db.prepare(`UPDATE rooms SET status = ? WHERE id = ?`).run(status, roomId);
    const room = this.mapRoom(this.roomRow(roomId)!);
    this.audit(roomId, `room.${status}`, { name: by });
    this.postSystemMessage(
      roomId,
      status === "paused"
        ? "Room paused by the overseer. Agents must wait."
        : status === "active"
          ? "Room resumed by the overseer."
          : "Room closed by the overseer.",
      status === "active" ? "info" : "steering"
    );
    this.publish(roomId, "room", { room });
    return room;
  }

  /* ===================== Participants ===================== */

  private partRow(id: string): PartRow | undefined {
    return this.db.prepare(`SELECT * FROM participants WHERE id = ?`).get(id) as PartRow | undefined;
  }
  private partRowByMcp(mcpSessionId: string): PartRow | undefined {
    return this.db
      .prepare(`SELECT * FROM participants WHERE mcp_session_id = ? ORDER BY last_seen_at DESC LIMIT 1`)
      .get(mcpSessionId) as PartRow | undefined;
  }
  private partRows(roomId: string): PartRow[] {
    return this.db
      .prepare(`SELECT * FROM participants WHERE room_id = ? ORDER BY joined_at ASC`)
      .all(roomId) as PartRow[];
  }

  listParticipants(roomId: string): Participant[] {
    return this.partRows(roomId).map((p) => this.mapParticipant(p));
  }

  getOverseer(roomId: string): Participant | undefined {
    const row = this.db
      .prepare(`SELECT * FROM participants WHERE room_id = ? AND kind = 'human' ORDER BY joined_at ASC LIMIT 1`)
      .get(roomId) as PartRow | undefined;
    return row ? this.mapParticipant(row) : undefined;
  }

  /**
   * Bind an MCP connection to a room membership. Creates a new participant
   * (or reuses the one already bound to this connection in this room).
   */
  joinSession(
    mcpSessionId: string | undefined,
    input: { sessionId: string; agentName: string; brand?: string; capabilities?: string[] }
  ): { participant: Participant; snapshot: RoomSnapshot } {
    const roomRow = this.roomRowBySession(input.sessionId);
    if (!roomRow) {
      throw new BothreadError("bad_session", "No room matches that session ID. Ask the human to re-share it.");
    }
    if (roomRow.status === "closed") {
      throw new BothreadError("closed", "That room is closed.");
    }

    const ts = now();
    let part = mcpSessionId ? this.partRowByMcp(mcpSessionId) : undefined;

    if (part && part.room_id === roomRow.id) {
      // Re-join on the same connection: refresh identity, mark active.
      this.db
        .prepare(
          `UPDATE participants SET name = ?, brand = ?, capabilities = ?, status = 'active', last_seen_at = ?
           WHERE id = ?`
        )
        .run(input.agentName, input.brand ?? null, input.capabilities ? JSON.stringify(input.capabilities) : null, ts, part.id);
    } else {
      // If this connection was bound elsewhere, unbind it first.
      if (part && mcpSessionId) {
        this.db.prepare(`UPDATE participants SET mcp_session_id = NULL WHERE id = ?`).run(part.id);
      }
      const id = newId("part");
      this.db
        .prepare(
          `INSERT INTO participants (id, room_id, name, brand, kind, status, capabilities, mcp_session_id, joined_at, last_seen_at)
           VALUES (?, ?, ?, ?, 'agent', 'active', ?, ?, ?, ?)`
        )
        .run(
          id,
          roomRow.id,
          input.agentName,
          input.brand ?? null,
          input.capabilities ? JSON.stringify(input.capabilities) : null,
          mcpSessionId ?? null,
          ts,
          ts
        );
      part = this.partRow(id)!;
    }

    const participant = this.mapParticipant(part);
    const room = this.mapRoom(roomRow);
    this.audit(room.id, "participant.join", { id: participant.id, name: participant.name }, { brand: participant.brand });
    this.postSystemMessage(room.id, `${participant.name} joined the room.`, "info");
    this.publish(room.id, "participant", { participant });
    return { participant, snapshot: this.buildSnapshot(room, participant) };
  }

  /** Resolve + validate the caller for a room-scoped tool. */
  resolveCaller(mcpSessionId: string | undefined, roomSessionArg?: string): Caller {
    const part = mcpSessionId ? this.partRowByMcp(mcpSessionId) : undefined;
    if (!part) {
      throw new BothreadError(
        "not_joined",
        "You haven't joined a room yet. Call join_session with the session ID the human gave you."
      );
    }
    const roomRow = this.roomRow(part.room_id);
    if (!roomRow) throw new BothreadError("no_room", "Your room no longer exists.");
    if (roomSessionArg && roomRow.session_id !== roomSessionArg) {
      throw new BothreadError("bad_session", "That session ID doesn't match the room you're in.");
    }
    if (part.status === "revoked") {
      throw new BothreadError("revoked", "Your access to this room was revoked by the human overseer.");
    }
    if (part.status === "left") {
      throw new BothreadError("left", "You have left this room. Call join_session to re-join.");
    }
    // Touch presence.
    this.db.prepare(`UPDATE participants SET last_seen_at = ? WHERE id = ?`).run(now(), part.id);
    return { room: this.mapRoom(roomRow), participant: this.mapParticipant(part) };
  }

  setParticipantStatus(roomId: string, participantId: string, status: ParticipantStatus, by = "You"): Participant {
    const p = this.partRow(participantId);
    if (!p || p.room_id !== roomId) throw new BothreadError("no_participant", "Participant not found.");
    // Revoking clears the MCP binding so the next call from that connection fails resolution too.
    if (status === "revoked") {
      this.db.prepare(`UPDATE participants SET status = 'revoked' WHERE id = ?`).run(participantId);
      this.releaseAllFor(roomId, participantId, "revoked");
    } else {
      this.db.prepare(`UPDATE participants SET status = ? WHERE id = ?`).run(status, participantId);
    }
    const participant = this.mapParticipant(this.partRow(participantId)!);
    this.audit(roomId, `participant.${status}`, { name: by }, { participant: participant.name });
    this.postSystemMessage(
      roomId,
      `${participant.name} was ${status === "active" ? "un-muted" : status} by the overseer.`,
      "steering"
    );
    this.publish(roomId, "participant", { participant });
    return participant;
  }

  /**
   * Nudge a (possibly stopped) agent: post a high-priority @mention from the
   * overseer asking it to check the room and continue. For an agent that's
   * listening (parked in wait_for_update) this lands instantly; for one that has
   * fully stopped its turn it sits as a directed prompt for when its host runs it
   * again — Bothread can't start another agent's turn, only flag that it should.
   */
  nudgeParticipant(roomId: string, participantId: string, by = "You"): { listening: boolean } {
    const p = this.partRow(participantId);
    if (!p || p.room_id !== roomId) throw new BothreadError("no_participant", "Participant not found.");
    const listening = this.isListening(participantId);
    this.overseerMessage(
      roomId,
      `@${p.name} — please run get_room_state and continue; the overseer is nudging you.`,
      "interrupt",
      [p.name]
    );
    this.audit(roomId, "participant.nudge", { name: by }, { participant: p.name, wasListening: listening });
    return { listening };
  }

  /* ===================== Messages ===================== */

  private insertMessage(
    roomId: string,
    author: { id: string; name: string },
    kind: Message["kind"],
    importance: Importance,
    text: string,
    mentions: string[] = [],
    threadId?: string
  ): Message {
    const seq = this.nextSeq(roomId, "msg");
    const id = newId("msg");
    const createdAt = now();
    this.db
      .prepare(
        `INSERT INTO messages (id, room_id, seq, author_id, author_name, kind, importance, text, mentions, thread_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, roomId, seq, author.id, author.name, kind, importance, text, JSON.stringify(mentions), threadId ?? null, createdAt);
    const msg: Message = {
      id,
      roomId,
      seq,
      authorId: author.id,
      authorName: author.name,
      kind,
      importance,
      text,
      mentions,
      threadId,
      createdAt,
    };
    this.publish(roomId, "message", { message: msg }, seq);
    return msg;
  }

  postSystemMessage(roomId: string, text: string, importance: Importance = "info"): Message {
    return this.insertMessage(roomId, { id: "system", name: "Bothread" }, "system", importance, text);
  }

  sendMessage(
    caller: Caller,
    input: { text: string; mentions?: string[]; threadId?: string; importance?: Importance }
  ): Message {
    this.assertWritable(caller);
    const importance = input.importance ?? "info";
    const msg = this.insertMessage(
      caller.room.id,
      { id: caller.participant.id, name: caller.participant.name },
      caller.participant.kind === "human" ? "human" : "agent",
      importance,
      input.text,
      input.mentions ?? [],
      input.threadId
    );
    this.audit(caller.room.id, "message.send", { id: caller.participant.id, name: caller.participant.name }, {
      seq: msg.seq,
      mentions: msg.mentions,
    });
    return msg;
  }

  /** Privileged overseer message — bypasses pause/mute, high importance. */
  overseerMessage(roomId: string, text: string, importance: Importance = "steering", mentions: string[] = []): Message {
    const overseer = this.getOverseer(roomId);
    const author = overseer
      ? { id: overseer.id, name: overseer.name }
      : { id: "overseer", name: "You" };
    const msg = this.insertMessage(roomId, author, "human", importance, text, mentions);
    this.audit(roomId, "message.overseer", author, { seq: msg.seq });
    return msg;
  }

  private msgRows(roomId: string, since?: number, limit = RECENT_THREAD_LIMIT): MsgRow[] {
    if (since !== undefined) {
      return this.db
        .prepare(`SELECT * FROM messages WHERE room_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`)
        .all(roomId, since, limit) as MsgRow[];
    }
    // Most recent `limit`, returned in chronological order.
    const rows = this.db
      .prepare(`SELECT * FROM messages WHERE room_id = ? ORDER BY seq DESC LIMIT ?`)
      .all(roomId, limit) as MsgRow[];
    return rows.reverse();
  }

  readMessages(caller: Caller, input: ReadMessagesInput): { messages: ThreadEntry[]; latestSeq: number } {
    const limit = input.limit ?? RECENT_THREAD_LIMIT;
    let rows = this.msgRows(caller.room.id, input.since, limit);
    if (input.mentionsMe) {
      rows = rows.filter((r) => (JSON.parse(r.mentions) as string[]).includes(caller.participant.name));
    }
    return {
      messages: rows.map((r) => this.toThreadEntry(this.mapMessage(r))),
      latestSeq: this.latestSeq(caller.room.id),
    };
  }

  async waitForUpdate(
    caller: Caller,
    input: { maxWaitMs?: number; since?: number }
  ): Promise<WaitForUpdateResult> {
    const roomId = caller.room.id;
    const since = input.since ?? this.latestSeq(roomId);
    const maxWaitMs = input.maxWaitMs ?? 25000;
    const me = caller.participant.id;

    const build = (): WaitForUpdateResult => {
      const latestSeq = this.latestSeq(roomId);
      const newMessages = this.msgRows(roomId, since).map((r) => this.toThreadEntry(this.mapMessage(r)));
      const handoffsForYou = this.pendingHandoffs(roomId)
        .filter((h) => h.holderId === me)
        .map((h) => ({ id: h.id, path: h.path, requestedBy: h.requesterName, heldBy: h.holderName, message: h.message }));
      return {
        changed: latestSeq > since || handoffsForYou.length > 0,
        latestSeq,
        newMessages,
        pendingApprovals: this.pendingApprovalViews(roomId),
        handoffsForYou,
      };
    };

    const immediate = build();
    if (immediate.changed) return immediate;

    // Mark this agent as actively listening for the duration of the long-poll.
    this.parkedWaiters.add(me);
    this.lastWaitAt.set(me, now());
    try {
      await this.bus.waitFor(
        roomId,
        (ev) =>
          ev.type === "message" ||
          ev.type === "approval" ||
          ev.type === "room" ||
          ev.type === "collision" ||
          ev.type === "handoff",
        maxWaitMs
      );
    } finally {
      this.parkedWaiters.delete(me);
    }
    return build();
  }

  /** Is this participant actively listening (parked in wait_for_update, or very recently)? */
  private isListening(participantId: string): boolean {
    if (this.parkedWaiters.has(participantId)) return true;
    const last = this.lastWaitAt.get(participantId);
    return last !== undefined && now() - last < 35_000;
  }

  private toThreadEntry(m: Message): ThreadEntry {
    return {
      seq: m.seq,
      author: m.authorName,
      kind: m.kind,
      importance: m.importance,
      text: m.text,
      mentions: m.mentions,
      at: m.createdAt,
    };
  }

  latestSeq(roomId: string): number {
    const row = this.db.prepare(`SELECT value FROM counters WHERE room_id = ? AND name = 'msg'`).get(roomId) as
      | { value: number }
      | undefined;
    return row?.value ?? 0;
  }

  /* ===================== Leases ===================== */

  private sweepExpiredTx(roomId: string, at: number): void {
    this.db
      .prepare(`UPDATE leases SET status = 'expired' WHERE room_id = ? AND status = 'active' AND expires_at <= ?`)
      .run(roomId, at);
  }
  private activeLeaseRows(roomId: string): LeaseRow[] {
    return this.db
      .prepare(`SELECT * FROM leases WHERE room_id = ? AND status = 'active' ORDER BY created_at ASC`)
      .all(roomId) as LeaseRow[];
  }

  activeLeases(roomId: string): Lease[] {
    const at = now();
    this.sweepExpiredTx(roomId, at);
    return this.activeLeaseRows(roomId).map((l) => this.mapLease(l));
  }

  /**
   * Atomically acquire advisory leases. Race-free: the sweep → conflict-check →
   * insert all run inside one synchronous transaction, so two agents can never
   * both win the same exclusive path (the TOCTOU bug we set out to avoid).
   * All-or-nothing: if ANY requested path conflicts, nothing is granted.
   */
  claimFiles(caller: Caller, input: ClaimFilesInput): ClaimResult {
    this.assertWritable(caller);
    const roomId = caller.room.id;
    const at = now();
    const exclusive = input.exclusive ?? true;
    const ttlMs = input.ttlSeconds ? input.ttlSeconds * 1000 : caller.room.settings.defaultLeaseTtlMs;
    const expiresAt = at + ttlMs;

    const tx = this.db.transaction((): ClaimResult => {
      this.sweepExpiredTx(roomId, at);
      const active = this.activeLeaseRows(roomId);
      const conflicts: LeaseConflict[] = [];
      for (const path of input.paths) {
        for (const ex of active) {
          if (
            leasesConflict(
              { participantId: ex.participant_id, pathPattern: ex.path_pattern, exclusive: !!ex.exclusive },
              { participantId: caller.participant.id, pathPattern: path, exclusive }
            )
          ) {
            conflicts.push({
              path,
              heldBy: ex.participant_id,
              heldByName: ex.participant_name,
              exclusive: !!ex.exclusive,
            });
          }
        }
      }
      if (conflicts.length > 0) {
        return { granted: false, leases: [], conflicts };
      }
      const leases: Lease[] = [];
      for (const path of input.paths) {
        const id = newId("lease");
        this.db
          .prepare(
            `INSERT INTO leases (id, room_id, participant_id, participant_name, path_pattern, exclusive, reason, status, created_at, expires_at, released_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)`
          )
          .run(id, roomId, caller.participant.id, caller.participant.name, path, exclusive ? 1 : 0, input.reason ?? null, at, expiresAt);
        leases.push({
          id,
          roomId,
          participantId: caller.participant.id,
          participantName: caller.participant.name,
          pathPattern: path,
          exclusive,
          reason: input.reason,
          status: "active",
          createdAt: at,
          expiresAt,
        });
      }
      return { granted: true, leases, conflicts: [] };
    });

    const result = tx();

    // Side effects after commit.
    if (result.granted) {
      this.audit(roomId, "lease.claim", { id: caller.participant.id, name: caller.participant.name }, {
        paths: input.paths,
        exclusive,
      });
      this.publish(roomId, "lease", { leases: this.activeLeases(roomId) });
      // Git micro-branching: record a tracking entry for this agent's claims.
      this.startGitTracking(caller.room, caller.participant, input.paths);
    } else {
      this.audit(roomId, "lease.collision", { id: caller.participant.id, name: caller.participant.name }, {
        conflicts: result.conflicts,
      });
      // The headline event: a collision was prevented, in front of the human.
      const heldBy = result.conflicts[0]?.heldByName ?? "another participant";
      const path = result.conflicts[0]?.path ?? input.paths[0];
      this.postSystemMessage(
        roomId,
        `Prevented: ${caller.participant.name} tried to claim ${path} — already held by ${heldBy}.`,
        "interrupt"
      );
      this.publish(roomId, "collision", {
        by: caller.participant.name,
        conflicts: result.conflicts,
      });
      // Hub-routed hand-off: instead of a dead-end, open a tracked request to the
      // holder and @-mention them, so the negotiation happens automatically.
      this.openHandoffsForConflicts(caller, result.conflicts);
    }
    return result;
  }

  releaseFiles(caller: Caller, input: { paths?: string[]; leaseIds?: string[] }): { released: number } {
    const roomId = caller.room.id;
    let released = 0;
    const at = now();
    if (input.leaseIds && input.leaseIds.length) {
      for (const id of input.leaseIds) {
        const r = this.db
          .prepare(
            `UPDATE leases SET status = 'released', released_at = ? WHERE id = ? AND room_id = ? AND participant_id = ? AND status = 'active'`
          )
          .run(at, id, roomId, caller.participant.id);
        released += r.changes;
      }
    } else if (input.paths && input.paths.length) {
      for (const path of input.paths) {
        const r = this.db
          .prepare(
            `UPDATE leases SET status = 'released', released_at = ? WHERE room_id = ? AND participant_id = ? AND status = 'active' AND path_pattern = ?`
          )
          .run(at, roomId, caller.participant.id, path);
        released += r.changes;
      }
    } else {
      released = this.releaseAllFor(roomId, caller.participant.id, "released");
    }
    if (released > 0) {
      this.audit(roomId, "lease.release", { id: caller.participant.id, name: caller.participant.name }, { released });
      this.publish(roomId, "lease", { leases: this.activeLeases(roomId) });
      // Finalize any open git tracking entries for this participant.
      this.finalizeGitTracking(caller.room, caller.participant);
      // Tell anyone waiting on a path this participant just freed that it's available.
      this.resolveHandoffsForHolder(roomId, caller.participant.id);
    }
    return { released };
  }

  private releaseAllFor(roomId: string, participantId: string, _reason: string): number {
    const r = this.db
      .prepare(
        `UPDATE leases SET status = 'released', released_at = ? WHERE room_id = ? AND participant_id = ? AND status = 'active'`
      )
      .run(now(), roomId, participantId);
    return r.changes;
  }

  renewFiles(caller: Caller, input: { paths?: string[]; leaseIds?: string[]; ttlSeconds?: number }): { renewed: number } {
    this.assertWritable(caller);
    const roomId = caller.room.id;
    const ttlMs = input.ttlSeconds ? input.ttlSeconds * 1000 : caller.room.settings.defaultLeaseTtlMs;
    const expiresAt = now() + ttlMs;
    let renewed = 0;
    const rows = this.activeLeaseRows(roomId).filter((l) => l.participant_id === caller.participant.id);
    for (const l of rows) {
      const match =
        (input.leaseIds && input.leaseIds.includes(l.id)) ||
        (input.paths && input.paths.includes(l.path_pattern)) ||
        (!input.leaseIds && !input.paths);
      if (match) {
        this.db.prepare(`UPDATE leases SET expires_at = ? WHERE id = ?`).run(expiresAt, l.id);
        renewed += 1;
      }
    }
    if (renewed > 0) {
      this.audit(roomId, "lease.renew", { id: caller.participant.id, name: caller.participant.name }, { renewed });
      this.publish(roomId, "lease", { leases: this.activeLeases(roomId) });
    }
    return { renewed };
  }

  /* ===================== Approvals (blocking) ===================== */

  requestApproval(
    caller: Caller,
    input: { action: RiskAction; details: string; files?: string[] }
  ): Promise<ApprovalResult> {
    this.assertWritable(caller);
    const roomId = caller.room.id;
    const id = newId("appr");
    const createdAt = now();
    this.db
      .prepare(
        `INSERT INTO approvals (id, room_id, requested_by_id, requested_by_name, action, details, files, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(id, roomId, caller.participant.id, caller.participant.name, input.action, input.details, input.files ? JSON.stringify(input.files) : null, createdAt);

    this.audit(roomId, "approval.request", { id: caller.participant.id, name: caller.participant.name }, {
      approvalId: id,
      action: input.action,
    });
    this.postSystemMessage(
      roomId,
      `${caller.participant.name} requests approval to ${input.action}: ${input.details}`,
      "interrupt"
    );
    this.publish(roomId, "approval", { approval: this.mapApproval(this.approvalRow(id)!) });

    return new Promise<ApprovalResult>((resolve) => {
      this.approvalWaiters.set(id, resolve);
    });
  }

  private approvalRow(id: string): ApprovalRow | undefined {
    return this.db.prepare(`SELECT * FROM approvals WHERE id = ?`).get(id) as ApprovalRow | undefined;
  }

  decideApproval(
    roomId: string,
    approvalId: string,
    decision: Exclude<ApprovalStatus, "pending">,
    decidedBy = "You",
    editedInstruction?: string
  ): Approval {
    const row = this.approvalRow(approvalId);
    if (!row || row.room_id !== roomId) throw new BothreadError("no_approval", "Approval not found.");
    if (row.status !== "pending") throw new BothreadError("already_decided", "That approval was already decided.");
    this.db
      .prepare(`UPDATE approvals SET status = ?, decided_by = ?, edited_instruction = ?, decided_at = ? WHERE id = ?`)
      .run(decision, decidedBy, editedInstruction ?? null, now(), approvalId);
    const approval = this.mapApproval(this.approvalRow(approvalId)!);

    this.audit(roomId, `approval.${decision}`, { name: decidedBy }, { approvalId });
    this.postSystemMessage(
      roomId,
      `Overseer ${decision} ${approval.requestedByName}'s request to ${approval.action}.` +
        (editedInstruction ? ` Instruction: ${editedInstruction}` : ""),
      "steering"
    );
    this.publish(roomId, "approval", { approval });

    const waiter = this.approvalWaiters.get(approvalId);
    if (waiter) {
      this.approvalWaiters.delete(approvalId);
      waiter({ status: decision, editedInstruction, decidedBy });
    }
    return approval;
  }

  pendingApprovals(roomId: string): Approval[] {
    return (
      this.db
        .prepare(`SELECT * FROM approvals WHERE room_id = ? AND status = 'pending' ORDER BY created_at ASC`)
        .all(roomId) as ApprovalRow[]
    ).map((a) => this.mapApproval(a));
  }
  private pendingApprovalViews(roomId: string) {
    return this.pendingApprovals(roomId).map((a) => ({
      id: a.id,
      action: a.action,
      details: a.details,
      requestedBy: a.requestedByName,
    }));
  }

  /* ===================== Hand-offs (routed file requests) ===================== */

  private handoffRow(id: string): HandoffRow | undefined {
    return this.db.prepare(`SELECT * FROM handoffs WHERE id = ?`).get(id) as HandoffRow | undefined;
  }

  /** The active holder of `path` (first overlapping active lease), if any. */
  private holderOfPath(roomId: string, path: string): { id: string; name: string } | undefined {
    for (const l of this.activeLeaseRows(roomId)) {
      if (globsOverlap(l.path_pattern, path) || globsOverlap(path, l.path_pattern)) {
        return { id: l.participant_id, name: l.participant_name };
      }
    }
    return undefined;
  }

  /**
   * Open a tracked hand-off request and @-mention the holder. De-duplicated:
   * one pending request per (requester, holder, path). Returns the Handoff or
   * undefined if it was a self-request or a duplicate.
   */
  private createHandoff(
    roomId: string,
    requester: { id: string; name: string },
    holder: { id: string; name: string },
    path: string,
    message?: string
  ): Handoff | undefined {
    if (requester.id === holder.id) return undefined;
    const dupe = this.db
      .prepare(
        `SELECT id FROM handoffs WHERE room_id = ? AND requester_id = ? AND holder_id = ? AND path = ? AND status = 'pending' LIMIT 1`
      )
      .get(roomId, requester.id, holder.id, path) as { id: string } | undefined;
    if (dupe) return this.mapHandoff(this.handoffRow(dupe.id)!);

    const id = newId("ho");
    const createdAt = now();
    this.db
      .prepare(
        `INSERT INTO handoffs (id, room_id, requester_id, requester_name, holder_id, holder_name, path, message, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(id, roomId, requester.id, requester.name, holder.id, holder.name, path, message ?? null, createdAt);

    this.audit(roomId, "handoff.request", { id: requester.id, name: requester.name }, { holder: holder.name, path });
    this.postSystemMessage(
      roomId,
      `@${holder.name} — ${requester.name} needs \`${path}\` (which you hold)${message ? `: "${message}"` : ""}. Release it when you can, or reply.`,
      "steering"
    );
    const handoff = this.mapHandoff(this.handoffRow(id)!);
    this.publish(roomId, "handoff", { handoff });
    return handoff;
  }

  private openHandoffsForConflicts(caller: Caller, conflicts: LeaseConflict[]): void {
    for (const c of conflicts) {
      this.createHandoff(
        caller.room.id,
        { id: caller.participant.id, name: caller.participant.name },
        { id: c.heldBy, name: c.heldByName },
        c.path
      );
    }
  }

  /** After `holderId` releases, notify any waiters whose path is now free. */
  private resolveHandoffsForHolder(roomId: string, holderId: string): void {
    const pending = this.db
      .prepare(`SELECT * FROM handoffs WHERE room_id = ? AND holder_id = ? AND status = 'pending'`)
      .all(roomId, holderId) as HandoffRow[];
    if (!pending.length) return;
    const at = now();
    for (const h of pending) {
      // Still blocked by someone else? Leave it pending.
      const stillHeld = this.holderOfPath(roomId, h.path);
      if (stillHeld) continue;
      this.db.prepare(`UPDATE handoffs SET status = 'released', resolved_at = ? WHERE id = ?`).run(at, h.id);
      this.postSystemMessage(
        roomId,
        `@${h.requester_name} — \`${h.path}\` is free now (released by ${h.holder_name}). You can claim it.`,
        "steering"
      );
      this.publish(roomId, "handoff", { handoff: this.mapHandoff(this.handoffRow(h.id)!) });
    }
  }

  /** Proactive hand-off: an agent asks for a path it knows someone holds. */
  requestHandoff(
    caller: Caller,
    input: { path: string; message?: string }
  ): { routed: boolean; holder?: string; reason?: string } {
    this.assertWritable(caller);
    const holder = this.holderOfPath(caller.room.id, input.path);
    if (!holder) {
      return { routed: false, reason: "No one is holding that path — you can claim it directly with claim_files." };
    }
    if (holder.id === caller.participant.id) {
      return { routed: false, reason: "You already hold that path." };
    }
    const handoff = this.createHandoff(
      caller.room.id,
      { id: caller.participant.id, name: caller.participant.name },
      holder,
      input.path,
      input.message
    );
    return { routed: true, holder: holder.name, reason: handoff ? undefined : "A request to that holder is already open." };
  }

  pendingHandoffs(roomId: string): Handoff[] {
    return (
      this.db
        .prepare(`SELECT * FROM handoffs WHERE room_id = ? AND status = 'pending' ORDER BY created_at ASC`)
        .all(roomId) as HandoffRow[]
    ).map((h) => this.mapHandoff(h));
  }

  private handoffViews(roomId: string): HandoffView[] {
    return this.pendingHandoffs(roomId).map((h) => ({
      id: h.id,
      path: h.path,
      requestedBy: h.requesterName,
      heldBy: h.holderName,
      message: h.message,
    }));
  }

  /** When a participant leaves/revoked, cancel hand-offs that name them. */
  private cancelHandoffsFor(roomId: string, participantId: string): void {
    this.db
      .prepare(
        `UPDATE handoffs SET status = 'cancelled', resolved_at = ? WHERE room_id = ? AND status = 'pending' AND (requester_id = ? OR holder_id = ?)`
      )
      .run(now(), roomId, participantId, participantId);
  }

  /* ===================== Leave ===================== */

  leaveSession(caller: Caller): void {
    const roomId = caller.room.id;
    this.releaseAllFor(roomId, caller.participant.id, "left");
    this.finalizeGitTracking(caller.room, caller.participant);
    // Their files are now free — notify waiters — then drop any of their own requests.
    this.resolveHandoffsForHolder(roomId, caller.participant.id);
    this.cancelHandoffsFor(roomId, caller.participant.id);
    this.db
      .prepare(`UPDATE participants SET status = 'left', mcp_session_id = NULL WHERE id = ?`)
      .run(caller.participant.id);
    this.audit(roomId, "participant.leave", { id: caller.participant.id, name: caller.participant.name });
    this.postSystemMessage(roomId, `${caller.participant.name} left the room.`, "info");
    this.publish(roomId, "participant", { participant: { ...caller.participant, status: "left" } });
  }

  /* ===================== Guards + snapshot ===================== */

  private assertWritable(caller: Caller): void {
    if (caller.room.status === "paused") {
      throw new BothreadError("paused", "The room is paused by the overseer. Wait until it resumes before acting.");
    }
    if (caller.room.status === "closed") {
      throw new BothreadError("closed", "The room is closed.");
    }
    if (caller.participant.status === "muted") {
      throw new BothreadError("muted", "You are muted by the overseer and cannot post or claim right now.");
    }
  }

  buildSnapshot(room: Room, self: Participant): RoomSnapshot {
    const at = now();
    this.sweepExpiredTx(room.id, at);
    const leases = this.activeLeaseRows(room.id).map((l) => this.mapLease(l));
    const byParticipant = new Map<string, string[]>();
    for (const l of leases) {
      const arr = byParticipant.get(l.participantId) ?? [];
      arr.push(l.pathPattern);
      byParticipant.set(l.participantId, arr);
    }
    const participants: ParticipantView[] = this.partRows(room.id)
      .filter((p) => p.status !== "left")
      .map((p) => ({
        id: p.id,
        name: p.name,
        brand: p.brand ?? undefined,
        kind: p.kind as Participant["kind"],
        status: p.status as ParticipantStatus,
        claimedFiles: byParticipant.get(p.id) ?? [],
        lastSeen: p.last_seen_at,
        listening: p.kind === "agent" && this.isListening(p.id),
      }));

    return {
      room: { name: room.name, status: room.status },
      you: {
        id: self.id,
        name: self.name,
        status: self.status,
        leases: byParticipant.get(self.id) ?? [],
      },
      participants,
      // Lean thread in the snapshot to save agent context; read_messages(since) pages further back.
      thread: this.msgRows(room.id, undefined, SNAPSHOT_THREAD_LIMIT).map((r) => this.toThreadEntry(this.mapMessage(r))),
      locks: leases.map((l) => ({
        path: l.pathPattern,
        heldBy: l.participantId,
        heldByName: l.participantName,
        exclusive: l.exclusive,
        expiresAt: l.expiresAt,
      })),
      pendingApprovals: this.pendingApprovalViews(room.id),
      handoffs: this.handoffViews(room.id),
      latestSeq: this.latestSeq(room.id),
      etiquette: ETIQUETTE,
    };
  }

  /** For the UI: a snapshot keyed by roomId from the overseer's vantage. */
  snapshotForOverseer(roomId: string): RoomSnapshot | undefined {
    const room = this.getRoom(roomId);
    if (!room) return undefined;
    const overseer = this.getOverseer(roomId) ?? {
      id: "overseer",
      roomId,
      name: "You",
      kind: "human" as const,
      status: "active" as const,
      joinedAt: now(),
      lastSeenAt: now(),
    };
    return this.buildSnapshot(room, overseer);
  }

  /** Reject any still-pending approvals (e.g. on shutdown). */
  drainApprovals(): void {
    for (const [, resolve] of this.approvalWaiters) {
      resolve({ status: "rejected", decidedBy: "system" });
    }
    this.approvalWaiters.clear();
  }

  /* ===================== Git micro-branching ===================== */

  /**
   * Called after a successful claimFiles: if the room has a projectPath that's a
   * git repo, upsert a 'tracking' branch entry for this participant (adding the
   * new paths to an existing entry if one already exists this session).
   */
  private startGitTracking(room: Room, participant: Participant, paths: string[]): void {
    if (!room.projectPath) return;
    try {
      if (!isGitRepo(room.projectPath)) return;
      const sha = currentSha(room.projectPath);
      if (!sha) return;

      // Look for an existing open tracking row for this participant.
      const existing = this.db
        .prepare(`SELECT * FROM branches WHERE room_id = ? AND participant_id = ? AND status = 'tracking' LIMIT 1`)
        .get(room.id, participant.id) as BranchRow | undefined;

      if (existing) {
        // Add the new paths, extending the baseline snapshot so already-claimed
        // paths keep their original claim-time baseline (don't reset their diff).
        const existingPaths = JSON.parse(existing.paths) as string[];
        const merged = Array.from(new Set([...existingPaths, ...paths]));
        const base = existing.base_tree ?? existing.base_sha;
        const newTree = snapshotPaths(room.projectPath, base, paths) ?? existing.base_tree;
        this.db
          .prepare(`UPDATE branches SET paths = ?, base_tree = ? WHERE id = ?`)
          .run(JSON.stringify(merged), newTree ?? null, existing.id);
      } else {
        // Snapshot the claimed paths' working-tree state NOW — this baseline
        // includes the human's own uncommitted edits, so diff/discard later are
        // scoped to the agent's changes and never clobber the human's work.
        const baseTree = snapshotPaths(room.projectPath, sha, paths) ?? null;
        const id = newId("br");
        const seg = sanitizeBranchSegment(participant.name);
        const branchName = `bothread/${seg}-${participant.id.slice(-6)}`;
        this.db
          .prepare(
            `INSERT INTO branches (id, room_id, participant_id, participant_name, branch_name, base_sha, base_tree, paths, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'tracking', ?)`
          )
          .run(id, room.id, participant.id, participant.name, branchName, sha, baseTree, JSON.stringify(paths), now());
      }
    } catch {
      /* git unavailable or not a repo — silently skip */
    }
  }

  /**
   * Called when files are released: finalize all open tracking entries for this
   * participant by capturing the diff and creating a tracking branch commit.
   */
  private finalizeGitTracking(room: Room, participant: Participant): void {
    if (!room.projectPath) return;
    const rows = this.db
      .prepare(`SELECT * FROM branches WHERE room_id = ? AND participant_id = ? AND status = 'tracking'`)
      .all(room.id, participant.id) as BranchRow[];
    if (!rows.length) return;

    const at = now();
    for (const row of rows) {
      try {
        const paths = JSON.parse(row.paths) as string[];
        // Diff against the claim-time snapshot (not HEAD): captures only what the
        // agent changed since claiming, leaving the human's pre-existing work out.
        const base = row.base_tree ?? row.base_sha;
        const diff = diffWorkingTree(room.projectPath, base, paths);
        const commitSha = diff
          ? createBranchCommit(
              room.projectPath,
              row.branch_name,
              row.base_sha,
              paths,
              `bothread: ${participant.name} — ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? " …" : ""}`
            )
          : undefined;

        this.db
          .prepare(
            `UPDATE branches SET diff = ?, commit_sha = ?, status = 'ready', finalized_at = ? WHERE id = ?`
          )
          .run(diff || null, commitSha ?? null, at, row.id);

        const updated = this.db.prepare(`SELECT * FROM branches WHERE id = ?`).get(row.id) as BranchRow;
        this.publish(room.id, "branch", { branch: this.mapBranch(updated) });
      } catch {
        /* best-effort */
      }
    }
  }

  /* ----- Public branch API (called by REST handlers) ----- */

  listBranches(roomId: string): AgentBranch[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM branches WHERE room_id = ? AND status IN ('tracking','ready') ORDER BY created_at DESC`
        )
        .all(roomId) as BranchRow[]
    ).map((b) => this.mapBranch(b));
  }

  listAllBranches(roomId: string): AgentBranch[] {
    return (
      this.db
        .prepare(`SELECT * FROM branches WHERE room_id = ? ORDER BY created_at DESC LIMIT 50`)
        .all(roomId) as BranchRow[]
    ).map((b) => this.mapBranch(b));
  }

  /**
   * Merge: stage and commit the agent's working-tree changes to git history,
   * then mark the branch as 'merged'.
   */
  mergeBranch(roomId: string, branchId: string, mergedBy = "You"): AgentBranch {
    const row = this.db.prepare(`SELECT * FROM branches WHERE id = ? AND room_id = ?`).get(branchId, roomId) as
      | BranchRow
      | undefined;
    if (!row) throw new BothreadError("no_branch", "Branch not found.");
    if (row.status !== "ready") throw new BothreadError("bad_state", "Branch is not ready to merge.");
    const room = this.getRoom(roomId);
    if (!room?.projectPath) throw new BothreadError("no_project", "Room has no project path.");

    const paths = JSON.parse(row.paths) as string[];
    const committed = commitToCurrentBranch(
      room.projectPath,
      `bothread: ${row.participant_name} (${paths.slice(0, 3).join(", ")}${paths.length > 3 ? " …" : ""})`,
      paths
    );

    this.db
      .prepare(`UPDATE branches SET status = 'merged', finalized_at = ? WHERE id = ?`)
      .run(now(), branchId);

    // Clean up the tracking branch ref.
    if (room.projectPath) deleteTrackingBranch(room.projectPath, row.branch_name);

    const updated = this.db.prepare(`SELECT * FROM branches WHERE id = ?`).get(branchId) as BranchRow;
    this.audit(roomId, "branch.merge", { name: mergedBy }, { branchId, committed });
    this.postSystemMessage(
      roomId,
      committed
        ? `${mergedBy} merged ${row.participant_name}'s changes (${paths.length} path${paths.length !== 1 ? "s" : ""}) to git history.`
        : `${mergedBy} accepted ${row.participant_name}'s changes (no git commit needed — nothing new staged).`,
      "steering"
    );
    this.publish(roomId, "branch", { branch: this.mapBranch(updated) });
    return this.mapBranch(updated);
  }

  /**
   * Discard: restore the files to their claim-time snapshot, removing the
   * agent's edits while preserving any uncommitted human work that predated the
   * claim.
   */
  discardBranch(roomId: string, branchId: string, discardedBy = "You"): AgentBranch {
    const row = this.db.prepare(`SELECT * FROM branches WHERE id = ? AND room_id = ?`).get(branchId, roomId) as
      | BranchRow
      | undefined;
    if (!row) throw new BothreadError("no_branch", "Branch not found.");
    if (row.status !== "ready") throw new BothreadError("bad_state", "Branch is not in a discardable state.");
    const room = this.getRoom(roomId);
    if (!room?.projectPath) throw new BothreadError("no_project", "Room has no project path.");

    const paths = JSON.parse(row.paths) as string[];
    restoreFilesToSha(room.projectPath, row.base_tree ?? row.base_sha, paths);

    this.db
      .prepare(`UPDATE branches SET status = 'discarded', finalized_at = ? WHERE id = ?`)
      .run(now(), branchId);

    if (room.projectPath) deleteTrackingBranch(room.projectPath, row.branch_name);

    const updated = this.db.prepare(`SELECT * FROM branches WHERE id = ?`).get(branchId) as BranchRow;
    this.audit(roomId, "branch.discard", { name: discardedBy }, { branchId });
    this.postSystemMessage(
      roomId,
      `${discardedBy} discarded ${row.participant_name}'s changes — files restored to before their session.`,
      "steering"
    );
    this.publish(roomId, "branch", { branch: this.mapBranch(updated) });
    return this.mapBranch(updated);
  }

  /**
   * Partial accept (hunk-level review): keep only the selected hunks of an
   * agent's diff and commit them; the rest is reverted to the claim-time
   * baseline. `selectedHunkIds` are ids from the branch's `hunks` list.
   * Empty selection ⇒ behaves like discard.
   */
  applyBranchHunks(roomId: string, branchId: string, selectedHunkIds: string[], appliedBy = "You"): AgentBranch {
    const row = this.db.prepare(`SELECT * FROM branches WHERE id = ? AND room_id = ?`).get(branchId, roomId) as
      | BranchRow
      | undefined;
    if (!row) throw new BothreadError("no_branch", "Branch not found.");
    if (row.status !== "ready") throw new BothreadError("bad_state", "Branch is not ready to review.");
    const room = this.getRoom(roomId);
    if (!room?.projectPath) throw new BothreadError("no_project", "Room has no project path.");
    if (!row.diff) throw new BothreadError("no_diff", "This branch has no diff to apply.");

    const paths = JSON.parse(row.paths) as string[];
    const allHunks = listHunks(row.diff);
    const selected = new Set(selectedHunkIds);
    const keptCount = allHunks.filter((h) => selected.has(h.id)).length;
    const patch = buildPatch(row.diff, selected);
    const baseTree = row.base_tree ?? row.base_sha;

    const ok = applySelectedHunks(
      room.projectPath,
      baseTree,
      paths,
      patch,
      `bothread: ${row.participant_name} (${keptCount} of ${allHunks.length} change${allHunks.length !== 1 ? "s" : ""} accepted)`
    );
    if (!ok) throw new BothreadError("apply_failed", "Couldn't apply the selected changes cleanly.");

    this.db
      .prepare(`UPDATE branches SET status = 'merged', finalized_at = ? WHERE id = ?`)
      .run(now(), branchId);
    if (room.projectPath) deleteTrackingBranch(room.projectPath, row.branch_name);

    const updated = this.db.prepare(`SELECT * FROM branches WHERE id = ?`).get(branchId) as BranchRow;
    this.audit(roomId, "branch.apply", { name: appliedBy }, { branchId, kept: keptCount, total: allHunks.length });
    this.postSystemMessage(
      roomId,
      `${appliedBy} accepted ${keptCount} of ${allHunks.length} change${allHunks.length !== 1 ? "s" : ""} from ${row.participant_name} and discarded the rest.`,
      "steering"
    );
    this.publish(roomId, "branch", { branch: this.mapBranch(updated) });
    return this.mapBranch(updated);
  }
}
