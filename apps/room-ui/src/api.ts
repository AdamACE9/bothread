import type { AgentBranch, Approval, Lease, Participant, Room, RoomSnapshot } from "@bothread/shared";

const J = { "content-type": "application/json" };

export interface RoomDetail {
  snapshot: RoomSnapshot;
  sessionId: string;
  participants: Participant[];
  pendingApprovals: Approval[];
  leases: Lease[];
}

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
}
async function jpost<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: J, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
}

export interface ConnectInfo {
  mcpUrl: string;
  token: string | null;
  authRequired: boolean;
}
export const getConnectInfo = () => jget<ConnectInfo>("/api/connect-info");

export const listRooms = () => jget<{ rooms: Room[] }>("/api/rooms").then((r) => r.rooms);
export const createRoom = (name: string, projectPath?: string) =>
  jpost<{ room: Room; sessionId: string }>("/api/rooms", { name, projectPath });
export const getRoom = (id: string) => jget<RoomDetail>(`/api/rooms/${id}`);
export const sendOverseer = (id: string, text: string, importance = "steering") =>
  jpost(`/api/rooms/${id}/message`, { text, importance });
export const setRoomStatus = (id: string, status: "active" | "paused" | "closed") =>
  jpost(`/api/rooms/${id}/status`, { status });
export const setParticipantStatus = (id: string, pid: string, status: "active" | "muted" | "revoked") =>
  jpost(`/api/rooms/${id}/participants/${pid}/status`, { status });
export const decideApproval = (id: string, aid: string, decision: "approved" | "rejected" | "edited", instruction?: string) =>
  jpost(`/api/rooms/${id}/approvals/${aid}/decide`, { decision, instruction });

export const listBranches = (id: string, all = false) =>
  jget<{ branches: AgentBranch[] }>(`/api/rooms/${id}/branches${all ? "?all=true" : ""}`).then((r) => r.branches);
export const mergeBranch = (id: string, bid: string) => jpost(`/api/rooms/${id}/branches/${bid}/merge`);
export const discardBranch = (id: string, bid: string) => jpost(`/api/rooms/${id}/branches/${bid}/discard`);
export const applyHunks = (id: string, bid: string, hunkIds: string[]) =>
  jpost(`/api/rooms/${id}/branches/${bid}/apply`, { hunkIds });
