import type {
  Approval,
  ApprovalResult,
  ApprovalStatus,
  ClaimFilesInput,
  ClaimResult,
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
import { ETIQUETTE, RECENT_THREAD_LIMIT, RoomSettings as RoomSettingsSchema } from "@bothread/shared";
import type { DB } from "../db/database";
import type { RoomBus } from "../realtime";
import { BothreadError } from "./errors";
import { newId, newSessionId } from "./ids";
import { leasesConflict } from "./leases";

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

    const build = (): WaitForUpdateResult => {
      const latestSeq = this.latestSeq(roomId);
      const newMessages = this.msgRows(roomId, since).map((r) => this.toThreadEntry(this.mapMessage(r)));
      return {
        changed: latestSeq > since,
        latestSeq,
        newMessages,
        pendingApprovals: this.pendingApprovalViews(roomId),
      };
    };

    const immediate = build();
    if (immediate.changed) return immediate;

    await this.bus.waitFor(
      roomId,
      (ev) => ev.type === "message" || ev.type === "approval" || ev.type === "room" || ev.type === "collision",
      maxWaitMs
    );
    return build();
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

  /* ===================== Leave ===================== */

  leaveSession(caller: Caller): void {
    const roomId = caller.room.id;
    this.releaseAllFor(roomId, caller.participant.id, "left");
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
      thread: this.msgRows(room.id).map((r) => this.toThreadEntry(this.mapMessage(r))),
      locks: leases.map((l) => ({
        path: l.pathPattern,
        heldBy: l.participantId,
        heldByName: l.participantName,
        exclusive: l.exclusive,
        expiresAt: l.expiresAt,
      })),
      pendingApprovals: this.pendingApprovalViews(room.id),
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
}
