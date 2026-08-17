import { useCallback, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------ types */

type EventKey = "package_installed" | "bothread_start" | "room_created";
type Platform = "windows" | "mac" | "linux" | "other";
type Channel = "npx" | "global" | "dev-clone" | "local" | "other";

interface DayRow {
  date: string;
  events: Record<EventKey, number>;
  platforms: Record<Platform, number>;
  channels: Record<Channel, number>;
  versions: Record<string, number>;
}

interface Telemetry {
  days: DayRow[];
  byHourUtc: number[];
  sampleSize: number;
  oldestEvent: string | null;
  newestEvent: string | null;
  truncated: boolean;
}

interface Waitlist {
  count: number;
  entries: { email?: string; source: string | null; createdAt: string | null }[];
}

interface Feedback {
  count: number;
  byCategory: Record<string, number>;
  entries: {
    id: string;
    category: string;
    message: string;
    email: string | null;
    page: string | null;
    createdAt: string | null;
  }[];
}

interface Github {
  stars?: number;
  forks?: number;
  openIssues?: number;
  watchers?: number;
  pushedAt?: string;
  license?: string | null;
  releases?: { tag: string; publishedAt: string }[];
  error?: string;
}

interface Npm {
  lastWeek?: number | null;
  lastMonth?: number | null;
  byDay?: { day: string; downloads: number }[];
  byVersionLastWeek?: Record<string, number>;
  error?: string;
}

interface Stats {
  telemetry: Telemetry;
  waitlist: Waitlist;
  feedback: Feedback;
  github: Github;
  npm: Npm;
  generatedAt: string;
}

/* ----------------------------------------------------------------- config */

const EVENT_KEYS: EventKey[] = ["package_installed", "bothread_start", "room_created"];
const EVENT_LABEL: Record<EventKey, string> = {
  package_installed: "Installs",
  bothread_start: "Hub starts",
  room_created: "Rooms",
};

// Fixed categorical order, never reordered by value. Validated CVD-safe against
// this page's dark surface (worst adjacent dE 9.4 deutan / 26.5 normal, all >=3:1).
const EVENT_COLOR: Record<EventKey, string> = {
  package_installed: "var(--series-1)",
  bothread_start: "var(--series-2)",
  room_created: "var(--series-3)",
};

const PLATFORM_LABEL: Record<Platform, string> = {
  windows: "Windows",
  mac: "Mac",
  linux: "Linux",
  other: "Other",
};

const CHANNEL_LABEL: Record<Channel, string> = {
  npx: "npx bothread",
  global: "npm install -g",
  "dev-clone": "git clone (dev)",
  local: "npm install (local)",
  other: "Unknown / CI",
};

const RANGES = [
  { key: "7", label: "7d", days: 7 },
  { key: "30", label: "30d", days: 30 },
  { key: "90", label: "90d", days: 90 },
  { key: "all", label: "All", days: Infinity },
] as const;

const nf = (n: number) => n.toLocaleString();

function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const sumInto = <K extends string>(rows: Record<K, number>[]): Record<K, number> => {
  const out = {} as Record<K, number>;
  for (const r of rows) for (const k of Object.keys(r) as K[]) out[k] = (out[k] ?? 0) + r[k];
  return out;
};

/* ------------------------------------------------------------- primitives */

function Kpi({
  value,
  label,
  meta,
  accent,
  series,
}: {
  value: number | null;
  label: string;
  meta?: string;
  accent?: boolean;
  series?: number[];
}) {
  return (
    <div className={`ad-kpi${accent ? " ad-kpi-accent" : ""}`}>
      <div className="ad-kpi-value">{value === null ? "—" : nf(value)}</div>
      <div className="ad-kpi-label">{label}</div>
      {meta && <div className="ad-kpi-meta">{meta}</div>}
      {series && series.length > 1 && <Sparkline values={series} />}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 120;
  const h = 26;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${i * step},${h - (v / max) * h}`).join(" ");
  return (
    <svg className="ad-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke="var(--copper-1)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Section({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="ad-section">
      <div className="ad-section-head">
        <div>
          <h2>{title}</h2>
          {note && <p className="ad-section-note">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <div className="ad-empty">{children}</div>;

/* ----------------------------------------------------------------- charts */

interface SeriesDef {
  key: string;
  label: string;
  color: string;
  points: number[];
}

/**
 * Multi-series line chart with a crosshair tooltip. Hover is tracked in SVG
 * user units, so it stays accurate at any container width.
 */
function LineChart({ labels, series }: { labels: string[]; series: SeriesDef[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const W = 760;
  const H = 220;
  const PX = 34;
  const PY = 20;

  if (!labels.length) return <Empty>No data in this range.</Empty>;

  const max = Math.max(1, ...series.flatMap((s) => s.points));
  const stepX = labels.length > 1 ? (W - PX * 2) / (labels.length - 1) : 0;
  const x = (i: number) => PX + i * stepX;
  const y = (v: number) => H - PY - (v / max) * (H - PY * 2);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = ref.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const ux = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round((ux - PX) / (stepX || 1));
    setHover(Math.max(0, Math.min(labels.length - 1, i)));
  };

  return (
    <div className="ad-chart">
      <div className="ad-legend">
        {series.map((s) => (
          <span key={s.key} className="ad-legend-item">
            <span className="ad-swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="ad-line"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Events over time"
      >
        {[0, 0.5, 1].map((t) => (
          <line key={t} x1={PX} x2={W - PX} y1={PY + t * (H - PY * 2)} y2={PY + t * (H - PY * 2)} className="ad-gridline" />
        ))}
        <text x={PX - 8} y={PY + 4} className="ad-tick" textAnchor="end">{max}</text>
        <text x={PX - 8} y={H - PY} className="ad-tick" textAnchor="end">0</text>

        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PY} y2={H - PY} className="ad-crosshair" />}

        {series.map((s) => (
          <path
            key={s.key}
            d={s.points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}

        {hover !== null &&
          series.map((s) => <circle key={s.key} cx={x(hover)} cy={y(s.points[hover] ?? 0)} r={4} fill={s.color} />)}
      </svg>

      <div className="ad-tip-row">
        {hover === null ? (
          <span className="ad-tip-hint">Hover the chart for a day-by-day breakdown</span>
        ) : (
          <>
            <strong>{labels[hover]}</strong>
            {series.map((s) => (
              <span key={s.key} className="ad-tip-item">
                <span className="ad-swatch" style={{ background: s.color }} />
                {s.label} <strong>{nf(s.points[hover] ?? 0)}</strong>
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** Single-series bars. Brand copper is safe: one series has no pair to separate. */
function BarChart({ labels, values, unit }: { labels: string[]; values: number[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!values.length) return <Empty>No data in this range.</Empty>;
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);

  return (
    <div className="ad-chart">
      <div className="ad-chart-meta">
        <span>
          <strong>{nf(total)}</strong> {unit} in range
        </span>
        {hover !== null && (
          <span>
            {labels[hover]}: <strong>{nf(values[hover] ?? 0)}</strong>
          </span>
        )}
      </div>
      <div className="ad-bars" onMouseLeave={() => setHover(null)}>
        {values.map((v, i) => (
          <div
            key={labels[i] ?? i}
            className={`ad-bars-col${hover === i ? " is-hot" : ""}`}
            onMouseEnter={() => setHover(i)}
            title={`${labels[i]}: ${nf(v)}`}
          >
            <div className="ad-bars-fill" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="ad-axis">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

function BarList({
  rows,
  color,
  emptyNote,
}: {
  rows: { label: string; value: number }[];
  color: string;
  emptyNote?: string;
}) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (total === 0) return <Empty>{emptyNote ?? "Nothing recorded yet."}</Empty>;
  return (
    <div className="ad-card">
      {rows.map((r) => (
        <div key={r.label} className="ad-row">
          <div className="ad-row-label">{r.label}</div>
          <div className="ad-row-track">
            <div className="ad-row-fill" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: color }} />
          </div>
          <div className="ad-row-value">
            {nf(r.value)}
            <span className="ad-row-pct">{total ? Math.round((r.value / total) * 100) : 0}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Honest funnel: each stage says what it can and cannot see. */
function Funnel({ stages }: { stages: { label: string; value: number | null; note: string }[] }) {
  const base = stages.find((s) => s.value !== null)?.value ?? 0;
  return (
    <div className="ad-funnel">
      {stages.map((s) => {
        // Stages aren't guaranteed to decrease: npm counts a different window
        // than our own postinstall events, so a later stage can legitimately
        // exceed the first. Clamp so the bar never overflows its track.
        const pct = base > 0 && s.value !== null ? Math.min(100, Math.max(3, (s.value / base) * 100)) : 3;
        return (
          <div key={s.label} className="ad-funnel-step">
            <div className="ad-funnel-head">
              <span className="ad-funnel-label">{s.label}</span>
              <span className="ad-funnel-value">{s.value === null ? "—" : nf(s.value)}</span>
            </div>
            <div className="ad-funnel-track">
              <div className="ad-funnel-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="ad-funnel-note">{s.note}</div>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- sections */

function FeedbackInbox({ feedback }: { feedback: Feedback }) {
  const [cat, setCat] = useState<string>("all");
  const cats = ["all", ...Object.keys(feedback.byCategory)];
  const shown = cat === "all" ? feedback.entries : feedback.entries.filter((e) => e.category === cat);

  return (
    <Section
      title="Feedback"
      note={`${feedback.count} submission${feedback.count === 1 ? "" : "s"} from the site form.`}
      action={
        cats.length > 1 ? (
          <div className="ad-tabs">
            {cats.map((c) => (
              <button key={c} className={`ad-tab${cat === c ? " is-on" : ""}`} onClick={() => setCat(c)}>
                {c === "all" ? `All ${feedback.count}` : `${c} ${feedback.byCategory[c] ?? 0}`}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      {shown.length === 0 ? (
        <Empty>No feedback yet.</Empty>
      ) : (
        <div className="ad-feed">
          {shown.map((f) => (
            <article key={f.id} className="ad-feed-item">
              <header>
                <span className={`ad-chip ad-chip-${f.category}`}>{f.category}</span>
                <span className="ad-feed-date">{f.createdAt ? f.createdAt.slice(0, 10) : "—"}</span>
                {f.page && <span className="ad-feed-page">{f.page}</span>}
              </header>
              <p>{f.message}</p>
              {f.email && (
                <a className="ad-feed-mail" href={`mailto:${f.email}`}>
                  {f.email}
                </a>
              )}
            </article>
          ))}
        </div>
      )}
    </Section>
  );
}

function WaitlistTable({ waitlist }: { waitlist: Waitlist }) {
  const [copied, setCopied] = useState(false);
  const emails = waitlist.entries.map((e) => e.email).filter(Boolean) as string[];

  return (
    <Section
      title="Waitlist"
      note={`${waitlist.count} signup${waitlist.count === 1 ? "" : "s"}. Closed — the site now links straight to /start.`}
      action={
        emails.length > 0 ? (
          <button
            className="ad-btn-sm"
            onClick={async () => {
              await navigator.clipboard.writeText(emails.join(", "));
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? "Copied ✓" : "Copy emails"}
          </button>
        ) : undefined
      }
    >
      {waitlist.entries.length === 0 ? (
        <Empty>No signups.</Empty>
      ) : (
        <div className="ad-card ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Source</th>
                <th>Signed up</th>
              </tr>
            </thead>
            <tbody>
              {waitlist.entries.map((e) => (
                <tr key={e.email}>
                  <td>{e.email}</td>
                  <td>{e.source ?? "—"}</td>
                  <td>{e.createdAt ? e.createdAt.slice(0, 10) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------- page */

export default function Admin() {
  const [password, setPassword] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("30");

  const load = useCallback(async (pw: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin-stats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.status === 401) return setError("Wrong password.");
      if (!res.ok) return setError(`Request failed (${res.status}).`);
      setStats((await res.json()) as Stats);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  const rangeDays = RANGES.find((r) => r.key === range)?.days ?? 30;

  const view = useMemo(() => {
    if (!stats) return null;
    const cutoff = rangeDays === Infinity ? 0 : Date.now() - rangeDays * 86_400_000;
    const days = stats.telemetry.days.filter((d) => Date.parse(d.date) >= cutoff);
    const npmDays = (stats.npm.byDay ?? []).filter((d) => Date.parse(d.day) >= cutoff);

    return {
      days,
      npmDays,
      events: sumInto(days.map((d) => d.events)),
      platforms: sumInto(days.map((d) => d.platforms)),
      channels: sumInto(days.map((d) => d.channels)),
      versions: sumInto(days.map((d) => d.versions)),
      npmTotal: npmDays.reduce((s, d) => s + d.downloads, 0),
    };
  }, [stats, rangeDays]);

  if (!stats || !view) {
    return (
      <main className="ad-gate">
        <form
          className="ad-gate-card"
          onSubmit={(e) => {
            e.preventDefault();
            void load(password);
          }}
        >
          <div className="ad-gate-mark" aria-hidden="true" />
          <h1>Bothread admin</h1>
          <p>Private dashboard.</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Password"
            autoFocus
          />
          <button className="ad-btn" type="submit" disabled={loading}>
            {loading ? "Checking…" : "Enter"}
          </button>
          {error && <p className="ad-error">{error}</p>}
        </form>
      </main>
    );
  }

  const { telemetry, github, npm, waitlist, feedback } = stats;
  const labels = view.days.map((d) => d.date.slice(5));
  const installs = view.events.package_installed ?? 0;
  const starts = view.events.bothread_start ?? 0;
  const rooms = view.events.room_created ?? 0;

  return (
    <main className="ad-root">
      <header className="ad-header">
        <div>
          <h1>Bothread</h1>
          <p className="ad-sub">
            Updated {timeAgo(stats.generatedAt)} · {nf(telemetry.sampleSize)} events on file · UTC
          </p>
        </div>
        <div className="ad-controls">
          <div className="ad-tabs">
            {RANGES.map((r) => (
              <button key={r.key} className={`ad-tab${range === r.key ? " is-on" : ""}`} onClick={() => setRange(r.key)}>
                {r.label}
              </button>
            ))}
          </div>
          <button className="ad-btn-sm" onClick={() => void load(password)} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && <p className="ad-error">{error}</p>}

      <div className="ad-kpis">
        <Kpi
          value={view.npmTotal}
          label="npm downloads"
          meta={`in range · ${nf(npm.lastWeek ?? 0)} last 7d`}
          accent
          series={view.npmDays.map((d) => d.downloads)}
        />
        <Kpi value={github.stars ?? 0} label="GitHub stars" meta={`${nf(github.forks ?? 0)} forks`} accent />
        <Kpi
          value={installs}
          label="Installs reported"
          meta="telemetry-enabled versions only"
          series={view.days.map((d) => d.events.package_installed)}
        />
        <Kpi value={starts} label="Hub starts" meta={rooms ? `${nf(rooms)} rooms created` : "no rooms yet"} />
      </div>

      {installs > 0 && starts === 0 && (
        <div className="ad-note">
          <strong>Why downloads don't match starts.</strong>
          <p>
            npm counts every registry fetch, including CI, mirrors and security scanners, and most of
            those never run the CLI. Installs here are {nf(installs)}
            {view.platforms.linux > 0 && <> ({nf(view.platforms.linux)} on Linux)</>} with{" "}
            <strong>zero hub starts</strong>, which is the signature of automated traffic rather than
            people. On top of that, telemetry only reports from versions that ship it, so anyone on an
            older release is invisible here. Real starts should appear as 0.2.4+ spreads.
          </p>
        </div>
      )}

      <Section title="Funnel" note="Each stage only sees what it can actually measure.">
        <Funnel
          stages={[
            { label: "npm downloads", value: view.npmTotal, note: "registry fetches, includes CI and mirrors" },
            { label: "Installs reported", value: installs, note: "postinstall ran on a telemetry-enabled version" },
            { label: "Hub starts", value: starts, note: "someone actually ran bothread start" },
            { label: "Rooms created", value: rooms, note: "got far enough to open a room" },
          ]}
        />
      </Section>

      <Section title="npm downloads" note="Daily, from the public registry API.">
        <BarChart labels={view.npmDays.map((d) => d.day.slice(5))} values={view.npmDays.map((d) => d.downloads)} unit="downloads" />
      </Section>

      <Section title="Telemetry over time" note="Installs, hub starts, and rooms created per day.">
        <LineChart
          labels={labels}
          series={EVENT_KEYS.map((k) => ({
            key: k,
            label: EVENT_LABEL[k],
            color: EVENT_COLOR[k],
            points: view.days.map((d) => d.events[k]),
          }))}
        />
      </Section>

      <div className="ad-two">
        <Section title="Platform">
          <BarList
            color="var(--series-1)"
            rows={(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => ({
              label: PLATFORM_LABEL[p],
              value: view.platforms[p] ?? 0,
            }))}
          />
        </Section>
        <Section title="Install channel">
          <BarList
            color="var(--series-2)"
            rows={(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => ({
              label: CHANNEL_LABEL[c],
              value: view.channels[c] ?? 0,
            }))}
          />
        </Section>
      </div>

      <div className="ad-two">
        <Section title="Version adoption (npm, last 7d)" note="Which versions people are actually pulling.">
          <BarList
            color="var(--series-3)"
            emptyNote="npm hasn't reported per-version numbers yet."
            rows={Object.entries(npm.byVersionLastWeek ?? {})
              .filter(([, v]) => v > 0)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 8)
              .map(([k, v]) => ({ label: `v${k}`, value: v }))}
          />
        </Section>
        <Section title="Activity by hour (UTC)" note="All telemetry, all time.">
          <BarChart
            labels={telemetry.byHourUtc.map((_, h) => `${String(h).padStart(2, "0")}:00`)}
            values={telemetry.byHourUtc}
            unit="events"
          />
        </Section>
      </div>

      <FeedbackInbox feedback={feedback} />
      <WaitlistTable waitlist={waitlist} />

      <footer className="ad-footer">
        {github.releases?.length ? <>Latest release {github.releases[0]!.tag} · </> : null}
        {github.license ? <>{github.license} · </> : null}
        {telemetry.oldestEvent ? <>tracking since {telemetry.oldestEvent.slice(0, 10)}</> : "no events yet"}
        {telemetry.truncated && <> · showing the most recent 20,000 events</>}
      </footer>
    </main>
  );
}
