/**
 * Timeline derivation: turns the audit trail (newest first), the thread and the
 * live lease list into lanes + marks on one time axis. Pure, so it can be
 * memoized on its inputs.
 */
import type { AuditEvent, Importance, Lease, ParticipantView, RoomSnapshot, ServerEvent } from "@bothread/shared";

export interface Lane {
  name: string;
  p?: ParticipantView;
  start: number;
  end?: number;
  /** Claim sub-rows used by this lane. */
  rows: number;
}

export interface MsgMark {
  kind: "msg";
  lane: string;
  t: number;
  seq: number;
  importance: Importance;
  text: string;
  mentions: string[];
  mentionsYou: boolean;
}
export interface ClaimMark {
  kind: "claim";
  lane: string;
  path: string;
  t0: number;
  t1: number;
  exclusive: boolean;
  ongoing: boolean;
  expiresAt?: number;
  reason?: string;
  row: number;
  endedBy: "release" | "expiry" | "leave" | "active";
}
export interface CollisionMark {
  kind: "collision";
  t: number;
  by: string;
  holder: string;
  path: string;
}
export interface HandoffMark {
  kind: "handoff";
  t: number;
  from: string;
  to: string;
  path: string;
  pending: boolean;
  resolvedAt?: number;
}
export interface ApprovalMark {
  kind: "approval";
  lane: string;
  t: number;
  id: string;
  action: string;
  status: "pending" | "approved" | "rejected" | "edited" | "unknown";
  decidedAt?: number;
  details?: string;
}
export interface DoneMark {
  kind: "done";
  lane: string;
  t: number;
  title: string;
}
export interface CapMark {
  kind: "join" | "leave";
  lane: string;
  t: number;
  detail?: string;
}

export interface TimelineData {
  lanes: Lane[];
  msgs: MsgMark[];
  claims: ClaimMark[];
  collisions: CollisionMark[];
  handoffs: HandoffMark[];
  approvals: ApprovalMark[];
  done: DoneMark[];
  caps: CapMark[];
  t0: number;
}

const DEFAULT_TTL = 15 * 60_000;
const MAX_ROWS = 8;

export function buildTimeline(
  snapshot: RoomSnapshot,
  audit: AuditEvent[],
  leases: Lease[],
  events: ServerEvent[],
  now: number
): TimelineData {
  const asc = [...audit].sort((a, b) => a.seq - b.seq || a.ts - b.ts);
  const you = snapshot.you.name.toLowerCase();
  const people = snapshot.participants;
  const laneMap = new Map<string, Lane>();
  const ensure = (name: string, t: number): Lane => {
    let l = laneMap.get(name);
    if (!l) {
      l = { name, p: people.find((p) => p.name === name), start: t, rows: 1 };
      laneMap.set(name, l);
    }
    return l;
  };

  let t0 = now;
  for (const a of asc) t0 = Math.min(t0, a.ts);
  for (const m of snapshot.thread) t0 = Math.min(t0, m.at);
  for (const l of leases) t0 = Math.min(t0, l.createdAt);

  // Lanes: you first, then everyone in participant order.
  const human = people.find((p) => p.kind === "human");
  ensure(human?.name ?? snapshot.you.name, t0);
  for (const p of people) if (p.kind === "agent" || p.kind === "human") ensure(p.name, t0);

  const caps: CapMark[] = [];
  const collisions: CollisionMark[] = [];
  const handoffs: HandoffMark[] = [];
  const approvals: ApprovalMark[] = [];
  const done: DoneMark[] = [];
  const msgs: MsgMark[] = [];
  const claimsRaw: Omit<ClaimMark, "row">[] = [];
  const open = new Map<string, Omit<ClaimMark, "row">>();
  const activeKey = new Set(leases.filter((l) => l.status === "active").map((l) => `${l.participantName}\u0000${l.pathPattern}`));
  const leaseByKey = new Map(leases.map((l) => [`${l.participantName}\u0000${l.pathPattern}`, l]));
  const taskTitle = new Map(snapshot.tasks.map((t) => [t.id, t.title]));
  const pendingApprovalIds = new Set(snapshot.pendingApprovals.map((a) => a.id));
  const approvalById = new Map<string, ApprovalMark>();
  const joined = new Set<string>();

  const closeAll = (actor: string, t: number, why: ClaimMark["endedBy"]) => {
    for (const [k, c] of open) {
      if (c.lane !== actor || activeKey.has(k)) continue;
      c.t1 = Math.max(c.t0, Math.min(t, c.t0 + DEFAULT_TTL));
      c.endedBy = c.t0 + DEFAULT_TTL < t ? "expiry" : why;
      open.delete(k);
    }
  };

  for (const a of asc) {
    const actor = a.actorName ?? "";
    const pl = a.payload ?? {};
    switch (a.type) {
      case "participant.join": {
        const lane = ensure(actor, a.ts);
        if (!joined.has(actor)) {
          joined.add(actor);
          lane.start = a.ts;
        }
        caps.push({ kind: "join", lane: actor, t: a.ts, detail: [pl.model, pl.client].filter(Boolean).join(" in ") || undefined });
        break;
      }
      case "participant.leave":
      case "participant.revoked": {
        const name = a.type === "participant.leave" ? actor : String(pl.participant ?? "");
        const lane = ensure(name, t0);
        lane.end = a.ts;
        caps.push({ kind: "leave", lane: name, t: a.ts, detail: a.type === "participant.revoked" ? "Removed by the overseer" : "Left the room" });
        closeAll(name, a.ts, "leave");
        break;
      }
      case "lease.claim": {
        ensure(actor, t0);
        const paths = (pl.paths as string[] | undefined) ?? [];
        for (const path of paths) {
          const k = `${actor}\u0000${path}`;
          if (open.has(k)) continue;
          const lease = leaseByKey.get(k);
          const c: Omit<ClaimMark, "row"> = {
            kind: "claim",
            lane: actor,
            path,
            t0: a.ts,
            t1: now,
            exclusive: pl.exclusive !== false,
            ongoing: false,
            reason: lease?.reason,
            expiresAt: lease?.expiresAt,
            endedBy: "active",
          };
          open.set(k, c);
          claimsRaw.push(c);
        }
        break;
      }
      case "lease.release":
        closeAll(actor, a.ts, "release");
        break;
      case "lease.collision": {
        const conflicts = (pl.conflicts as { path: string; heldByName: string }[] | undefined) ?? [];
        for (const c of conflicts) {
          ensure(actor, t0);
          ensure(c.heldByName, t0);
          collisions.push({ kind: "collision", t: a.ts, by: actor, holder: c.heldByName, path: c.path });
        }
        break;
      }
      case "handoff.request": {
        const holder = String(pl.holder ?? "");
        const path = String(pl.path ?? "");
        ensure(actor, t0);
        ensure(holder, t0);
        const pending = snapshot.handoffs.some((h) => h.requestedBy === actor && h.path === path);
        handoffs.push({ kind: "handoff", t: a.ts, from: actor, to: holder, path, pending });
        break;
      }
      case "approval.request": {
        const id = String(pl.approvalId ?? a.id);
        const pend = snapshot.pendingApprovals.find((x) => x.id === id);
        const m: ApprovalMark = {
          kind: "approval",
          lane: actor,
          t: a.ts,
          id,
          action: String(pl.action ?? "other"),
          status: pendingApprovalIds.has(id) ? "pending" : "unknown",
          details: pend?.details,
        };
        ensure(actor, t0);
        approvals.push(m);
        approvalById.set(id, m);
        break;
      }
      case "approval.approved":
      case "approval.rejected":
      case "approval.edited": {
        const m = approvalById.get(String(pl.approvalId ?? ""));
        if (m) {
          m.status = a.type.slice("approval.".length) as ApprovalMark["status"];
          m.decidedAt = a.ts;
        }
        break;
      }
      case "task.update": {
        if (pl.status === "done") {
          ensure(actor, t0);
          done.push({ kind: "done", lane: actor, t: a.ts, title: taskTitle.get(String(pl.taskId)) ?? "Task" });
        }
        break;
      }
      default:
        break;
    }
  }

  // Claims still open: live if the hub still lists them, else they ran out.
  for (const [k, c] of open) {
    if (activeKey.has(k)) {
      c.ongoing = true;
      c.t1 = now;
      c.endedBy = "active";
    } else {
      c.t1 = Math.min(now, c.t0 + DEFAULT_TTL);
      c.endedBy = "expiry";
    }
  }
  // Live leases older than the audit window.
  for (const l of leases) {
    if (l.status !== "active") continue;
    const k = `${l.participantName}\u0000${l.pathPattern}`;
    if (open.has(k)) continue;
    ensure(l.participantName, t0);
    claimsRaw.push({
      kind: "claim",
      lane: l.participantName,
      path: l.pathPattern,
      t0: l.createdAt,
      t1: now,
      exclusive: l.exclusive,
      ongoing: true,
      reason: l.reason,
      expiresAt: l.expiresAt,
      endedBy: "active",
    });
  }

  // Hand-off resolution times from live events.
  for (const ev of events) {
    if (ev.type !== "handoff") continue;
    const h = (ev.data as { handoff?: { requesterName: string; path: string; status: string; resolvedAt?: number } } | null)?.handoff;
    if (!h || h.status === "pending" || !h.resolvedAt) continue;
    const m = handoffs.find((x) => x.from === h.requesterName && x.path === h.path && !x.resolvedAt && x.t <= h.resolvedAt!);
    if (m) {
      m.resolvedAt = h.resolvedAt;
      m.pending = false;
    }
  }

  // Messages from the thread (non-system), plus older audit-only sends.
  const seen = new Set<number>();
  for (const m of snapshot.thread) {
    if (m.kind === "system") continue;
    seen.add(m.seq);
    ensure(m.author, t0);
    msgs.push({
      kind: "msg",
      lane: m.author,
      t: m.at,
      seq: m.seq,
      importance: m.importance,
      text: m.retractedAt ? "(retracted)" : m.text,
      mentions: m.mentions,
      mentionsYou: m.mentions.some((x) => x.toLowerCase() === you) || new RegExp(`@${you.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(m.text),
    });
  }
  for (const a of asc) {
    if (a.type !== "message.send" && a.type !== "message.overseer") continue;
    const seq = Number(a.payload?.seq);
    if (!Number.isFinite(seq) || seen.has(seq) || !a.actorName) continue;
    seen.add(seq);
    ensure(a.actorName, t0);
    const mentions = (a.payload?.mentions as string[] | undefined) ?? [];
    msgs.push({
      kind: "msg",
      lane: a.actorName,
      t: a.ts,
      seq,
      importance: "info",
      text: "",
      mentions,
      mentionsYou: mentions.some((x) => x.toLowerCase() === you),
    });
  }
  msgs.sort((a, b) => a.t - b.t);

  // Pack claims into sub-rows per lane (greedy interval packing).
  const claims: ClaimMark[] = [];
  const byLane = new Map<string, Omit<ClaimMark, "row">[]>();
  for (const c of claimsRaw) byLane.set(c.lane, [...(byLane.get(c.lane) ?? []), c]);
  for (const [lane, list] of byLane) {
    list.sort((a, b) => a.t0 - b.t0);
    const rowEnds: number[] = [];
    for (const c of list) {
      let row = rowEnds.findIndex((end) => end <= c.t0 - 1000);
      if (row === -1) {
        row = rowEnds.length;
        rowEnds.push(0);
      }
      rowEnds[row] = c.t1;
      // Past MAX_ROWS concurrent claims, fold onto existing rows rather than spilling into the next lane.
      claims.push({ ...c, row: row % MAX_ROWS });
    }
    const l = laneMap.get(lane);
    if (l) l.rows = Math.max(1, Math.min(MAX_ROWS, rowEnds.length));
  }

  // A participant with no join in view started before the window.
  for (const l of laneMap.values()) {
    const p = l.p;
    if (p && (p.status === "left" || p.status === "revoked") && l.end === undefined) l.end = Math.min(now, p.lastSeen);
  }

  return { lanes: [...laneMap.values()], msgs, claims, collisions, handoffs, approvals, done, caps, t0 };
}

/** Count of claims active at each sample time. */
export function claimSeries(claims: ClaimMark[], from: number, to: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = from + ((to - from) * i) / (n - 1);
    out.push(claims.filter((c) => c.t0 <= t && c.t1 >= t).length);
  }
  return out;
}

/** Messages per bucket over [from, to]. */
export function msgSeries(msgs: MsgMark[], from: number, to: number, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  const span = Math.max(1, to - from);
  for (const m of msgs) {
    const i = Math.floor(((m.t - from) / span) * n);
    if (i >= 0 && i < n) out[i]!++;
    else if (i === n) out[n - 1]!++;
  }
  return out;
}

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400].map((s) => s * 1000);
export function tickStep(pxPerMs: number, minPx = 84): number {
  return STEPS.find((s) => s * pxPerMs >= minPx) ?? STEPS[STEPS.length - 1]!;
}
