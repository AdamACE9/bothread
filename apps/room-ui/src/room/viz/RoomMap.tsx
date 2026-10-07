/**
 * RoomMap: a live "air-traffic" view of the room. The hub glows at the center,
 * agents orbit it with status rings, claimed files hang off their holders on
 * threads that drain as the lease runs down, and live moments (messages,
 * mentions, collisions, hand-offs, approvals) animate across the map.
 *
 * SVG for everything static (crisp + themeable through CSS tokens); particles
 * are drawn imperatively in a requestAnimationFrame loop that only runs while
 * something is in flight and stops when the tab is hidden.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { LockView, ParticipantView, ServerEvent, ThreadEntry } from "@bothread/shared";
import { initials } from "../../ui";
import {
  AGENT_R,
  CHIP_H,
  HUB_R,
  HUMAN_R,
  bowPath,
  bowPoint,
  computeLayout,
  type FileInput,
  type OrbitInput,
  type P,
} from "./mapLayout";
import {
  STATE_LABEL,
  agentState,
  colorOf,
  diffStats,
  doingOf,
  fmtDur,
  leaseFor,
  shortPath,
  truncate,
  useNow,
  useReducedMotion,
  useSize,
} from "./model";
import { Tooltip, anchorOf, type TipState } from "./Tooltip";
import type { VizProps } from "./types";
import "./viz.css";

const SVGNS = "http://www.w3.org/2000/svg";
const GHOST_MS = 120_000;
const COLLISION_MS = 3200;

interface Ghost {
  pos: P;
  holder: string;
  since: number;
}

interface Collision {
  id: string;
  path: string;
  by: string;
  holder: string;
  at: number;
}

interface View {
  k: number;
  tx: number;
  ty: number;
}

/* ----------------------------- tweened layout ----------------------------- */

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

function useTweened(target: Record<string, P>, sig: string, spawn: (key: string) => P, reduced: boolean): Record<string, P> {
  const [cur, setCur] = useState(target);
  const curRef = useRef(cur);
  const spawnRef = useRef(spawn);
  spawnRef.current = spawn;
  useEffect(() => {
    if (reduced) {
      curRef.current = target;
      setCur(target);
      return;
    }
    const from: Record<string, P> = {};
    for (const k of Object.keys(target)) from[k] = curRef.current[k] ?? spawnRef.current(k);
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const e = ease(Math.min(1, (t - t0) / 750));
      const next: Record<string, P> = {};
      for (const k of Object.keys(target)) {
        const a = from[k]!;
        const b = target[k]!;
        next[k] = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
      }
      curRef.current = next;
      setCur(next);
      if (e < 1 && !document.hidden) raf = requestAnimationFrame(step);
      else if (e < 1) {
        curRef.current = target;
        setCur(target);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, reduced]);
  return cur;
}

/* ------------------------------ particle engine ----------------------------- */

interface Particle {
  from: () => P;
  to: () => P;
  color: string;
  t0: number;
  dur: number;
  g: SVGGElement;
  dots: SVGCircleElement[];
  bow: number;
  fromR: number;
  toR: number;
  onArrive?: () => void;
}

function useParticles(layer: React.RefObject<SVGGElement>, enabled: boolean) {
  const list = useRef<Particle[]>([]);
  const raf = useRef(0);

  const clear = useCallback(() => {
    for (const p of list.current) p.g.remove();
    list.current = [];
    cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  const frame = useCallback((t: number) => {
    raf.current = 0;
    const alive: Particle[] = [];
    for (const p of list.current) {
      const u = (t - p.t0) / p.dur;
      if (u < 0) {
        alive.push(p);
        p.g.style.opacity = "0";
        continue;
      }
      if (u >= 1) {
        p.g.remove();
        p.onArrive?.();
        continue;
      }
      p.g.style.opacity = u > 0.9 ? String((1 - u) * 10) : "1";
      const a0 = p.from();
      const b0 = p.to();
      const dx = b0.x - a0.x;
      const dy = b0.y - a0.y;
      const L = Math.hypot(dx, dy) || 1;
      const a = { x: a0.x + (dx / L) * p.fromR, y: a0.y + (dy / L) * p.fromR };
      const b = { x: b0.x - (dx / L) * p.toR, y: b0.y - (dy / L) * p.toR };
      // Quick launch, gentle arrival.
      const e = 1 - Math.pow(1 - u, 2.2);
      p.dots.forEach((c, i) => {
        const lag = i === 0 ? 0 : (i - 1) * 0.028;
        const pt = bowPoint(a, b, Math.max(0, e - lag), p.bow);
        c.setAttribute("cx", pt.x.toFixed(1));
        c.setAttribute("cy", pt.y.toFixed(1));
      });
      alive.push(p);
    }
    list.current = alive;
    if (alive.length && !document.hidden) raf.current = requestAnimationFrame(frame);
  }, []);

  const kick = useCallback(() => {
    if (!raf.current && !document.hidden) raf.current = requestAnimationFrame(frame);
  }, [frame]);

  const spawn = useCallback(
    (from: () => P, to: () => P, color: string, delay = 0, onArrive?: () => void, toR = AGENT_R + 6, dur = 1250) => {
      const root = layer.current;
      if (!enabled || !root || document.hidden) return;
      if (list.current.length > 80) return;
      const g = document.createElementNS(SVGNS, "g");
      g.setAttribute("class", "vm-particle");
      g.style.setProperty("--pc", color);
      g.style.opacity = "0";
      // [radius, opacity] head first: a halo, the core, then a fading comet tail.
      const spec: [number, number, string][] = [
        [13, 0.2, "halo"],
        [5, 1, "core"],
        [4.2, 0.7, "trail"],
        [3.6, 0.55, "trail"],
        [3, 0.42, "trail"],
        [2.5, 0.3, "trail"],
        [2, 0.2, "trail"],
        [1.6, 0.12, "trail"],
      ];
      const dots = spec.map(([r, o, cls]) => {
        const c = document.createElementNS(SVGNS, "circle");
        c.setAttribute("r", String(r));
        c.setAttribute("class", cls);
        c.style.opacity = String(o);
        return c;
      });
      // Paint tail first so the core sits on top.
      for (let i = dots.length - 1; i >= 0; i--) g.appendChild(dots[i]!);
      root.appendChild(g);
      list.current.push({ from, to, color, t0: performance.now() + delay, dur, g, dots, bow: 0.16, fromR: AGENT_R + 4, toR, onArrive });
      kick();
    },
    [enabled, kick, layer]
  );

  const ping = useCallback(
    (at: P, color: string, r = 10) => {
      const root = layer.current;
      if (!enabled || !root || document.hidden) return;
      const c = document.createElementNS(SVGNS, "circle");
      c.setAttribute("cx", String(at.x));
      c.setAttribute("cy", String(at.y));
      c.setAttribute("r", String(r));
      c.setAttribute("class", "vm-ping");
      c.style.setProperty("--pc", color);
      root.appendChild(c);
      setTimeout(() => c.remove(), 900);
    },
    [enabled, layer]
  );

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) clear();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clear();
    };
  }, [clear]);

  useEffect(() => {
    if (!enabled) clear();
  }, [enabled, clear]);

  return { spawn, ping };
}

/* --------------------------------- helpers --------------------------------- */

function labelWidth(p: ParticipantView): number {
  const name = p.name.length * 7.4;
  const model = (p.model ?? "").length * 6.1;
  return Math.min(170, Math.max(name, model) + 8);
}

function wrapName(name: string, max = 15): string[] {
  if (name.length <= max) return [name];
  const words = name.split(/\s+/);
  const lines: string[] = [""];
  for (const w of words) {
    const cur = lines[lines.length - 1]!;
    if (cur && (cur + " " + w).length > max) lines.push(w);
    else lines[lines.length - 1] = cur ? `${cur} ${w}` : w;
  }
  return lines.slice(0, 2).map((l, i, a) => (i === a.length - 1 && lines.length > 2 ? truncate(l + "…", max) : truncate(l, max + 1)));
}

function onActivate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

function eventKey(ev: ServerEvent, i: number): string {
  return `${ev.type}:${ev.ts}:${ev.seq ?? ""}:${i}`;
}

/* --------------------------------- component -------------------------------- */

export function RoomMap(props: VizProps): JSX.Element {
  const { snapshot, leases, branches, events, audit, theme, onSelectAgent, onOpenTab } = props;
  const reduced = useReducedMotion();
  const now = useNow(1000);
  const [rootRef, size] = useSize<HTMLDivElement>();
  const particleLayer = useRef<SVGGElement>(null);
  const { spawn, ping } = useParticles(particleLayer, !reduced);
  const [tip, setTip] = useState<TipState | null>(null);
  const [collisions, setCollisions] = useState<Collision[]>([]);
  const [legendOpen, setLegendOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 640);

  /* --- participants on the orbit --- */
  const people = useMemo(() => {
    const list = snapshot.participants.filter((p) => p.kind === "agent" || p.kind === "human");
    if (!list.some((p) => p.kind === "human")) {
      list.unshift({
        id: snapshot.you.id,
        name: snapshot.you.name,
        kind: "human",
        status: "active",
        claimedFiles: [],
        lastSeen: Date.now(),
        listening: false,
        idle: false,
      });
    }
    // Only the first human (you) sits on the orbit; any extra humans join as plain nodes.
    return list;
  }, [snapshot.participants, snapshot.you]);
  const agents = people.filter((p) => p.kind === "agent");
  const byName = useMemo(() => new Map(people.map((p) => [p.name, p])), [people]);
  const human = people.find((p) => p.kind === "human")!;

  /* --- files: live locks grouped by path, plus fading ghosts --- */
  const fileGroups = useMemo(() => {
    const m = new Map<string, LockView[]>();
    for (const l of snapshot.locks) {
      const arr = m.get(l.path) ?? [];
      arr.push(l);
      m.set(l.path, arr);
    }
    return m;
  }, [snapshot.locks]);

  const ghosts = useRef(new Map<string, Ghost>());
  const lastFilePos = useRef(new Map<string, { pos: P; holder: string }>());
  const seededGhosts = useRef(false);
  // Seed ghosts once from recent audit claims that are no longer held.
  if (!seededGhosts.current && audit.length) {
    seededGhosts.current = true;
    const t = Date.now();
    for (const a of audit) {
      if (a.type !== "lease.claim" || t - a.ts > GHOST_MS) continue;
      const paths = (a.payload?.paths as string[] | undefined) ?? [];
      for (const path of paths) {
        if (fileGroups.has(path) || ghosts.current.has(path)) continue;
        ghosts.current.set(path, { pos: { x: NaN, y: NaN }, holder: a.actorName ?? "", since: a.ts });
      }
    }
  }
  // Released since last render → becomes a ghost where it was.
  for (const [path, last] of lastFilePos.current) {
    if (!fileGroups.has(path) && !ghosts.current.has(path)) ghosts.current.set(path, { pos: last.pos, holder: last.holder, since: now });
  }
  for (const [path, g] of ghosts.current) {
    if (fileGroups.has(path) || now - g.since > GHOST_MS) ghosts.current.delete(path);
  }

  /* --- layout --- */
  const orbitIn: OrbitInput[] = useMemo(
    () =>
      people
        .filter((p) => p.kind === "agent" || p === human)
        .map((p) => ({ name: p.name, human: p.kind === "human", off: agentState(p) === "off", labelW: labelWidth(p) })),
    [people, human]
  );
  const fileIn: FileInput[] = [];
  for (const [path, locks] of fileGroups) fileIn.push({ key: path, label: shortPath(path), holders: locks.map((l) => l.heldByName) });
  for (const [path, g] of ghosts.current) {
    fileIn.push({ key: path, label: shortPath(path), holders: [], pinned: Number.isFinite(g.pos.x) ? g.pos : undefined, near: g.holder });
  }
  const layoutSig = JSON.stringify([size.w > 0 && size.w < 560, orbitIn, fileIn.map((f) => [f.key, f.holders, f.pinned && [Math.round(f.pinned.x), Math.round(f.pinned.y)], f.near])]);
  const compact = size.w > 0 && size.w < 560;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => computeLayout(orbitIn, fileIn, compact), [layoutSig, compact]);
  const targets = useMemo(() => ({ hub: { x: 0, y: 0 }, ...layout.pos }), [layout]);

  const spawnPos = useCallback(
    (key: string): P => {
      if (key.startsWith("f:")) {
        const path = key.slice(2);
        const holder = fileGroups.get(path)?.[0]?.heldByName ?? ghosts.current.get(path)?.holder;
        const hp = holder ? layout.pos[`a:${holder}`] : undefined;
        return hp ?? { x: 0, y: 0 };
      }
      return { x: 0, y: 0 };
    },
    [fileGroups, layout]
  );
  const pos = useTweened(targets, layoutSig, spawnPos, reduced);
  const posRef = useRef(pos);
  posRef.current = pos;
  // Remember where every live chip is (for ghosts), and pin unplaced ghosts.
  for (const [path, locks] of fileGroups) {
    const p = layout.pos[`f:${path}`];
    if (p) lastFilePos.current.set(path, { pos: p, holder: locks[0]!.heldByName });
  }
  for (const path of [...lastFilePos.current.keys()]) if (!fileGroups.has(path)) lastFilePos.current.delete(path);
  for (const [path, g] of ghosts.current) {
    if (!Number.isFinite(g.pos.x) && layout.pos[`f:${path}`]) g.pos = layout.pos[`f:${path}`]!;
  }

  /* --- zoom + pan --- */
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const [auto, setAuto] = useState(true);
  const [dragging, setDragging] = useState(false);
  const fitView = useCallback((): View => {
    const { minX, minY, maxX, maxY } = layout.bounds;
    const pad = size.w < 520 ? 16 : 40;
    const bw = maxX - minX + pad * 2;
    const bh = maxY - minY + pad * 2;
    const k = Math.max(0.3, Math.min(1.35, size.w / bw, size.h / bh));
    return { k, tx: size.w / 2 - ((minX + maxX) / 2) * k, ty: size.h / 2 - ((minY + maxY) / 2) * k };
  }, [layout.bounds, size.w, size.h]);
  useEffect(() => {
    if (auto && size.w > 0) setView(fitView());
  }, [auto, fitView, size.w]);

  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const zoomAt = useCallback((sx: number, sy: number, factor: number) => {
    const v = viewRef.current;
    const k = Math.max(0.25, Math.min(3, v.k * factor));
    const r = k / v.k;
    setAuto(false);
    setView({ k, tx: sx - (sx - v.tx) * r, ty: sy - (sy - v.ty) * r });
  }, []);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const drag = useRef<{ x: number; y: number; tx: number; ty: number; id: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty, id: e.pointerId, moved: false };
    suppressClick.current = false;
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
      setTip(null);
      svgRef.current?.setPointerCapture(e.pointerId);
    }
    setAuto(false);
    setView((v) => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }));
  };
  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.moved) suppressClick.current = true;
    drag.current = null;
    setDragging(false);
  };
  const guarded = (fn: () => void) => () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    fn();
  };

  /* --- live motion from messages + events --- */
  const seenSeq = useRef<Set<number> | null>(null);
  const seenEv = useRef<Set<string> | null>(null);
  const nodeAt = useCallback((name: string) => () => posRef.current[`a:${name}`] ?? { x: 0, y: 0 }, []);
  const hubAt = useCallback(() => ({ x: 0, y: 0 }), []);

  const fireMessage = useCallback(
    (m: Pick<ThreadEntry, "author" | "kind" | "mentions" | "text" | "importance">, delay: number) => {
      const author = byName.get(m.author);
      if (m.kind === "system" || !author) {
        setTimeout(() => ping({ x: 0, y: 0 }, m.importance === "interrupt" ? "var(--clay)" : "var(--copper)", HUB_R), delay);
        return;
      }
      const from = nodeAt(author.name);
      const all = m.mentions.some((x) => x.toLowerCase() === "all") || /(^|\s)@all\b/i.test(m.text);
      const targets = all
        ? agents.filter((a) => a.name !== author.name && agentState(a) !== "off").map((a) => a.name)
        : m.mentions.filter((x) => byName.has(x) && x !== author.name);
      if (targets.length) {
        targets.forEach((t, i) =>
          spawn(from, nodeAt(t), "var(--saffron)", delay + i * 90, () => ping(posRef.current[`a:${t}`] ?? { x: 0, y: 0 }, "var(--saffron)", 30))
        );
      } else {
        spawn(
          from,
          hubAt,
          m.importance === "interrupt" ? "var(--clay)" : colorOf(author),
          delay,
          () => ping({ x: 0, y: 0 }, colorOf(author), HUB_R),
          HUB_R + 4
        );
      }
    },
    [agents, byName, hubAt, nodeAt, ping, spawn]
  );

  useEffect(() => {
    // Messages: diff the thread by seq (covers both WS pushes and polling refreshes).
    if (!seenSeq.current) {
      seenSeq.current = new Set(snapshot.thread.map((m) => m.seq));
    } else {
      let delay = 0;
      for (const m of snapshot.thread) {
        if (seenSeq.current.has(m.seq)) continue;
        seenSeq.current.add(m.seq);
        fireMessage(m, delay);
        delay += 180;
      }
    }
  }, [snapshot.thread, fireMessage]);

  const addCollision = useCallback(
    (c: Omit<Collision, "id">) => {
      setCollisions((cs) => {
        if (cs.some((x) => x.path === c.path && x.by === c.by && Math.abs(x.at - c.at) < 3000)) return cs;
        return [...cs, { ...c, id: `${c.path}:${c.by}:${c.at}` }];
      });
    },
    []
  );

  useEffect(() => {
    if (!seenEv.current) {
      seenEv.current = new Set(events.map(eventKey));
      return;
    }
    events.forEach((ev, i) => {
      const k = eventKey(ev, i);
      if (seenEv.current!.has(k)) return;
      seenEv.current!.add(k);
      const data = ev.data as Record<string, unknown> | null;
      if (ev.type === "message") {
        const msg = data?.message as { seq?: number; authorName?: string; kind?: ThreadEntry["kind"]; mentions?: string[]; text?: string; importance?: ThreadEntry["importance"]; editedAt?: number; retractedAt?: number } | undefined;
        if (!msg || msg.seq === undefined || msg.editedAt || msg.retractedAt) return;
        if (seenSeq.current?.has(msg.seq)) return;
        seenSeq.current?.add(msg.seq);
        fireMessage(
          { author: msg.authorName ?? "", kind: msg.kind ?? "agent", mentions: msg.mentions ?? [], text: msg.text ?? "", importance: msg.importance ?? "info" },
          0
        );
      } else if (ev.type === "collision") {
        const conflicts = (data?.conflicts as { path: string; heldByName: string }[] | undefined) ?? [];
        for (const c of conflicts) addCollision({ path: c.path, by: String(data?.by ?? ""), holder: c.heldByName, at: Date.now() });
      } else if (ev.type === "approval") {
        const ap = data?.approval as { requestedByName?: string; status?: string } | undefined;
        if (ap?.status === "pending" && ap.requestedByName && byName.has(ap.requestedByName))
          spawn(nodeAt(ap.requestedByName), nodeAt(human.name), "var(--saffron)", 0, () =>
            ping(posRef.current[`a:${human.name}`] ?? { x: 0, y: 0 }, "var(--saffron)", 28)
          );
      }
    });
    if (seenEv.current.size > 1200) seenEv.current = new Set(events.map(eventKey));
  }, [events, fireMessage, addCollision, spawn, ping, nodeAt, byName, human.name]);

  // Collisions from the audit trail too (for hosts that don't pass events).
  const seenAudit = useRef<Set<string> | null>(null);
  useEffect(() => {
    const cols = audit.filter((a) => a.type === "lease.collision");
    if (!seenAudit.current) {
      seenAudit.current = new Set(cols.map((a) => a.id));
      return;
    }
    for (const a of cols) {
      if (seenAudit.current.has(a.id)) continue;
      seenAudit.current.add(a.id);
      const conflicts = (a.payload?.conflicts as { path: string; heldByName: string }[] | undefined) ?? [];
      for (const c of conflicts) addCollision({ path: c.path, by: a.actorName ?? "", holder: c.heldByName, at: Date.now() });
    }
  }, [audit, addCollision]);

  useEffect(() => {
    if (!collisions.length) return;
    const t = setTimeout(() => setCollisions((cs) => cs.filter((c) => Date.now() - c.at < COLLISION_MS)), 400);
    return () => clearTimeout(t);
  }, [collisions, now]);

  /* --- derived badges --- */
  const diffs = useMemo(() => diffStats(branches), [branches]);
  const approvalsBy = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of snapshot.pendingApprovals) m.set(a.requestedBy, [...(m.get(a.requestedBy) ?? []), a.action]);
    return m;
  }, [snapshot.pendingApprovals]);
  const tasksBy = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const t of snapshot.tasks) if (t.ownerName && (t.status === "in_progress" || t.status === "open"))
      m.set(t.ownerName, [...(m.get(t.ownerName) ?? []), t.title]);
    return m;
  }, [snapshot.tasks]);
  const collidingPaths = new Set(collisions.map((c) => c.path));

  /* --- tooltips --- */
  const show = (el: Element, content: ReactNode) => {
    if (drag.current?.moved || !rootRef.current) return;
    setTip({ ...anchorOf(el, rootRef.current), content });
  };
  const hide = () => setTip(null);

  const agentTip = (p: ParticipantView): ReactNode => {
    const st = agentState(p);
    const held = snapshot.locks.filter((l) => l.heldBy === p.id).map((l) => l.path);
    const owned = tasksBy.get(p.name) ?? [];
    const doing = p.kind === "agent" ? doingOf(snapshot, p) : null;
    const d = diffs.get(p.name);
    return (
      <>
        <div className="viz-tip-head">
          <span className="viz-tip-swatch" style={{ background: colorOf(p) }} />
          <strong>{p.name}</strong>
          <span className={`viz-tip-state s-${st}`}>{STATE_LABEL[st]}</span>
        </div>
        {(p.model || p.client) && <div className="viz-tip-sub">{[p.model, p.client].filter(Boolean).join(" in ")}</div>}
        {doing && <div className="viz-tip-line">{doing}</div>}
        {held.length > 0 && (
          <div className="viz-tip-line">
            <span className="viz-tip-k">Holds</span> {held.slice(0, 4).join(", ")}
            {held.length > 4 ? ` +${held.length - 4} more` : ""}
          </div>
        )}
        {owned.length > 0 && (
          <div className="viz-tip-line">
            <span className="viz-tip-k">Tasks</span> {owned.slice(0, 3).map((t) => truncate(t, 40)).join("; ")}
          </div>
        )}
        {approvalsBy.has(p.name) && (
          <div className="viz-tip-line warn">Waiting on your approval to {approvalsBy.get(p.name)!.join(", ")}</div>
        )}
        {d && (
          <div className="viz-tip-line">
            <span className="viz-tip-k">Diff ready</span> <span className="add">+{d.add}</span> <span className="del">−{d.del}</span>
          </div>
        )}
        {p.kind === "agent" && <div className="viz-tip-hint">Click to focus {p.name}</div>}
      </>
    );
  };

  const fileTip = (path: string): ReactNode => {
    const locks = fileGroups.get(path);
    if (!locks) {
      const g = ghosts.current.get(path);
      return (
        <>
          <div className="viz-tip-head">
            <strong className="mono">{path}</strong>
          </div>
          <div className="viz-tip-sub">Free now{g?.holder ? `, last held by ${g.holder}` : ""}</div>
          <div className="viz-tip-hint">Click to open Claims</div>
        </>
      );
    }
    return (
      <>
        <div className="viz-tip-head">
          <strong className="mono">{path}</strong>
        </div>
        {locks.map((l) => {
          const lease = leaseFor(leases, path, l.heldBy);
          return (
            <div key={l.heldBy} className="viz-tip-line">
              <span className="viz-tip-swatch" style={{ background: colorOf(byName.get(l.heldByName)) }} />
              <strong>{l.heldByName}</strong>, {l.exclusive ? "exclusive" : "shared"}, {fmtDur(l.expiresAt - now)} left
              {lease?.reason && <div className="viz-tip-sub">“{truncate(lease.reason, 90)}”</div>}
            </div>
          );
        })}
        <div className="viz-tip-hint">Click to open Claims</div>
      </>
    );
  };

  /* --- render pieces --- */
  const P0 = { x: 0, y: 0 };
  const at = (k: string): P => pos[k] ?? P0;
  const fileCount = fileGroups.size;
  const liveAgents = agents.filter((a) => agentState(a) !== "off");
  const summary =
    `Room map for ${snapshot.room.name}. ${liveAgents.length} agent${liveAgents.length === 1 ? "" : "s"} in the room` +
    (liveAgents.length ? `: ${liveAgents.map((a) => `${a.name} ${STATE_LABEL[agentState(a)].toLowerCase()}`).join(", ")}` : "") +
    `. ${fileCount} file${fileCount === 1 ? "" : "s"} claimed.` +
    (snapshot.handoffs.length ? ` ${snapshot.handoffs.length} hand-off${snapshot.handoffs.length === 1 ? "" : "s"} waiting.` : "") +
    (snapshot.pendingApprovals.length ? ` ${snapshot.pendingApprovals.length} approval${snapshot.pendingApprovals.length === 1 ? "" : "s"} waiting on you.` : "");

  const tethers: ReactNode[] = [];
  const chips: ReactNode[] = [];
  for (const f of fileIn) {
    const key = `f:${f.key}`;
    const cp = at(key);
    const locks = fileGroups.get(f.key);
    const w = layout.chipW[f.key] ?? 80;
    const ghost = !locks;
    const g = ghosts.current.get(f.key);
    const fade = ghost && g ? Math.max(0, 1 - (now - g.since) / GHOST_MS) : 1;
    const exclusive = locks ? locks.some((l) => l.exclusive) : false;
    const holderColor = locks ? colorOf(byName.get(locks[0]!.heldByName)) : "var(--muted-2)";
    if (locks) {
      for (const l of locks) {
        const hp = pos[`a:${l.heldByName}`];
        if (!hp) continue;
        const lease = leaseFor(leases, l.path, l.heldBy);
        const total = lease ? lease.expiresAt - lease.createdAt : 15 * 60_000;
        const frac = Math.max(0, Math.min(1, (l.expiresAt - now) / Math.max(1, total)));
        const { d, len } = bowPath(hp, cp, 0.1);
        let dash: string;
        if (l.exclusive) dash = `${(frac * len).toFixed(1)} ${(len + 10).toFixed(1)}`;
        else {
          const n = Math.max(0, Math.floor((frac * len) / 9));
          dash = n ? `${Array(n).fill("5 4").join(" ")} 0 ${(len + 10).toFixed(1)}` : `0 ${(len + 10).toFixed(1)}`;
        }
        tethers.push(
          <g key={`t:${l.path}:${l.heldBy}`} className={`vm-tether${l.exclusive ? " excl" : " shared"}${frac < 0.15 ? " low" : ""}`} style={{ ["--c" as string]: colorOf(byName.get(l.heldByName)) }}>
            <path className="vm-tether-bed" d={d} />
            <path className="vm-tether-life" d={d} strokeDasharray={dash} />
          </g>
        );
      }
    }
    const label = f.label;
    const aria = locks
      ? `${f.key}, held by ${locks.map((l) => l.heldByName).join(" and ")}, ${exclusive ? "exclusive" : "shared"}, ${fmtDur(locks[0]!.expiresAt - now)} left`
      : `${f.key}, recently released`;
    chips.push(
      <g
        key={key}
        className={`vm-file${exclusive ? " excl" : " shared"}${ghost ? " ghost" : ""}${collidingPaths.has(f.key) ? " collide" : ""}`}
        transform={`translate(${cp.x.toFixed(1)},${cp.y.toFixed(1)})`}
        style={{ ["--c" as string]: holderColor, opacity: ghost ? 0.15 + fade * 0.55 : undefined }}
        tabIndex={0}
        role="button"
        aria-label={aria}
        onPointerEnter={(e) => show(e.currentTarget, fileTip(f.key))}
        onPointerLeave={hide}
        onFocus={(e) => show(e.currentTarget, fileTip(f.key))}
        onBlur={hide}
        onClick={guarded(() => onOpenTab("claims"))}
        onKeyDown={onActivate(() => onOpenTab("claims"))}
      >
        <rect className="vm-file-hit" x={-w / 2 - 4} y={-CHIP_H / 2 - 4} width={w + 8} height={CHIP_H + 8} rx={CHIP_H / 2 + 4} />
        <rect className="vm-file-body" x={-w / 2} y={-CHIP_H / 2} width={w} height={CHIP_H} rx={CHIP_H / 2} />
        {exclusive ? (
          <g transform={`translate(${-w / 2 + 12},0)`} className="vm-file-icon">
            <rect x={-3.5} y={-1.5} width={7} height={5.5} rx={1.2} />
            <path d="M-2,-1.5 V-3.2 a2,2 0 0 1 4,0 V-1.5" />
          </g>
        ) : (
          <g transform={`translate(${-w / 2 + 12},0)`} className="vm-file-icon shared">
            <circle cx={-1.8} r={2.4} />
            <circle cx={1.8} r={2.4} />
          </g>
        )}
        <text className="vm-file-text" x={-w / 2 + 21} y={0.5} dominantBaseline="middle">
          {label}
        </text>
      </g>
    );
  }

  const handoffs = snapshot.handoffs.map((h) => {
    const a = pos[`a:${h.requestedBy}`];
    const b = pos[`a:${h.heldBy}`];
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    const inset = AGENT_R + 12;
    const a2 = { x: a.x + (dx / L) * inset, y: a.y + (dy / L) * inset };
    const b2 = { x: b.x - (dx / L) * inset, y: b.y - (dy / L) * inset };
    const { d } = bowPath(a2, b2, -0.22);
    const mid = bowPoint(a2, b2, 0.3, -0.22);
    const text = `needs ${shortPath(h.path, 18)}`;
    const tw = text.length * 6.2 + 16;
    return (
      <g
        key={h.id}
        className="vm-handoff"
        tabIndex={0}
        role="img"
        aria-label={`${h.requestedBy} is waiting on ${h.heldBy} for ${h.path}`}
        onPointerEnter={(e) =>
          show(
            e.currentTarget,
            <>
              <div className="viz-tip-head">
                <strong>Hand-off waiting</strong>
              </div>
              <div className="viz-tip-line">
                {h.requestedBy} needs <span className="mono">{h.path}</span> from {h.heldBy}
              </div>
              {h.message && <div className="viz-tip-sub">“{truncate(h.message, 100)}”</div>}
            </>
          )
        }
        onPointerLeave={hide}
        onFocus={(e) => show(e.currentTarget, <div className="viz-tip-line">{h.requestedBy} needs {h.path} from {h.heldBy}</div>)}
        onBlur={hide}
      >
        <path className="vm-handoff-path" d={d} markerEnd="url(#vm-arrow)" />
        <g transform={`translate(${mid.x.toFixed(1)},${mid.y.toFixed(1)})`}>
          <rect className="vm-handoff-tag" x={-tw / 2} y={-10} width={tw} height={20} rx={10} />
          <text className="vm-handoff-text" textAnchor="middle" y={0.5} dominantBaseline="middle">
            {text}
          </text>
        </g>
      </g>
    );
  });

  const nodes = people
    .filter((p) => pos[`a:${p.name}`])
    .map((p) => {
      const st = agentState(p);
      const isHuman = p.kind === "human";
      const r = isHuman ? HUMAN_R : AGENT_R;
      const c = pos[`a:${p.name}`]!;
      const d = diffs.get(p.name);
      const asking = approvalsBy.has(p.name);
      const nameLines = wrapName(p.name);
      const sub = isHuman ? "Overseer" : p.model ?? p.client ?? (p.brand ? p.brand[0]!.toUpperCase() + p.brand.slice(1) : "");
      const aria = `${p.name}${p.model ? `, ${p.model}` : ""}, ${STATE_LABEL[st]}${asking ? ", waiting on your approval" : ""}${d ? `, diff ready +${d.add} −${d.del}` : ""}`;
      const act = () => (isHuman ? undefined : onSelectAgent(p.name));
      const ringR = r + 6;
      const circ = 2 * Math.PI * ringR;
      return (
        <g
          key={`a:${p.name}`}
          className={`vm-agent s-${st}${asking ? " asking" : ""}`}
          transform={`translate(${c.x.toFixed(1)},${c.y.toFixed(1)})`}
          style={{ ["--c" as string]: colorOf(p) }}
          tabIndex={0}
          role="button"
          aria-label={aria}
          onPointerEnter={(e) => show(e.currentTarget.querySelector(".vm-face") ?? e.currentTarget, agentTip(p))}
          onPointerLeave={hide}
          onFocus={(e) => show(e.currentTarget.querySelector(".vm-face") ?? e.currentTarget, agentTip(p))}
          onBlur={hide}
          onClick={guarded(act)}
          onKeyDown={onActivate(act)}
        >
          <circle className="vm-hit" r={r + 14} />
          {asking && <circle className="vm-ask-pulse" r={ringR + 2} />}
          {st === "listening" && <circle className="vm-breathe" r={ringR} />}
          <circle className="vm-ring-track" r={ringR} />
          {st === "working" && (
            <circle className="vm-arc" r={ringR} strokeDasharray={`${(circ * 0.28).toFixed(1)} ${circ.toFixed(1)}`} />
          )}
          {st === "listening" && <circle className="vm-ring-live" r={ringR} />}
          {st === "idle" && <circle className="vm-ring-idle" r={ringR} strokeDasharray="2 5" />}
          <circle className="vm-face" r={r} />
          <text className="vm-initials" textAnchor="middle" dominantBaseline="central" style={{ fontSize: r * 0.62 }}>
            {isHuman ? "You" : initials(p.name)}
          </text>
          {nameLines.map((l, i) => (
            <text key={i} className="vm-name" textAnchor="middle" y={r + 22 + i * 15}>
              {l}
            </text>
          ))}
          {sub && (
            <text className="vm-model" textAnchor="middle" y={r + 22 + nameLines.length * 15}>
              {truncate(sub, 24)}
            </text>
          )}
          {asking && (
            <g className="vm-badge ask" transform={`translate(${-r * 0.78},${-r * 0.82})`}>
              <circle r={11} />
              {/* raised hand */}
              <path
                d="M-3.6,1.2 V-3.4 a0.9,0.9 0 0 1 1.8,0 V-0.6 M-1.8,-0.8 V-5 a0.9,0.9 0 0 1 1.8,0 V-0.8 M0,-0.8 V-4.4 a0.9,0.9 0 0 1 1.8,0 V-0.4 M1.8,-0.2 V-2.8 a0.9,0.9 0 0 1 1.8,0 V1.6 C3.6,4.4 2,5.8 -0.2,5.8 C-2,5.8 -3,5 -3.9,3.6 L-5.4,1.2 a0.9,0.9 0 0 1 1.5,-1"
              />
            </g>
          )}
          {d && (
            <g className="vm-badge diff" transform={`translate(${r * 0.55},${-r - 4})`}>
              <rect x={0} y={-9} width={`+${d.add} −${d.del}`.length * 6.3 + 12} height={18} rx={9} />
              <text x={6} y={0.5} dominantBaseline="middle">
                <tspan className="add">+{d.add}</tspan>
                <tspan className="del"> −{d.del}</tspan>
              </text>
            </g>
          )}
        </g>
      );
    });

  const collisionMarks = collisions.map((c) => {
    const fp = pos[`f:${c.path}`] ?? pos[`a:${c.holder}`];
    const a = pos[`a:${c.by}`];
    const b = pos[`a:${c.holder}`];
    return (
      <g key={c.id} className="vm-collision">
        {fp && (
          <g transform={`translate(${fp.x.toFixed(1)},${fp.y.toFixed(1)})`}>
            <circle className="vm-shock" r={16} />
            <circle className="vm-shock s2" r={16} />
          </g>
        )}
        {a && b && (() => {
          const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const ins = AGENT_R + 8;
          const a2 = { x: a.x + ((b.x - a.x) / L) * ins, y: a.y + ((b.y - a.y) / L) * ins };
          const b2 = { x: b.x - ((b.x - a.x) / L) * ins, y: b.y - ((b.y - a.y) / L) * ins };
          const { d, mid } = bowPath(a2, b2, 0.34);
          return (
            <>
              <path className="vm-denied-line" d={d} />
              <g transform={`translate(${mid.x.toFixed(1)},${mid.y.toFixed(1)})`} className="vm-denied-tag">
                <rect x={-44} y={-12} width={88} height={24} rx={12} />
                <path d="M-30,-4 l8,8 M-22,-4 l-8,8" />
                <text x={-17} y={0.5} dominantBaseline="middle">
                  denied
                </text>
              </g>
            </>
          );
        })()}
      </g>
    );
  });

  const empty = agents.length === 0;
  const roomLines = wrapName(snapshot.room.name.replace(/^Demo:\s*/i, ""), 11);
  const k = view.k;

  return (
    <div className={`viz-root vm-root${reduced ? " reduced" : ""}`} data-vt={theme} ref={rootRef}>
      <svg
        ref={svgRef}
        className={`vm-svg${dragging ? " dragging" : ""}`}
        width={size.w}
        height={size.h}
        role="group"
        aria-roledescription="room map"
        aria-label={summary}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <radialGradient id="vm-hub-glow">
            <stop offset="0%" style={{ stopColor: "var(--copper)", stopOpacity: theme === "light" ? 0.32 : 0.42 }} />
            <stop offset="45%" style={{ stopColor: "var(--saffron)", stopOpacity: theme === "light" ? 0.1 : 0.12 }} />
            <stop offset="100%" style={{ stopColor: "var(--saffron)", stopOpacity: 0 }} />
          </radialGradient>
          <radialGradient id="vm-hub-core" cx="40%" cy="35%">
            <stop offset="0%" style={{ stopColor: "var(--saffron)" }} />
            <stop offset="100%" style={{ stopColor: "var(--copper)" }} />
          </radialGradient>
          <marker id="vm-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="vm-arrowhead" />
          </marker>
        </defs>
        <g className="vm-world" transform={`translate(${view.tx.toFixed(1)},${view.ty.toFixed(1)}) scale(${k.toFixed(4)})`}>
          <circle className="vm-orbit" r={layout.orbitR} />
          <circle className="vm-orbit faint" r={layout.orbitR * 1.34} />
          {empty && (
            <g className="vm-waiting">
              {[0, 1, 2].map((i) => (
                <g key={i} className={`vm-sat sat${i}`}>
                  <circle cx={layout.orbitR} cy={0} r={7 - i * 1.5} />
                </g>
              ))}
            </g>
          )}
          {people
            .filter((p) => p.kind === "agent" && pos[`a:${p.name}`])
            .map((p) => {
              const c = pos[`a:${p.name}`]!;
              return <line key={`sp:${p.name}`} className={`vm-spoke s-${agentState(p)}`} x1={0} y1={0} x2={c.x} y2={c.y} style={{ ["--c" as string]: colorOf(p) }} />;
            })}
          {tethers}
          {handoffs}
          <g className="vm-hub" aria-hidden="true">
            <circle className="vm-hub-glow" r={HUB_R * 2.8} fill="url(#vm-hub-glow)" />
            <circle className="vm-hub-ring" r={HUB_R + 8} />
            <circle className="vm-hub-core" r={HUB_R} fill="url(#vm-hub-core)" />
            {(() => {
              const agentsTxt = `${liveAgents.length} agent${liveAgents.length === 1 ? "" : "s"}`;
              const filesTxt = `${fileCount} file${fileCount === 1 ? "" : "s"}`;
              const oneLine = `${agentsTxt} · ${filesTxt}`;
              const sub = agents.length === 0 ? ["no agents yet"] : oneLine.length <= 17 ? [oneLine] : [agentsTxt, filesTxt];
              const lines = [...roomLines.map((t) => ({ t, cls: "vm-hub-name", h: 15 })), ...sub.map((t) => ({ t, cls: "vm-hub-sub", h: 12 }))];
              const total = lines.reduce((a, l) => a + l.h, 0) + 3;
              let y = -total / 2;
              return lines.map((l, i) => {
                const gap = l.cls === "vm-hub-sub" && lines[i - 1]?.cls === "vm-hub-name" ? 3 : 0;
                y += l.h + gap;
                return (
                  <text key={i} className={l.cls} textAnchor="middle" y={y - l.h / 2} dominantBaseline="middle">
                    {l.t}
                  </text>
                );
              });
            })()}
          </g>
          {chips}
          {nodes}
          {collisionMarks}
          <g ref={particleLayer} className="vm-particles" aria-hidden="true" />
        </g>
      </svg>

      {empty && (
        <div className="vm-empty" aria-live="polite">
          <p className="vm-empty-title">Waiting for agents</p>
          <p>Paste the join prompt into Claude Code, Cursor, Codex or Gemini. Each agent lands on this orbit as it joins.</p>
        </div>
      )}

      <div className="vm-controls" role="toolbar" aria-label="Map zoom">
        <button type="button" className="viz-btn icon" aria-label="Zoom in" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.25)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
        </button>
        <button type="button" className="viz-btn icon" aria-label="Zoom out" onClick={() => zoomAt(size.w / 2, size.h / 2, 0.8)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
        </button>
        <button type="button" className={`viz-btn${auto ? " on" : ""}`} aria-pressed={auto} onClick={() => { setAuto(true); setView(fitView()); }}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>
          Fit
        </button>
      </div>

      <div className={`vm-legend${legendOpen ? " open" : ""}`}>
        <button type="button" className="vm-legend-toggle" aria-expanded={legendOpen} onClick={() => setLegendOpen((o) => !o)}>
          Legend
          <svg viewBox="0 0 10 10" aria-hidden="true"><path d={legendOpen ? "M2 6.5l3-3 3 3" : "M2 3.5l3 3 3-3"} /></svg>
        </button>
        {legendOpen && (
          <ul>
            <li><svg viewBox="0 0 22 22" aria-hidden="true"><circle className="lg-live" cx="11" cy="11" r="7" /></svg>Listening</li>
            <li><svg viewBox="0 0 22 22" aria-hidden="true"><circle className="lg-track" cx="11" cy="11" r="7" /><circle className="lg-arc" cx="11" cy="11" r="7" strokeDasharray="12 44" /></svg>Working</li>
            <li><svg viewBox="0 0 22 22" aria-hidden="true"><circle className="lg-idle" cx="11" cy="11" r="7" strokeDasharray="2 3" /></svg>Idle</li>
            <li><svg viewBox="0 0 22 22" aria-hidden="true"><path className="lg-excl" d="M2 11h18" /></svg>Exclusive claim</li>
            <li><svg viewBox="0 0 22 22" aria-hidden="true"><path className="lg-shared" d="M2 11h18" /></svg>Shared claim</li>
            <li><svg viewBox="0 0 22 22" aria-hidden="true"><circle className="lg-msg" cx="11" cy="11" r="3.5" /></svg>Message</li>
            <li><svg viewBox="0 0 22 22" aria-hidden="true"><circle className="lg-mention" cx="11" cy="11" r="3.5" /></svg>Mention</li>
            <li><svg viewBox="0 0 22 22" aria-hidden="true"><path className="lg-col" d="M6 6l10 10M16 6L6 16" /></svg>Collision</li>
            <li><svg viewBox="0 0 22 22" aria-hidden="true"><path className="lg-handoff" d="M2 11h14" markerEnd="url(#vm-arrow)" /></svg>Hand-off</li>
          </ul>
        )}
      </div>

      <Tooltip tip={tip} rootW={size.w} />
    </div>
  );
}
