import type { AgentBranch, AuditEvent, Lease, RoomSnapshot, ServerEvent } from "@bothread/shared";

export type VizTab = "claims" | "tasks" | "changes" | "notes" | "activity";

/** The contract every visual room view (Map, Timeline) renders from. */
export interface VizProps {
  roomId: string;
  /** participants, locks, handoffs, tasks, thread, notes */
  snapshot: RoomSnapshot;
  /** From RoomDetail.leases (reason, createdAt, expiresAt). */
  leases: Lease[];
  /** Ready / tracking diffs. */
  branches: AgentBranch[];
  /** Recent live WS events, newest last (max ~200), may be []. */
  events: ServerEvent[];
  /** Newest FIRST as returned by getAudit (up to 300), may be []. */
  audit: AuditEvent[];
  theme: "dark" | "light";
  /** Focus that agent elsewhere. */
  onSelectAgent: (name: string) => void;
  onOpenTab: (tab: VizTab) => void;
}
