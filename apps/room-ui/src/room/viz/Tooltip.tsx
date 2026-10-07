import type { ReactNode } from "react";

export interface TipState {
  /** Anchor relative to the viz root (px): top-center of the hovered thing, plus its height. */
  x: number;
  y: number;
  h?: number;
  content: ReactNode;
}

/** Floating card anchored above a point; flips below near the top and clamps to the root's width. */
export function Tooltip({ tip, rootW }: { tip: TipState | null; rootW: number }) {
  if (!tip) return null;
  const W = Math.min(280, Math.max(160, rootW - 24));
  const left = Math.max(12, Math.min(tip.x - W / 2, rootW - W - 12));
  const below = tip.y < 170;
  return (
    <div
      className={`viz-tip${below ? " below" : ""}`}
      role="tooltip"
      style={{ left, top: below ? tip.y + (tip.h ?? 0) + 10 : tip.y - 10, width: W }}
    >
      {tip.content}
    </div>
  );
}

/** Anchor for a DOM/SVG element relative to a root element (top-center of the element). */
export function anchorOf(el: Element, root: Element): { x: number; y: number; h: number } {
  const r = el.getBoundingClientRect();
  const o = root.getBoundingClientRect();
  return { x: r.left + r.width / 2 - o.left, y: r.top - o.top, h: r.height };
}
