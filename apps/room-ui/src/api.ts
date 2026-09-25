import type { AgentBranch, Approval, AuditEvent, Importance, Lease, NoteKind, Participant, Room, RoomNote, RoomSnapshot, RoomTask, TaskStatus, ThreadEntry } from "@bothread/shared";

export interface RoomDetail {
  snapshot: RoomSnapshot;
  /** Full room record (project folder, settings). Absent from hubs older than 0.3. */
  room?: Room;
  sessionId: string;
  participants: Participant[];
  pendingApprovals: Approval[];
  leases: Lease[];
}

export interface RoomSummary {
  room: Room;
  agents: { name: string; brand: string | null }[];
  messageCount: number;
  lastActivityAt: number;
  pendingApprovals: number;
  activeClaims: number;
}

/** An API failure carrying the hub's own human-readable reason, not just a status code. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

/**
 * Only needed when the hub is served past loopback with BOTHREAD_AUTH=on — the
 * room UI then has to present the same token agents use. Kept per browser.
 */
const TOKEN_KEY = "bothread.token";
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode: the token just won't persist */
  }
}

function headers(json: boolean): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h["content-type"] = "application/json";
  const t = getToken();
  if (t) h["authorization"] = `Bearer ${t}`;
  return h;
}

async function handle<T>(r: Response): Promise<T> {
  if (r.ok) return (r.status === 204 ? undefined : await r.json()) as T;
  let message = `Request failed (${r.status})`;
  let code: string | undefined;
  try {
    const body = (await r.json()) as { error?: string; code?: string };
    if (body.error) message = body.error;
    code = body.code;
  } catch {
    /* non-JSON error body */
  }
  if (r.status === 401) window.dispatchEvent(new CustomEvent("bothread:unauthorized"));
  throw new ApiError(r.status, message, code);
}

const jget = <T>(url: string) => fetch(url, { headers: headers(false) }).then((r) => handle<T>(r));
const jpost = <T = unknown>(url: string, body?: unknown) =>
  fetch(url, { method: "POST", headers: headers(true), body: body ? JSON.stringify(body) : undefined }).then((r) =>
    handle<T>(r)
  );
const jdelete = (url: string) => fetch(url, { method: "DELETE", headers: headers(false) }).then((r) => handle<void>(r));

export interface ConnectInfo {
  mcpUrl: string;
  token: string | null;
  authRequired: boolean;
}
export interface Health {
  ok: boolean;
  version?: string;
  sessions: number;
}
export const getHealth = () => jget<Health>("/api/health");
export const getConnectInfo = () => jget<ConnectInfo>("/api/connect-info");

export const listRooms = () => jget<{ rooms: Room[] }>("/api/rooms").then((r) => r.rooms);
export const listRoomSummaries = () =>
  jget<{ rooms: Room[]; summaries?: RoomSummary[] }>("/api/rooms?summary=1").then(
    (r) =>
      r.summaries ??
      r.rooms.map((room) => ({ room, agents: [], messageCount: 0, lastActivityAt: room.createdAt, pendingApprovals: 0, activeClaims: 0 }))
  );
export const createRoom = (name: string, projectPath?: string) =>
  jpost<{ room: Room; sessionId: string }>("/api/rooms", { name, projectPath });
export const getRoom = (id: string) => jget<RoomDetail>(`/api/rooms/${id}`);
export const deleteRoom = (id: string) => jdelete(`/api/rooms/${id}`);
export const getMessagesBefore = (id: string, beforeSeq: number, limit = 40) =>
  jget<{ messages: ThreadEntry[]; hasMore: boolean }>(`/api/rooms/${id}/messages?before=${beforeSeq}&limit=${limit}`);

export interface OverseerMessage {
  text: string;
  importance?: Importance;
  mentions?: string[];
  threadId?: string;
  replyToSeq?: number;
}
export const sendOverseer = (id: string, msg: OverseerMessage) =>
  jpost(`/api/rooms/${id}/message`, { importance: "steering", ...msg });
export const setRoomStatus = (id: string, status: "active" | "paused" | "closed") =>
  jpost(`/api/rooms/${id}/status`, { status });
export const renameRoom = (id: string, name: string) => jpost<{ room: Room }>(`/api/rooms/${id}/rename`, { name });
export const updateRoomSettings = (id: string, settings: { requireApprovalFor?: string[]; defaultLeaseTtlMs?: number }) =>
  jpost<{ room: Room }>(`/api/rooms/${id}/settings`, settings);
export const getAudit = (id: string, limit = 150) =>
  jget<{ audit: AuditEvent[] }>(`/api/rooms/${id}/audit?limit=${limit}`).then((r) => r.audit);
export const setParticipantStatus = (id: string, pid: string, status: "active" | "muted" | "revoked") =>
  jpost(`/api/rooms/${id}/participants/${pid}/status`, { status });
export const nudgeParticipant = (id: string, pid: string) =>
  jpost<{ listening: boolean }>(`/api/rooms/${id}/participants/${pid}/nudge`);
export const decideApproval = (id: string, aid: string, decision: "approved" | "rejected" | "edited", instruction?: string) =>
  jpost(`/api/rooms/${id}/approvals/${aid}/decide`, { decision, instruction });

export const listBranches = (id: string, all = false) =>
  jget<{ branches: AgentBranch[] }>(`/api/rooms/${id}/branches${all ? "?all=true" : ""}`).then((r) => r.branches);
export const mergeBranch = (id: string, bid: string) => jpost(`/api/rooms/${id}/branches/${bid}/merge`);
export const discardBranch = (id: string, bid: string) => jpost(`/api/rooms/${id}/branches/${bid}/discard`);
export const applyHunks = (id: string, bid: string, hunkIds: string[]) =>
  jpost(`/api/rooms/${id}/branches/${bid}/apply`, { hunkIds });

export const createTask = (id: string, title: string, note?: string, claim?: boolean) =>
  jpost<{ task: RoomTask }>(`/api/rooms/${id}/tasks`, { title, note, claim });
export const updateTask = (id: string, taskId: string, patch: { status?: TaskStatus; note?: string; takeOwnership?: boolean }) =>
  jpost<{ task: RoomTask }>(`/api/rooms/${id}/tasks/${taskId}`, patch);

export const recordNote = (id: string, kind: NoteKind, title: string, detail?: string) =>
  jpost<{ note: RoomNote }>(`/api/rooms/${id}/notes`, { kind, title, detail });
export const resolveNote = (id: string, nid: string, resolution?: string) =>
  jpost<{ note: RoomNote }>(`/api/rooms/${id}/notes/${nid}/resolve`, { resolution });

/** WebSocket URL for a room's live push, carrying the token when one is set. */
export function roomSocketUrl(roomId: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const t = getToken();
  return `${proto}://${location.host}/ws?room=${encodeURIComponent(roomId)}${t ? `&token=${encodeURIComponent(t)}` : ""}`;
}

/* ----- One-click agent setup: the hub detects agents installed on this machine
 * and writes their MCP config (with a backup) when you ask it to. ----- */
export interface DetectedAgent {
  id: string;
  label: string;
  /** The agent's app or config folder exists on this machine. */
  detected: boolean;
  /** Bothread is already in its MCP config. */
  configured: boolean;
  /** Where the config lives (or the command that will be run). */
  target?: string;
  /** Can the hub configure it by itself? */
  canAutoSetup: boolean;
  note?: string;
}
export const listAgents = () => jget<{ agents: DetectedAgent[] }>("/api/agents").then((r) => r.agents);
export const setupAgent = (id: string) =>
  jpost<{ ok: boolean; message: string; target?: string; backup?: string }>(`/api/agents/${encodeURIComponent(id)}/setup`);
export const removeAgentSetup = (id: string) =>
  jpost<{ ok: boolean; message: string; target?: string; backup?: string }>(`/api/agents/${encodeURIComponent(id)}/remove`);
