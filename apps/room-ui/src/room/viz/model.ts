/**
 * Shared derivations for the visual room views: brand colors, agent status,
 * per-agent diff stats, time formatting and small hooks. Pure + tiny, so the
 * Map and the Timeline read the room the same way.
 */
import { useEffect, useRef, useState } from "react";
import type { AgentBranch, Lease, ParticipantView, RoomSnapshot } from "@bothread/shared";
import { brandKey } from "../../ui";

export type AgentState = "listening" | "working" | "idle" | "off" | "human";

export function agentState(p: ParticipantView): AgentState {
  if (p.kind === "human") return "human";
  if (p.status === "left" || p.status === "revoked") return "off";
  if (p.listening) return "listening";
  if (p.idle || p.status === "muted") return "idle";
  return "working";
}

export const STATE_LABEL: Record<AgentState, string> = {
  listening: "Listening",
  working: "Working",
  idle: "Idle",
  off: "Left the room",
  human: "Overseer",
};

/** CSS color expression for a participant's identity (brand hue; copper for the human). */
export function colorOf(p: { kind?: string; brand?: string | null } | undefined): string {
  if (!p) return "var(--muted)";
  if (p.kind === "human") return "var(--copper)";
  const k = brandKey(p.brand);
  return k ? `var(--${k})` : "var(--sky)";
}

/** Stable short key for SVG ids / pattern lookup. */
export function colorKey(p: { kind?: string; brand?: string | null } | undefined): string {
  if (!p) return "none";
  if (p.kind === "human") return "human";
  return brandKey(p.brand) || "other";
}

export function diffStats(branches: AgentBranch[]): Map<string, { add: number; del: number; files: number }> {
  const out = new Map<string, { add: number; del: number; files: number }>();
  for (const b of branches) {
    if (b.status !== "ready") continue;
    let add = 0;
    let del = 0;
    if (b.hunks?.length) {
      for (const h of b.hunks) {
        add += h.additions;
        del += h.deletions;
      }
    } else if (b.diff) {
      for (const line of b.diff.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) add++;
        else if (line.startsWith("-") && !line.startsWith("---")) del++;
      }
    }
    if (!add && !del) continue;
    const cur = out.get(b.participantName) ?? { add: 0, del: 0, files: 0 };
    cur.add += add;
    cur.del += del;
    cur.files += b.paths.length;
    out.set(b.participantName, cur);
  }
  return out;
}

export function leaseFor(leases: Lease[], path: string, holderId: string): Lease | undefined {
  return leases.find((l) => l.status === "active" && l.pathPattern === path && l.participantId === holderId);
}

/** "src/levels/loader.ts" → "levels/loader.ts", trimmed to fit a chip. */
export function shortPath(path: string, max = 22): string {
  const parts = path.split("/").filter(Boolean);
  let s = parts.length > 2 ? parts.slice(-2).join("/") : path;
  if (s.length > max) s = "…" + s.slice(s.length - max + 1);
  return s;
}

export function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

export function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDur(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

export function agentsOf(snapshot: RoomSnapshot): ParticipantView[] {
  return snapshot.participants.filter((p) => p.kind === "agent");
}

/** What an agent is up to right now, in one line: its in-progress task, else its latest message. */
export function doingOf(snapshot: RoomSnapshot, p: ParticipantView): string | null {
  const task = snapshot.tasks.find((t) => t.ownerName === p.name && t.status === "in_progress");
  if (task) return `On task: ${task.title}`;
  for (let i = snapshot.thread.length - 1; i >= 0; i--) {
    const m = snapshot.thread[i]!;
    if (m.author === p.name && !m.retractedAt) return `Said: “${truncate(m.text, 90)}”`;
  }
  return null;
}

/** Re-render on an interval (for countdowns). Pauses while the tab is hidden. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) setNow(Date.now());
    };
    const id = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs]);
  return now;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Element size via ResizeObserver. */
export function useSize<T extends HTMLElement>(): [React.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]!.contentRect;
      setSize((s) => (Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5 ? s : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}
