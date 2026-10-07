/**
 * Timeline: the session as swimlanes. One lane per participant, time on a
 * shared horizontal axis; messages are dots, claims are bars, collisions and
 * hand-offs connect lanes, approvals are diamonds, finished tasks are checks.
 * A compact summary strip above shows the whole session at a glance.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Avatar, presence } from "../../ui";
import { STATE_LABEL, agentState, colorKey, colorOf, fmtClock, fmtDur, truncate, useNow, useReducedMotion, useSize } from "./model";
import {
  buildTimeline,
  claimSeries,
  msgSeries,
  tickStep,
  type ApprovalMark,
  type ClaimMark,
  type Lane,
  type MsgMark,
} from "./timelineModel";
import { Tooltip, anchorOf, type TipState } from "./Tooltip";
import type { VizProps } from "./types";
import "./viz.css";

type Scale = "10m" | "1h" | "all" | "custom";
const WINDOW: Record<"10m" | "1h", number> = { "10m": 10 * 60_000, "1h": 60 * 60_000 };
const AXIS_H = 30;
const DOT_Y = 17;
const ROW_Y = 30;
const ROW_H = 17;
const PAD_L = 14;
const PAD_R = 56;

const IMPORTANCE_R: Record<MsgMark["importance"], number> = { info: 4, advisory: 5, steering: 6, interrupt: 7 };
const IMPORTANCE_LABEL: Record<MsgMark["importance"], string> = { info: "Info", advisory: "Advisory", steering: "Steering", interrupt: "Interrupt" };

function laneHeight(l: Lane, extra = 0): number {
  return ROW_Y + l.rows * ROW_H + 4 + extra;
}

function onActivate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

function fmtTick(ts: number, step: number): string {
  const d = new Date(ts);
  const opts: Intl.DateTimeFormatOptions = step < 60_000 ? { hour: "numeric", minute: "2-digit", second: "2-digit" } : { hour: "numeric", minute: "2-digit" };
  // Drop the AM/PM suffix on dense ticks; the tooltip carries the full time.
  return d.toLocaleTimeString([], opts).replace(/\s?[AP]\.?M\.?$/i, "");
}

/* ------------------------------- summary strip ------------------------------- */

function Spark({
  values,
  area,
  label,
  from,
  to,
  unit,
  onTip,
}: {
  values: number[];
  area?: boolean;
  label: string;
  from: number;
  to: number;
  unit: (v: number) => string;
  onTip: (el: Element | null, content: ReactNode | null, x?: number) => void;
}) {
  const W = 160;
  const H = 34;
  const max = Math.max(1, ...values);
  const n = values.length;
  const px = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const py = (v: number) => H - 2 - (v / max) * (H - 6);
  let d = "";
  values.forEach((v, i) => {
    if (area) d += i === 0 ? `M${px(i)},${py(v)}` : ` H${px(i)} V${py(v)}`;
    else d += `${i === 0 ? "M" : " L"}${px(i).toFixed(1)},${py(v).toFixed(1)}`;
  });
  const fill = area ? `${d} V${H} H0 Z` : "";
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const move = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) / r.width) * (n - 1))));
    setHover(i);
    const t = from + ((to - from) * i) / Math.max(1, n - 1);
    onTip(
      ref.current,
      <>
        <div className="viz-tip-head">
          <strong>{unit(values[i]!)}</strong>
        </div>
        <div className="viz-tip-sub">around {fmtClock(t)}</div>
      </>,
      r.left + (i / Math.max(1, n - 1)) * r.width
    );
  };
  return (
    <svg
      ref={ref}
      className={`tl-spark${area ? " area" : ""}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      onPointerMove={(e) => move(e.clientX)}
      onPointerLeave={() => {
        setHover(null);
        onTip(null, null);
      }}
    >
      <line className="tl-spark-base" x1={0} x2={W} y1={H - 1} y2={H - 1} />
      {area && <path className="tl-spark-fill" d={fill} />}
      <path className="tl-spark-line" d={d} vectorEffect="non-scaling-stroke" />
      {hover !== null && <line className="tl-spark-cross" x1={px(hover)} x2={px(hover)} y1={0} y2={H} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/* --------------------------------- component -------------------------------- */

export function Timeline(props: VizProps): JSX.Element {
  const { snapshot, leases, events, audit, theme, onSelectAgent, onOpenTab } = props;
  const now = useNow(1000);
  const reduced = useReducedMotion();
  const [rootRef, rootSize] = useSize<HTMLDivElement>();
  const [scrollRef, scrollSize] = useSize<HTMLDivElement>();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [tip, setTip] = useState<TipState | null>(null);

  const data = useMemo(() => buildTimeline(snapshot, audit, leases, events, now), [snapshot, audit, leases, events, now]);
  const span = Math.max(60_000, now - data.t0);

  const [scale, setScale] = useState<Scale>(() => "all");
  const autoScaled = useRef(false);
  useEffect(() => {
    if (autoScaled.current || !audit.length) return;
    autoScaled.current = true;
    setScale(span > 15 * 60_000 ? "10m" : "all");
  }, [audit.length, span]);
  const [customPx, setCustomPx] = useState(0);
  const [live, setLive] = useState(true);

  const narrow = rootSize.w > 0 && rootSize.w < 560;
  const LABEL_W = narrow ? 112 : 184;
  const viewW = Math.max(120, (scrollSize.w || rootSize.w || 800) - LABEL_W);
  const usable = viewW - PAD_L - PAD_R;
  // "All" never squeezes the session below a readable width; narrow screens scroll instead.
  const usableAll = Math.max(usable, 620);
  const pxPerMs =
    scale === "custom" ? customPx : scale === "all" ? usableAll / (span * 1.02) : usable / WINDOW[scale];
  const domainStart =
    scale === "10m" || scale === "1h" ? Math.min(data.t0 - 5000, now - WINDOW[scale]) : data.t0 - span * 0.01;
  const plotW = Math.max(viewW, PAD_L + (now - domainStart) * pxPerMs + PAD_R);
  const x = useCallback((t: number) => PAD_L + (t - domainStart) * pxPerMs, [domainStart, pxPerMs]);

  /* --- lanes geometry --- */
  // Few lanes: let them breathe into the available height (content stays vertically centered).
  const baseH = data.lanes.reduce((a, l) => a + laneHeight(l), 0);
  const availH = (scrollSize.h || 0) - AXIS_H - 2;
  const extra = data.lanes.length ? Math.max(0, Math.min(56, Math.floor((availH - baseH) / data.lanes.length))) : 0;
  const laneTop = new Map<string, number>();
  let acc = 0;
  for (const l of data.lanes) {
    laneTop.set(l.name, acc + extra / 2);
    acc += laneHeight(l, extra);
  }
  const plotH = Math.max(acc, 60);
  const dotY = (lane: string) => (laneTop.get(lane) ?? 0) + DOT_Y;
  const byName = useMemo(() => new Map(snapshot.participants.map((p) => [p.name, p])), [snapshot.participants]);

  /* --- live follow + ctrl+wheel zoom --- */
  const programmatic = useRef(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !live) return;
    programmatic.current = true;
    el.scrollLeft = el.scrollWidth;
  }, [live, plotW, scrollRef]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (programmatic.current) {
      programmatic.current = false;
      return;
    }
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 24;
    if (live !== atEnd) setLive(atEnd);
    setTip(null);
  };

  const anchor = useRef<{ t: number; sx: number } | null>(null);
  const pxRef = useRef(pxPerMs);
  pxRef.current = pxPerMs;
  const domainRef = useRef(domainStart);
  domainRef.current = domainStart;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left - LABEL_W;
      const t = domainRef.current + (el.scrollLeft + sx - PAD_L) / pxRef.current;
      const next = Math.max(0.2 / 60_000, Math.min(400 / 1000, pxRef.current * Math.exp(-e.deltaY * 0.004)));
      anchor.current = { t, sx };
      setCustomPx(next);
      setScale("custom");
      setLive(false);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [LABEL_W, scrollRef]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    programmatic.current = true;
    el.scrollLeft = Math.max(0, x(a.t) - a.sx);
  });

  /* --- tooltips --- */
  const show = (el: Element, content: ReactNode) => {
    if (!rootRef.current) return;
    setTip({ ...anchorOf(el, rootRef.current), content });
  };
  const hide = () => setTip(null);
  const markProps = (label: string, content: () => ReactNode, onClick?: () => void) => ({
    tabIndex: 0,
    role: onClick ? "button" : "img",
    "aria-label": label,
    onPointerEnter: (e: React.PointerEvent<SVGGElement>) => show(e.currentTarget, content()),
    onPointerLeave: hide,
    onFocus: (e: React.FocusEvent<SVGGElement>) => show(e.currentTarget, content()),
    onBlur: hide,
    onClick,
    onKeyDown: onClick ? onActivate(onClick) : undefined,
  });

  /* --- axis --- */
  const step = tickStep(pxPerMs, narrow ? 70 : 90);
  const ticks: number[] = [];
  for (let t = Math.ceil(domainStart / step) * step; t <= now + step; t += step) ticks.push(t);
  const minor = step / (step >= 60_000 && step % 300_000 === 0 ? 5 : step % 3 === 0 ? 3 : 2);
  const minorTicks: number[] = [];
  for (let t = Math.ceil(domainStart / minor) * minor; t <= now; t += minor) if (t % step !== 0) minorTicks.push(t);

  /* --- summary --- */
  const N = 40;
  const sFrom = data.t0;
  const sTo = now;
  const mSeries = useMemo(() => msgSeries(data.msgs, sFrom, sTo, N), [data.msgs, sFrom, sTo]);
  const cSeries = useMemo(() => claimSeries(data.claims, sFrom, sTo, N), [data.claims, sFrom, sTo]);
  const bucketMin = (sTo - sFrom) / N / 60_000;
  const recent = data.msgs.filter((m) => now - m.t < 5 * 60_000).length;
  const recentRate = recent / Math.min(5, Math.max(1 / 6, (now - data.t0) / 60_000));
  const tasks = snapshot.tasks.filter((t) => t.status !== "cancelled");
  const tDone = tasks.filter((t) => t.status === "done").length;
  const tProg = tasks.filter((t) => t.status === "in_progress").length;
  const tBlocked = tasks.filter((t) => t.status === "open" && t.blocked).length;
  const tOpen = tasks.length - tDone - tProg - tBlocked;
  const liveClaims = snapshot.locks.length;
  const sparkTip = (el: Element | null, content: ReactNode | null, cx?: number) => {
    if (!el || !content || !rootRef.current) return setTip(null);
    const a = anchorOf(el, rootRef.current);
    const o = rootRef.current.getBoundingClientRect();
    setTip({ ...a, x: cx !== undefined ? cx - o.left : a.x, content });
  };

  /* --- marks --- */
  const hatchId = (key: string) => `tlh-${uid}-${key}`;
  const colorKeys = Array.from(new Set(data.lanes.map((l) => colorKey(l.p ?? { kind: "agent" }))));

  const laneBg = data.lanes.map((l, i) => {
    const top = laneTop.get(l.name)! - extra / 2;
    const h = laneHeight(l, extra);
    const startX = Math.max(PAD_L - 6, x(l.start));
    const endX = l.end !== undefined ? x(l.end) : x(now);
    return (
      <g key={l.name} className={`tl-lane${i % 2 ? " odd" : ""}`} style={{ ["--c" as string]: colorOf(l.p) }}>
        <rect className="tl-lane-bg" x={0} y={top} width={plotW} height={h} />
        <line className="tl-lane-sep" x1={0} x2={plotW} y1={top + h - 0.5} y2={top + h - 0.5} />
        <line className="tl-life" x1={startX} x2={endX} y1={top + extra / 2 + DOT_Y} y2={top + extra / 2 + DOT_Y} />
      </g>
    );
  });

  const claimEls = data.claims.map((c: ClaimMark, i) => {
    const top = laneTop.get(c.lane);
    if (top === undefined) return null;
    const p = byName.get(c.lane);
    const x0 = x(c.t0);
    const x1 = Math.max(x0 + 4, x(c.t1));
    const y = top + ROW_Y + c.row * ROW_H + 9;
    const w = x1 - x0;
    const label = w > 46 ? truncate(c.path, Math.floor((w - 4) / 5.9)) : "";
    const end =
      c.endedBy === "active"
        ? `held now, ${c.expiresAt ? fmtDur(c.expiresAt - now) + " left" : "active"}`
        : c.endedBy === "release"
          ? `released ${fmtClock(c.t1)}`
          : c.endedBy === "leave"
            ? `ended when ${c.lane} left`
            : `expired ${fmtClock(c.t1)}`;
    return (
      <g
        key={`c${i}`}
        className={`tl-claim${c.exclusive ? " excl" : " shared"}${c.ongoing ? " live" : ""}`}
        style={{ ["--c" as string]: colorOf(p) }}
        {...markProps(
          `${c.lane} claimed ${c.path}, ${c.exclusive ? "exclusive" : "shared"}, from ${fmtClock(c.t0)}, ${end}`,
          () => (
            <>
              <div className="viz-tip-head">
                <span className="viz-tip-swatch" style={{ background: colorOf(p) }} />
                <strong className="mono">{c.path}</strong>
              </div>
              <div className="viz-tip-line">
                {c.lane}, {c.exclusive ? "exclusive" : "shared"} claim
              </div>
              <div className="viz-tip-sub">
                {fmtClock(c.t0)} to {c.ongoing ? "now" : fmtClock(c.t1)} ({fmtDur(c.t1 - c.t0)}), {end}
              </div>
              {c.reason && <div className="viz-tip-sub">“{truncate(c.reason, 100)}”</div>}
              <div className="viz-tip-hint">Click to open Claims</div>
            </>
          ),
          () => onOpenTab("claims")
        )}
      >
        <rect className="tl-hit" x={x0} y={y - 10} width={w} height={ROW_H} />
        <rect
          className="tl-claim-bar"
          x={x0}
          y={y}
          width={w}
          height={6}
          rx={3}
          fill={c.exclusive ? undefined : `url(#${hatchId(colorKey(p ?? { kind: "agent" }))})`}
        />
        {c.ongoing && c.expiresAt && (
          <line className="tl-claim-ttl" x1={x1} x2={x1 + Math.min(PAD_R - 8, (c.expiresAt - now) * pxPerMs)} y1={y + 3} y2={y + 3} />
        )}
        {label && (
          <text className="tl-claim-text" x={x0 + 1} y={y - 3}>
            {label}
          </text>
        )}
      </g>
    );
  });

  const caps = data.caps.map((c, i) => {
    const top = laneTop.get(c.lane);
    if (top === undefined) return null;
    const cx = x(c.t);
    const cy = top + DOT_Y;
    const p = byName.get(c.lane);
    return (
      <g
        key={`cap${i}`}
        className={`tl-cap ${c.kind}`}
        style={{ ["--c" as string]: colorOf(p) }}
        {...markProps(`${c.lane} ${c.kind === "join" ? "joined" : "left"} at ${fmtClock(c.t)}`, () => (
          <>
            <div className="viz-tip-head">
              <strong>
                {c.lane} {c.kind === "join" ? "joined" : "left"}
              </strong>
            </div>
            <div className="viz-tip-sub">{fmtClock(c.t)}</div>
            {c.detail && <div className="viz-tip-line">{c.detail}</div>}
          </>
        ))}
      >
        <rect className="tl-hit" x={cx - 8} y={cy - 10} width={16} height={20} />
        {c.kind === "join" ? <path d={`M${cx},${cy - 8} v16 M${cx},${cy} h6`} /> : <path d={`M${cx},${cy - 8} v16 M${cx - 6},${cy} h6`} />}
      </g>
    );
  });

  const youName = snapshot.you.name;
  const msgEls = data.msgs.map((m) => {
    const top = laneTop.get(m.lane);
    if (top === undefined) return null;
    const p = byName.get(m.lane);
    const r = IMPORTANCE_R[m.importance];
    const cls = m.importance === "interrupt" ? " interrupt" : m.mentionsYou ? " you" : "";
    const content = () => (
      <>
        <div className="viz-tip-head">
          <span className="viz-tip-swatch" style={{ background: colorOf(p) }} />
          <strong>{m.lane}</strong>
          <span className="viz-tip-time">{fmtClock(m.t)}</span>
        </div>
        <div className="viz-tip-sub">
          {IMPORTANCE_LABEL[m.importance]} message #{m.seq}
          {m.mentions.length ? `, to ${m.mentions.map((x) => "@" + x).join(" ")}` : ""}
          {m.mentionsYou ? `, mentions ${youName}` : ""}
        </div>
        {m.text && <div className="viz-tip-line quote">{truncate(m.text, 180)}</div>}
        {p?.kind === "agent" && <div className="viz-tip-hint">Click to focus {m.lane}</div>}
      </>
    );
    return (
      <g
        key={`m${m.seq}`}
        className={`tl-msg${cls}`}
        style={{ ["--c" as string]: colorOf(p) }}
        {...markProps(
          `${IMPORTANCE_LABEL[m.importance]} message from ${m.lane} at ${fmtClock(m.t)}${m.mentionsYou ? ", mentions you" : ""}: ${truncate(m.text, 80)}`,
          content,
          () => onSelectAgent(m.lane)
        )}
      >
        <circle className="tl-hit" cx={x(m.t)} cy={top + DOT_Y} r={Math.max(9, r + 4)} />
        <circle className="tl-dot" cx={x(m.t)} cy={top + DOT_Y} r={r} />
      </g>
    );
  });

  const doneEls = data.done.map((d, i) => {
    const top = laneTop.get(d.lane);
    if (top === undefined) return null;
    const cx = x(d.t);
    const cy = top + DOT_Y;
    return (
      <g
        key={`d${i}`}
        className="tl-done"
        {...markProps(
          `${d.lane} finished “${d.title}” at ${fmtClock(d.t)}`,
          () => (
            <>
              <div className="viz-tip-head">
                <strong>Task done</strong>
                <span className="viz-tip-time">{fmtClock(d.t)}</span>
              </div>
              <div className="viz-tip-line">{d.title}</div>
              <div className="viz-tip-sub">by {d.lane}</div>
              <div className="viz-tip-hint">Click to open Tasks</div>
            </>
          ),
          () => onOpenTab("tasks")
        )}
      >
        <circle className="tl-hit" cx={cx} cy={cy} r={11} />
        <circle className="tl-done-bg" cx={cx} cy={cy} r={7.5} />
        <path className="tl-done-check" d={`M${cx - 3.4},${cy + 0.2} l2.3,2.4 l4.6,-5`} />
      </g>
    );
  });

  const approvalEls = data.approvals.map((a: ApprovalMark, i) => {
    const top = laneTop.get(a.lane);
    if (top === undefined) return null;
    const cx = x(a.t);
    const cy = top + DOT_Y;
    const s = 7;
    const statusText = a.status === "unknown" ? "decided" : a.status;
    return (
      <g
        key={`ap${i}`}
        className={`tl-approval st-${a.status}`}
        {...markProps(
          `${a.lane} asked for approval to ${a.action} at ${fmtClock(a.t)}, ${statusText}`,
          () => (
            <>
              <div className="viz-tip-head">
                <strong>Approval: {a.action}</strong>
                <span className={`viz-tip-state ap-${a.status}`}>{statusText}</span>
              </div>
              <div className="viz-tip-sub">
                {a.lane} asked at {fmtClock(a.t)}
                {a.decidedAt ? `, decided ${fmtClock(a.decidedAt)} (${fmtDur(a.decidedAt - a.t)})` : a.status === "pending" ? `, waiting ${fmtDur(now - a.t)}` : ""}
              </div>
              {a.details && <div className="viz-tip-line">{truncate(a.details, 160)}</div>}
              <div className="viz-tip-hint">Click to open Activity</div>
            </>
          ),
          () => onOpenTab("activity")
        )}
      >
        <circle className="tl-hit" cx={cx} cy={cy} r={12} />
        {a.decidedAt && <line className="tl-approval-wait" x1={cx} x2={x(a.decidedAt)} y1={cy} y2={cy} />}
        {a.status === "pending" && <line className="tl-approval-wait pending" x1={cx} x2={x(now)} y1={cy} y2={cy} />}
        {a.status === "pending" && !reduced && <path className="tl-approval-pulse" d={`M${cx},${cy - s - 4} l${s + 4},${s + 4} l${-s - 4},${s + 4} l${-s - 4},${-s - 4} z`} />}
        <path className="tl-diamond" d={`M${cx},${cy - s} l${s},${s} l${-s},${s} l${-s},${-s} z`} />
      </g>
    );
  });

  const collisionEls = data.collisions.map((c, i) => {
    const ya = dotY(c.by);
    const yb = dotY(c.holder);
    const cx = x(c.t);
    const xMark = (y: number) => <path className="tl-x" d={`M${cx - 4.5},${y - 4.5} l9,9 M${cx + 4.5},${y - 4.5} l-9,9`} />;
    return (
      <g
        key={`col${i}`}
        className="tl-collision"
        {...markProps(
          `Collision at ${fmtClock(c.t)}: ${c.by} was denied ${c.path}, held by ${c.holder}`,
          () => (
            <>
              <div className="viz-tip-head">
                <strong>Collision prevented</strong>
                <span className="viz-tip-time">{fmtClock(c.t)}</span>
              </div>
              <div className="viz-tip-line">
                {c.by} tried to claim <span className="mono">{c.path}</span>, already held by {c.holder}.
              </div>
              <div className="viz-tip-hint">Click to open Claims</div>
            </>
          ),
          () => onOpenTab("claims")
        )}
      >
        <rect className="tl-hit" x={cx - 9} y={Math.min(ya, yb) - 9} width={18} height={Math.abs(yb - ya) + 18} />
        <line className="tl-col-line" x1={cx} x2={cx} y1={ya} y2={yb} />
        <circle className="tl-x-bg" cx={cx} cy={ya} r={8} />
        <circle className="tl-x-bg" cx={cx} cy={yb} r={8} />
        {xMark(ya)}
        {xMark(yb)}
      </g>
    );
  });

  const handoffEls = data.handoffs.map((h, i) => {
    const ya = dotY(h.from);
    const yb = dotY(h.to);
    const xa = x(h.t);
    const xb = xa + Math.max(16, Math.min(46, Math.abs(yb - ya) * 0.5));
    const d = `M${xa},${ya} C${xa + 26},${ya} ${xb - 20},${yb} ${xb},${yb + (yb > ya ? -7 : 7)}`;
    return (
      <g
        key={`h${i}`}
        className={`tl-handoff${h.pending ? " pending" : ""}`}
        {...markProps(
          `Hand-off at ${fmtClock(h.t)}: ${h.from} asked ${h.to} for ${h.path}${h.pending ? ", still waiting" : ""}`,
          () => (
            <>
              <div className="viz-tip-head">
                <strong>Hand-off</strong>
                <span className="viz-tip-time">{fmtClock(h.t)}</span>
              </div>
              <div className="viz-tip-line">
                {h.from} asked {h.to} for <span className="mono">{h.path}</span>
              </div>
              <div className="viz-tip-sub">
                {h.pending ? `Waiting ${fmtDur(now - h.t)}` : h.resolvedAt ? `Freed after ${fmtDur(h.resolvedAt - h.t)}` : "Resolved"}
              </div>
            </>
          )
        )}
      >
        <path className="tl-hit-path" d={d} />
        <path className="tl-handoff-path" d={d} markerEnd={`url(#tla-${uid})`} />
        {h.resolvedAt && <circle className="tl-handoff-free" cx={x(h.resolvedAt)} cy={ya} r={3.5} />}
        {h.resolvedAt && <line className="tl-handoff-wait" x1={xa} x2={x(h.resolvedAt)} y1={ya + 9} y2={ya + 9} />}
      </g>
    );
  });

  const nowX = x(now);
  const counts = `${data.msgs.length} messages, ${data.claims.length} claims, ${data.collisions.length} collisions, ${data.handoffs.length} hand-offs, ${data.approvals.length} approvals, ${data.done.length} tasks done`;
  const summaryLabel = `Session timeline for ${snapshot.room.name}, ${fmtDur(span)} long, ${data.lanes.length} lanes. ${counts}.`;

  return (
    <div className={`viz-root tl-root${narrow ? " narrow" : ""}${reduced ? " reduced" : ""}`} data-vt={theme} ref={rootRef}>
      <div className="tl-summary" role="group" aria-label="Session summary">
        <div className="tl-tile">
          <div className="tl-tile-k">Messages / min</div>
          <div className="tl-tile-v">
            {recentRate >= 10 ? Math.round(recentRate) : recentRate.toFixed(1)}
            <span className="tl-tile-u">last 5 min</span>
          </div>
          <Spark
            values={mSeries}
            label={`Messages per minute over the session, peak ${Math.max(...mSeries)} per ${bucketMin < 1 ? Math.round(bucketMin * 60) + " seconds" : bucketMin.toFixed(1) + " min"}`}
            from={sFrom}
            to={sTo}
            unit={(v) => `${v} message${v === 1 ? "" : "s"} in ${bucketMin < 1 ? Math.max(1, Math.round(bucketMin * 60)) + "s" : bucketMin.toFixed(1) + " min"}`}
            onTip={sparkTip}
          />
        </div>
        <div className="tl-tile">
          <div className="tl-tile-k">Files claimed</div>
          <div className="tl-tile-v">
            {liveClaims}
            <span className="tl-tile-u">held now, peak {Math.max(0, ...cSeries)}</span>
          </div>
          <Spark values={cSeries} area label={`Files claimed over time, now ${liveClaims}`} from={sFrom} to={sTo} unit={(v) => `${v} file${v === 1 ? "" : "s"} held`} onTip={sparkTip} />
        </div>
        <button type="button" className="tl-tile as-btn" onClick={() => onOpenTab("tasks")} aria-label={`Tasks: ${tDone} of ${tasks.length} done, ${tProg} in progress, ${tBlocked} blocked, ${tOpen} open. Open Tasks.`}>
          <div className="tl-tile-k">Tasks</div>
          <div className="tl-tile-v">
            {tDone}
            <span className="tl-tile-of">/{tasks.length}</span>
            <span className="tl-tile-u">done</span>
          </div>
          <div className="tl-progress" aria-hidden="true">
            {tasks.length === 0 ? (
              <span className="seg empty" style={{ flex: 1 }} />
            ) : (
              <>
                {tDone > 0 && <span className="seg done" style={{ flex: tDone }} />}
                {tProg > 0 && <span className="seg prog" style={{ flex: tProg }} />}
                {tOpen > 0 && <span className="seg open" style={{ flex: tOpen }} />}
                {tBlocked > 0 && <span className="seg blocked" style={{ flex: tBlocked }} />}
              </>
            )}
          </div>
          <div className="tl-progress-key" aria-hidden="true">
            <span><i className="done" />{tDone} done</span>
            <span><i className="prog" />{tProg} active</span>
            {tBlocked > 0 && <span><i className="blocked" />{tBlocked} blocked</span>}
          </div>
        </button>
        <button type="button" className={`tl-tile as-btn${data.collisions.length ? " alert" : ""}`} onClick={() => onOpenTab("claims")} aria-label={`${data.collisions.length} collisions prevented. Open Claims.`}>
          <div className="tl-tile-k">Collisions prevented</div>
          <div className="tl-tile-v">
            {data.collisions.length}
            <span className="tl-tile-u">{data.handoffs.length} hand-off{data.handoffs.length === 1 ? "" : "s"}</span>
          </div>
          <svg className="tl-colstrip" viewBox="0 0 160 14" preserveAspectRatio="none" aria-hidden="true">
            <line x1={0} x2={160} y1={7} y2={7} />
            {data.collisions.map((c, i) => {
              const cx = ((c.t - sFrom) / Math.max(1, sTo - sFrom)) * 156 + 2;
              return <path key={i} d={`M${cx - 3},4 l6,6 M${cx + 3},4 l-6,6`} vectorEffect="non-scaling-stroke" />;
            })}
          </svg>
        </button>
      </div>

      <div className="tl-toolbar">
        <div className="tl-seg" role="group" aria-label="Time scale">
          {(["10m", "1h", "all"] as const).map((s) => (
            <button key={s} type="button" className={`viz-btn${scale === s ? " on" : ""}`} aria-pressed={scale === s} onClick={() => { setScale(s); setLive(true); }}>
              {s === "10m" ? "10 min" : s === "1h" ? "1 h" : "All"}
            </button>
          ))}
        </div>
        <button type="button" className={`viz-btn live${live ? " on" : ""}`} aria-pressed={live} onClick={() => setLive(true)}>
          <span className="tl-live-dot" aria-hidden="true" />
          Live
        </button>
        <span className="tl-hint">{narrow ? "Swipe to scroll" : "Ctrl + scroll to zoom"}</span>
      </div>

      <div className="tl-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="tl-grid" style={{ gridTemplateColumns: `${LABEL_W}px ${plotW}px` }}>
          <div className="tl-corner">
            <span>{data.lanes.length} in room</span>
          </div>
          <svg className="tl-axis" width={plotW} height={AXIS_H} aria-hidden="true">
            {minorTicks.map((t) => (
              <line key={`n${t}`} className="tl-tick minor" x1={x(t)} x2={x(t)} y1={AXIS_H - 5} y2={AXIS_H} />
            ))}
            {ticks.map((t) => (
              <g key={t}>
                <line className="tl-tick" x1={x(t)} x2={x(t)} y1={AXIS_H - 9} y2={AXIS_H} />
                {Math.abs(x(t) - nowX) > 70 && x(t) < nowX && (
                  <text className="tl-tick-text" x={x(t) + 4} y={AXIS_H - 12}>
                    {fmtTick(t, step)}
                  </text>
                )}
              </g>
            ))}
            <g className="tl-now-tag" transform={`translate(${nowX},0)`}>
              <rect x={-17} y={3} width={34} height={16} rx={8} />
              <text y={11.5} textAnchor="middle" dominantBaseline="middle">
                now
              </text>
            </g>
          </svg>

          <div className="tl-labels">
            {data.lanes.map((l) => {
              const p = l.p;
              const st = p ? agentState(p) : "off";
              const h = laneHeight(l, extra);
              const isAgent = p?.kind === "agent";
              return (
                <button
                  key={l.name}
                  type="button"
                  className={`tl-label s-${st}`}
                  style={{ height: h, paddingTop: 6 + extra / 2, ["--c" as string]: colorOf(p) }}
                  onClick={() => isAgent && onSelectAgent(l.name)}
                  aria-label={`${l.name}${p?.model ? `, ${p.model}` : ""}, ${STATE_LABEL[st]}${isAgent ? ". Focus this agent" : ""}`}
                  disabled={!isAgent}
                >
                  <Avatar name={l.name} brand={p?.brand} kind={p?.kind} size={narrow ? 24 : 28} ring={p ? presence(p) : "off"} />
                  <span className="tl-label-text">
                    <span className="tl-label-name">{l.name}</span>
                    {!narrow && <span className="tl-label-model">{p?.kind === "human" ? "Overseer" : p?.model ?? p?.client ?? STATE_LABEL[st]}</span>}
                  </span>
                </button>
              );
            })}
          </div>

          <svg className="tl-plot" width={plotW} height={plotH} role="group" aria-label={summaryLabel}>
            <defs>
              {colorKeys.map((k) => (
                <pattern key={k} id={hatchId(k)} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width={5} height={5} className="tl-hatch-bg" style={{ ["--c" as string]: k === "human" ? "var(--copper)" : k === "other" ? "var(--sky)" : `var(--${k})` }} />
                  <line x1={0} y1={0} x2={0} y2={5} className="tl-hatch-line" style={{ ["--c" as string]: k === "human" ? "var(--copper)" : k === "other" ? "var(--sky)" : `var(--${k})` }} />
                </pattern>
              ))}
              <marker id={`tla-${uid}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" className="tl-arrowhead" />
              </marker>
            </defs>
            {laneBg}
            {ticks.map((t) => (
              <line key={`g${t}`} className="tl-grid-line" x1={x(t)} x2={x(t)} y1={0} y2={plotH} />
            ))}
            {claimEls}
            {caps}
            {handoffEls}
            {collisionEls}
            {msgEls}
            {approvalEls}
            {doneEls}
            <line className="tl-now" x1={nowX} x2={nowX} y1={0} y2={plotH} />
          </svg>
        </div>
        {data.lanes.length <= 1 && data.msgs.length === 0 && (
          <div className="tl-empty">
            <p className="vm-empty-title">Nothing on the timeline yet</p>
            <p>Messages, claims, collisions and approvals appear here as agents work.</p>
          </div>
        )}
      </div>

      <div className="tl-legend" aria-hidden="true">
        <span><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3.5" className="lg-dot" /></svg>Message</span>
        <span><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.5" className="lg-int" /></svg>Interrupt</span>
        <span><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" className="lg-you" /></svg>Mentions you</span>
        <span><i className="lg-bar" />Exclusive claim</span>
        <span><i className="lg-bar shared" />Shared claim</span>
        <span><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" className="lg-x" /></svg>Collision</span>
        <span><svg viewBox="0 0 16 16"><path d="M8 2l6 6-6 6-6-6z" className="lg-dia" /></svg>Approval</span>
        <span><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" className="lg-done" /><path d="M5 8.2l2 2 4-4.4" className="lg-check" /></svg>Task done</span>
      </div>

      <Tooltip tip={tip} rootW={rootSize.w} />
    </div>
  );
}
