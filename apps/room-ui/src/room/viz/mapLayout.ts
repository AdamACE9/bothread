/**
 * RoomMap layout: a hand-rolled orbit + tiny collision relaxation. Agents sit on a
 * ring around the hub (the human anchored at the bottom), departed agents drift
 * outward, and each claimed file is a chip fanned out behind its holder. One pass
 * of rectangle de-overlap keeps chips legible at ~10 agents / ~50 files without a
 * physics dependency, and the result is deterministic (no jitter between renders).
 */

export interface P {
  x: number;
  y: number;
}

export const HUB_R = 56;
export const AGENT_R = 28;
export const HUMAN_R = 24;
export const CHIP_H = 22;
/** Agent label block below the circle (name + model). */
const LABEL_H = 38;

export interface OrbitInput {
  name: string;
  human: boolean;
  off: boolean;
  /** Approximate label width in px (name/model, whichever is longer). */
  labelW: number;
}

export interface FileInput {
  key: string;
  label: string;
  /** Holder names; the first is the anchor. Empty for ghosts. */
  holders: string[];
  /** Ghost (recently released) chips keep their last position. */
  pinned?: P;
  /** Fallback anchor when there is no holder on the map. */
  near?: string;
}

export interface Layout {
  pos: Record<string, P>;
  angle: Record<string, number>;
  chipW: Record<string, number>;
  orbitR: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export function chipWidth(label: string): number {
  return Math.round(label.length * 6.7 + 30);
}

interface Box {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Offset of the box center from the node point (agents carry labels below). */
  oy: number;
  fixed: boolean;
  tx: number;
  ty: number;
}

export function computeLayout(orbit: OrbitInput[], files: FileInput[], compact = false): Layout {
  const pos: Record<string, P> = {};
  const angle: Record<string, number> = {};
  const chipW: Record<string, number> = {};
  const n = orbit.length;
  const widest = orbit.reduce((m, o) => Math.max(m, o.labelW), 90);
  // Ring big enough that neighbours' labels don't touch: circumference ≥ n × (label + gap).
  const minR = compact ? 132 : 190;
  const orbitR = Math.max(minR, Math.min(360, (n * (Math.max(widest, 96) + 26)) / (2 * Math.PI)));

  // Slots: evenly spaced from the top; the human takes the slot nearest the bottom.
  const slots = Math.max(n, 1);
  const humanIdx = orbit.findIndex((o) => o.human);
  const order: OrbitInput[] = [];
  const bottom = Math.round(slots / 2);
  const others = orbit.filter((o) => !o.human);
  let oi = 0;
  for (let k = 0; k < slots; k++) {
    if (humanIdx >= 0 && k === bottom && slots > 1) order.push(orbit[humanIdx]!);
    else if (oi < others.length) order.push(others[oi++]!);
  }
  if (humanIdx >= 0 && slots === 1) order.splice(0, order.length, orbit[humanIdx]!);
  order.forEach((o, k) => {
    // Lone human: put it below the hub. Otherwise spread from the top.
    const a = slots === 1 && o.human ? Math.PI / 2 : -Math.PI / 2 + (2 * Math.PI * k) / slots;
    const r = o.off ? orbitR * 1.34 : o.human ? orbitR * 0.92 : orbitR;
    pos[`a:${o.name}`] = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    angle[`a:${o.name}`] = a;
  });

  // Files: fan out on the far side of the holder, two staggered rows.
  const byHolder = new Map<string, FileInput[]>();
  for (const f of files) {
    chipW[f.key] = chipWidth(f.label);
    const anchor = f.holders.find((h) => pos[`a:${h}`]) ?? (f.near && pos[`a:${f.near}`] ? f.near : undefined);
    if (f.pinned) continue;
    const list = byHolder.get(anchor ?? "") ?? [];
    list.push(f);
    byHolder.set(anchor ?? "", list);
  }
  for (const f of files) if (f.pinned) pos[`f:${f.key}`] = { ...f.pinned };
  for (const [holder, list] of byHolder) {
    const base = pos[`a:${holder}`];
    const a0 = base ? angle[`a:${holder}`]! : Math.PI * 0.25;
    const from = base ?? { x: Math.cos(a0) * orbitR * 0.5, y: Math.sin(a0) * orbitR * 0.5 };
    const m = list.length;
    const step = Math.min(0.42, 2.5 / Math.max(m, 1));
    list.forEach((f, i) => {
      const a = a0 + (i - (m - 1) / 2) * step;
      const d = (compact ? 78 : 98) + (i % 2) * 40 + Math.floor(i / 10) * 44;
      pos[`f:${f.key}`] = { x: from.x + Math.cos(a) * d, y: from.y + Math.sin(a) * d };
    });
  }

  // De-overlap: hub + agents are fixed, chips move.
  const boxes: Box[] = [{ key: "hub", x: 0, y: 0, w: HUB_R * 2 + 20, h: HUB_R * 2 + 20, oy: 0, fixed: true, tx: 0, ty: 0 }];
  for (const o of order) {
    const p = pos[`a:${o.name}`]!;
    const r = o.human ? HUMAN_R : AGENT_R;
    const h = r * 2 + 14 + LABEL_H;
    boxes.push({ key: `a:${o.name}`, x: p.x, y: p.y, w: Math.max(r * 2 + 18, o.labelW + 8), h, oy: h / 2 - r - 7, fixed: true, tx: p.x, ty: p.y });
  }
  for (const f of files) {
    const p = pos[`f:${f.key}`];
    if (!p) continue;
    boxes.push({ key: `f:${f.key}`, x: p.x, y: p.y, w: chipW[f.key]! + 6, h: CHIP_H + 6, oy: 0, fixed: !!f.pinned, tx: p.x, ty: p.y });
  }
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      const A = boxes[i]!;
      for (let j = i + 1; j < boxes.length; j++) {
        const B = boxes[j]!;
        if (A.fixed && B.fixed) continue;
        const dx = B.x - A.x;
        const dy = B.y + B.oy - (A.y + A.oy);
        const ox = (A.w + B.w) / 2 - Math.abs(dx);
        const oy = (A.h + B.h) / 2 - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const shareA = A.fixed ? 0 : B.fixed ? 1 : 0.5;
        const shareB = 1 - shareA;
        if (ox < oy * 1.6) {
          const s = (dx === 0 ? (i % 2 ? 1 : -1) : Math.sign(dx)) * (ox + 0.5);
          A.x -= s * shareA;
          B.x += s * shareB;
        } else {
          const s = (dy === 0 ? (j % 2 ? 1 : -1) : Math.sign(dy)) * (oy + 0.5);
          A.y -= s * shareA;
          B.y += s * shareB;
        }
      }
    }
    for (const b of boxes) {
      if (b.fixed) continue;
      b.x += (b.tx - b.x) * 0.02;
      b.y += (b.ty - b.y) * 0.02;
    }
    if (!moved) break;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.key.startsWith("f:")) pos[b.key] = { x: Math.round(b.x), y: Math.round(b.y) };
    minX = Math.min(minX, b.x - b.w / 2);
    maxX = Math.max(maxX, b.x + b.w / 2);
    minY = Math.min(minY, b.y + b.oy - b.h / 2);
    maxY = Math.max(maxY, b.y + b.oy + b.h / 2);
  }
  // Keep the hub's glow and the orbit ring in frame.
  minX = Math.min(minX, -orbitR - 30);
  maxX = Math.max(maxX, orbitR + 30);
  minY = Math.min(minY, -orbitR - 30);
  maxY = Math.max(maxY, orbitR + 30);
  return { pos, angle, chipW, orbitR, bounds: { minX, minY, maxX, maxY } };
}

/** A gently bowed thread between two points (quadratic), bowing clockwise. */
export function bowPath(a: P, b: P, bow = 0.12): { d: string; len: number; mid: P } {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const cx = mx - dy * bow;
  const cy = my + dx * bow;
  const chord = Math.hypot(dx, dy);
  const len = chord * (1 + (8 / 3) * bow * bow);
  return {
    d: `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`,
    len,
    mid: { x: 0.25 * a.x + 0.5 * cx + 0.25 * b.x, y: 0.25 * a.y + 0.5 * cy + 0.25 * b.y },
  };
}

/** Point on the same quadratic as bowPath at t∈[0,1]. */
export function bowPoint(a: P, b: P, t: number, bow = 0.12): P {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const cx = mx - (b.y - a.y) * bow;
  const cy = my + (b.x - a.x) * bow;
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y };
}
