/**
 * @bothread/shared — the single source of truth for Bothread's data model.
 *
 * Every shape the server, the room UI, and the MCP tool surface speak in is a
 * zod schema here. Runtime validation + inferred TypeScript types from one
 * definition (the spec's "shared types" constraint).
 */
import { z } from "zod";

/* ============================================================================
 * Enums
 * ========================================================================== */

export const RoomStatus = z.enum(["active", "paused", "closed"]);
export type RoomStatus = z.infer<typeof RoomStatus>;

export const ParticipantKind = z.enum(["agent", "human"]);
export type ParticipantKind = z.infer<typeof ParticipantKind>;

export const ParticipantStatus = z.enum(["active", "idle", "muted", "revoked", "left"]);
export type ParticipantStatus = z.infer<typeof ParticipantStatus>;

export const MessageKind = z.enum(["agent", "human", "system"]);
export type MessageKind = z.infer<typeof MessageKind>;

/** Priority tiers (MACP-inspired) — drive UI prominence + agent attention. */
export const Importance = z.enum(["info", "advisory", "steering", "interrupt"]);
export type Importance = z.infer<typeof Importance>;

export const LeaseStatus = z.enum(["active", "released", "expired"]);
export type LeaseStatus = z.infer<typeof LeaseStatus>;

export const ApprovalStatus = z.enum(["pending", "approved", "rejected", "edited"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

/** Risky actions that can require a human's yes before an agent proceeds. */
export const RiskAction = z.enum([
  "delete",
  "deploy",
  "shell",
  "git_push",
  "install",
  "migration",
  "network",
  "other",
]);
export type RiskAction = z.infer<typeof RiskAction>;

/* ============================================================================
 * Domain entities (store-of-record shapes)
 * ========================================================================== */

export const RoomSettings = z.object({
  requireApprovalFor: z.array(RiskAction).default(["delete", "deploy", "shell", "git_push"]),
  defaultLeaseTtlMs: z
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
});
export type RoomSettings = z.infer<typeof RoomSettings>;

/**
 * A Room. NOTE: `sessionId` (the secret join credential) is intentionally NOT
 * part of this shape — it never leaves the hub except when the human reveals it
 * in the UI. Snapshots handed to agents never include it.
 */
export const Room = z.object({
  id: z.string(),
  name: z.string(),
  projectPath: z.string().optional(),
  status: RoomStatus,
  createdAt: z.number(),
  settings: RoomSettings,
});
export type Room = z.infer<typeof Room>;

export const Participant = z.object({
  id: z.string(),
  roomId: z.string(),
  name: z.string(),
  brand: z.string().optional(),
  kind: ParticipantKind,
  status: ParticipantStatus,
  capabilities: z.array(z.string()).optional(),
  mcpSessionId: z.string().optional(),
  joinedAt: z.number(),
  lastSeenAt: z.number(),
});
export type Participant = z.infer<typeof Participant>;

export const Message = z.object({
  id: z.string(),
  roomId: z.string(),
  seq: z.number().int(),
  authorId: z.string(),
  authorName: z.string(),
  kind: MessageKind,
  importance: Importance,
  text: z.string(),
  mentions: z.array(z.string()).default([]),
  threadId: z.string().optional(),
  createdAt: z.number(),
});
export type Message = z.infer<typeof Message>;

/** A file claim — advisory lease on a glob path, exclusive or shared. */
export const Lease = z.object({
  id: z.string(),
  roomId: z.string(),
  participantId: z.string(),
  participantName: z.string(),
  pathPattern: z.string(),
  exclusive: z.boolean(),
  reason: z.string().optional(),
  status: LeaseStatus,
  createdAt: z.number(),
  expiresAt: z.number(),
  releasedAt: z.number().optional(),
});
export type Lease = z.infer<typeof Lease>;

export const Approval = z.object({
  id: z.string(),
  roomId: z.string(),
  requestedById: z.string(),
  requestedByName: z.string(),
  action: RiskAction,
  details: z.string(),
  files: z.array(z.string()).optional(),
  status: ApprovalStatus,
  decidedBy: z.string().optional(),
  editedInstruction: z.string().optional(),
  createdAt: z.number(),
  decidedAt: z.number().optional(),
});
export type Approval = z.infer<typeof Approval>;

/** Append-only audit trail. `seq` is monotonic per room. */
export const AuditEvent = z.object({
  id: z.string(),
  roomId: z.string(),
  seq: z.number().int(),
  ts: z.number(),
  actorId: z.string().optional(),
  actorName: z.string().optional(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

/* ============================================================================
 * RoomSnapshot — the agent's clean, structured "what's going on" view (§5.3)
 * ========================================================================== */

export const LockView = z.object({
  path: z.string(),
  heldBy: z.string(),
  heldByName: z.string(),
  exclusive: z.boolean(),
  expiresAt: z.number(),
});
export type LockView = z.infer<typeof LockView>;

export const ParticipantView = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string().optional(),
  kind: ParticipantKind,
  status: ParticipantStatus,
  claimedFiles: z.array(z.string()),
  lastSeen: z.number(),
});
export type ParticipantView = z.infer<typeof ParticipantView>;

export const ThreadEntry = z.object({
  seq: z.number(),
  author: z.string(),
  kind: MessageKind,
  importance: Importance,
  text: z.string(),
  mentions: z.array(z.string()),
  at: z.number(),
});
export type ThreadEntry = z.infer<typeof ThreadEntry>;

export const PendingApprovalView = z.object({
  id: z.string(),
  action: RiskAction,
  details: z.string(),
  requestedBy: z.string(),
});
export type PendingApprovalView = z.infer<typeof PendingApprovalView>;

export const RoomSnapshot = z.object({
  room: z.object({ name: z.string(), status: RoomStatus }),
  you: z.object({
    id: z.string(),
    name: z.string(),
    status: ParticipantStatus,
    leases: z.array(z.string()),
  }),
  participants: z.array(ParticipantView),
  thread: z.array(ThreadEntry),
  locks: z.array(LockView),
  pendingApprovals: z.array(PendingApprovalView),
  latestSeq: z.number(),
  etiquette: z.string(),
});
export type RoomSnapshot = z.infer<typeof RoomSnapshot>;

/* ============================================================================
 * MCP tool I/O — the agent surface (§5.2). Inputs are zod raw shapes the SDK
 * can register directly; outputs are clean structured objects.
 * ========================================================================== */

export const JoinSessionInput = z.object({
  sessionId: z.string().min(8).describe("The room session ID the human pasted to you. Never guess it."),
  agentName: z.string().min(1).max(60).describe("A short display name for you in the room, e.g. 'Claude Code'."),
  brand: z.string().max(40).optional().describe("Your product/brand, e.g. 'claude' | 'cursor' | 'gemini'."),
  capabilities: z.array(z.string()).max(32).optional(),
});
export type JoinSessionInput = z.infer<typeof JoinSessionInput>;

export const GetRoomStateInput = z.object({
  since: z.number().int().optional().describe("Only include thread messages with seq greater than this."),
  sessionId: z.string().optional(),
});
export type GetRoomStateInput = z.infer<typeof GetRoomStateInput>;

export const SendMessageInput = z.object({
  text: z.string().min(1).max(8000),
  mentions: z.array(z.string()).max(16).optional().describe("Participant names to direct this at."),
  threadId: z.string().optional(),
  importance: Importance.optional(),
  sessionId: z.string().optional(),
});
export type SendMessageInput = z.infer<typeof SendMessageInput>;

export const ReadMessagesInput = z.object({
  since: z.number().int().optional().describe("Return messages after this seq (your cursor)."),
  unreadOnly: z.boolean().optional(),
  mentionsMe: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  sessionId: z.string().optional(),
});
export type ReadMessagesInput = z.infer<typeof ReadMessagesInput>;

export const WaitForUpdateInput = z.object({
  maxWaitMs: z.number().int().min(0).max(60000).optional().describe("Long-poll up to this long for new activity."),
  since: z.number().int().optional(),
  sessionId: z.string().optional(),
});
export type WaitForUpdateInput = z.infer<typeof WaitForUpdateInput>;

export const ClaimFilesInput = z.object({
  paths: z.array(z.string().min(1)).min(1).max(64).describe("Glob paths to claim before editing, e.g. ['src/payments/**']."),
  exclusive: z.boolean().optional().describe("Default true. Exclusive blocks others; shared allows other shared holders."),
  reason: z.string().max(300).optional(),
  ttlSeconds: z.number().int().positive().max(86400).optional(),
  sessionId: z.string().optional(),
});
export type ClaimFilesInput = z.infer<typeof ClaimFilesInput>;

export const ReleaseFilesInput = z.object({
  paths: z.array(z.string()).optional(),
  leaseIds: z.array(z.string()).optional(),
  sessionId: z.string().optional(),
});
export type ReleaseFilesInput = z.infer<typeof ReleaseFilesInput>;

export const RenewFilesInput = z.object({
  paths: z.array(z.string()).optional(),
  leaseIds: z.array(z.string()).optional(),
  ttlSeconds: z.number().int().positive().max(86400).optional(),
  sessionId: z.string().optional(),
});
export type RenewFilesInput = z.infer<typeof RenewFilesInput>;

export const RequestApprovalInput = z.object({
  action: RiskAction,
  details: z.string().min(1).max(2000).describe("Exactly what you want to do and why — the human reads this."),
  files: z.array(z.string()).max(64).optional(),
  sessionId: z.string().optional(),
});
export type RequestApprovalInput = z.infer<typeof RequestApprovalInput>;

export const LeaveSessionInput = z.object({
  sessionId: z.string().optional(),
});
export type LeaveSessionInput = z.infer<typeof LeaveSessionInput>;

/* ----- Tool results ----- */

export const LeaseConflict = z.object({
  path: z.string(),
  heldBy: z.string(),
  heldByName: z.string(),
  exclusive: z.boolean(),
});
export type LeaseConflict = z.infer<typeof LeaseConflict>;

export const ClaimResult = z.object({
  granted: z.boolean(),
  leases: z.array(Lease),
  conflicts: z.array(LeaseConflict),
});
export type ClaimResult = z.infer<typeof ClaimResult>;

export const ApprovalResult = z.object({
  status: ApprovalStatus,
  editedInstruction: z.string().optional(),
  decidedBy: z.string().optional(),
});
export type ApprovalResult = z.infer<typeof ApprovalResult>;

export const WaitForUpdateResult = z.object({
  changed: z.boolean(),
  latestSeq: z.number(),
  newMessages: z.array(ThreadEntry),
  pendingApprovals: z.array(PendingApprovalView),
});
export type WaitForUpdateResult = z.infer<typeof WaitForUpdateResult>;

/* ============================================================================
 * Realtime — WebSocket events pushed to the room UI.
 * ========================================================================== */

export const ServerEventType = z.enum([
  "snapshot",
  "message",
  "participant",
  "lease",
  "approval",
  "room",
  "audit",
  "collision",
]);
export type ServerEventType = z.infer<typeof ServerEventType>;

export const ServerEvent = z.object({
  type: ServerEventType,
  roomId: z.string(),
  seq: z.number().optional(),
  data: z.unknown(),
  ts: z.number(),
});
export type ServerEvent = z.infer<typeof ServerEvent>;

/* ============================================================================
 * Constants
 * ========================================================================== */

/** The etiquette block embedded in every RoomSnapshot — keeps agents honest. */
export const ETIQUETTE =
  "You are in a shared Bothread room with other agents and a human overseer. " +
  "ALWAYS call get_room_state before acting. " +
  "ALWAYS claim_files before editing any file; NEVER edit a file held by another participant. " +
  "Your own chat text is NOT visible to others — use send_message to communicate. " +
  "Call request_approval before any risky action (delete, deploy, shell, git push). " +
  "If the room is paused, stop and wait. Call leave_session when you're done.";

export const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000;
export const RECENT_THREAD_LIMIT = 40;
