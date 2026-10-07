import { useId, type ReactNode } from "react";
import { brandKey } from "./ui";

/* ---------------------------------------------------------------------------
 * Tiny SVG charts for the room: sparklines, a progress ring, a segmented bar
 * and a +/- diff bar. No chart library: each is a handful of paths, sized in
 * CSS pixels, colored with Loom tokens so light and dark both work.
 * Marks follow one spec: 2px lines, ~10% area washes, round data ends, a 2px
 * surface gap between touching segments, a surface ring on end dots.
 * ------------------------------------------------------------------------- */

/** The CSS color for an agent's brand (falls back to a neutral ink). */
export function brandColor(brand?: string | null): string {
  const k = brandKey(brand);
  return k ? `var(--${k})` : "var(--muted)";
}

/** Counts timestamps into `n` equal buckets covering the `windowMs` before `now`. */
export function bucketize(times: number[], now: number, windowMs: number, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  const start = now - windowMs;
  const size = windowMs / n;
  for (const t of times) {
    // A timestamp a little ahead of a coarse clock still belongs to the newest bucket.
    if (t < start || t > now + 60_000) continue;
    const i = Math.min(n - 1, Math.floor((t - start) / size));
    out[i]! += 1;
  }
  return out;
}

export function Sparkline({
  values,
  width = 96,
  height = 28,
  color = "var(--copper)",
  label,
  area = true,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  label?: string;
  area?: boolean;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const n = values.length;
  const max = Math.max(1, ...values);
  const pad = 4;
  const x = (i: number) => (n <= 1 ? width / 2 : pad + (i * (width - pad * 2)) / (n - 1));
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);
  // A gentle monotone-ish curve: midpoint quadratic smoothing keeps peaks honest.
  let d = "";
  values.forEach((v, i) => {
    const px = x(i);
    const py = y(v);
    if (i === 0) d = `M${px},${py}`;
    else {
      const prevX = x(i - 1);
      const prevY = y(values[i - 1]!);
      const mx = (prevX + px) / 2;
      d += ` C${mx},${prevY} ${mx},${py} ${px},${py}`;
    }
  });
  const last = values[n - 1] ?? 0;
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <svg className={`spark${className ? ` ${className}` : ""}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? `${total} in this window`}>
      {label && <title>{label}</title>}
      <line x1={pad} x2={width - pad} y1={height - pad + 0.5} y2={height - pad + 0.5} className="spark-base" />
      {n > 1 && area && <path d={`${d} L${x(n - 1)},${height - pad} L${x(0)},${height - pad} Z`} fill={`url(#sg-${id})`} />}
      {n > 1 && <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
      {n > 0 && <circle cx={x(n - 1)} cy={y(last)} r={3.2} fill={color} className="spark-dot" />}
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Ring({
  value,
  total,
  size = 40,
  stroke = 4,
  color = "var(--teal)",
  children,
  label,
}: {
  value: number;
  total: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <span className="ring" style={{ width: size, height: size }} role="img" aria-label={label ?? `${value} of ${total}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="ring-track" strokeWidth={stroke} />
        {frac > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * frac} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className="ring-fill"
          />
        )}
      </svg>
      {children && <span className="ring-center">{children}</span>}
    </span>
  );
}

/** A single horizontal bar split into colored segments with a 2px surface gap. */
export function SegBar({
  segments,
  height = 8,
  className,
}: {
  segments: { key: string; value: number; color: string; label: string }[];
  height?: number;
  className?: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (!total) return <span className={`segbar empty${className ? ` ${className}` : ""}`} style={{ height }} />;
  return (
    <span className={`segbar${className ? ` ${className}` : ""}`} style={{ height }} role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(", ")}>
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <span key={s.key} className="seg" style={{ flexGrow: s.value, background: s.color }} title={`${s.label}: ${s.value}`} />
        ))}
    </span>
  );
}

/** Additions vs deletions as one split bar (teal grows right, clay grows left). */
export function DiffBar({ adds, dels, width = 72, height = 6 }: { adds: number; dels: number; width?: number; height?: number }) {
  const total = adds + dels;
  const a = total ? Math.max(adds ? 0.08 : 0, adds / total) : 0;
  return (
    <span className="diffbar" style={{ width, height }} role="img" aria-label={`${adds} added, ${dels} removed`} title={`+${adds} −${dels}`}>
      {total === 0 ? null : (
        <>
          {adds > 0 && <span className="db-add" style={{ flexGrow: a }} />}
          {dels > 0 && <span className="db-del" style={{ flexGrow: 1 - a }} />}
        </>
      )}
    </span>
  );
}

/** Five fixed blocks like GitHub's diffstat: reads at a glance, never misleads on scale. */
export function DiffBlocks({ adds, dels }: { adds: number; dels: number }) {
  const total = adds + dels;
  const greens = total ? Math.round((adds / total) * 5) : 0;
  return (
    <span className="diffblocks" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={total === 0 ? "" : i < greens ? "a" : "d"} />
      ))}
    </span>
  );
}
