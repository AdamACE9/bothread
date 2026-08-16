import { useCallback, useState } from "react";

type EventKey = "package_installed" | "bothread_start" | "room_created";
type Platform = "windows" | "mac" | "linux" | "other";
type Channel = "npx" | "global" | "dev-clone" | "other";

interface TelemetryStats {
  totals: Record<EventKey, number>;
  byPlatform: Record<Platform, number>;
  byChannel: Record<Channel, number>;
  byDayUtc: (Record<EventKey, number> & { date: string })[];
  byHourUtc: number[];
  sampleSize: number;
  oldestEvent: string | null;
  newestEvent: string | null;
}

interface WaitlistEntry {
  email?: string;
  source?: string;
  createdAt: string | null;
}

interface WaitlistStats {
  count: number;
  entries: WaitlistEntry[];
}

interface GithubStats {
  stars?: number;
  forks?: number;
  openIssues?: number;
  watchers?: number;
  createdAt?: string;
  pushedAt?: string;
  error?: string;
}

interface NpmStats {
  lastMonth?: number;
  byDay?: { day: string; downloads: number }[];
  error?: string;
}

interface Stats {
  telemetry: TelemetryStats;
  waitlist: WaitlistStats;
  github: GithubStats;
  npm: NpmStats;
  generatedAt: string;
}

const EVENT_LABEL: Record<EventKey, string> = {
  package_installed: "Installs",
  bothread_start: "Hub starts",
  room_created: "Rooms created",
};

const EVENT_FULL: Record<EventKey, string> = {
  package_installed: "Package installed (npm -g / npx)",
  bothread_start: "bothread start",
  room_created: "Room created",
};

// Fixed categorical order, never reordered by value. Validated CVD-safe
// against this page's dark surface (worst adjacent ΔE 9.4 deutan / 26.5 normal).
const EVENT_COLOR: Record<EventKey, string> = {
  package_installed: "var(--series-1)",
  bothread_start: "var(--series-2)",
  room_created: "var(--series-3)",
};

const EVENT_KEYS: EventKey[] = ["package_installed", "bothread_start", "room_created"];

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
  other: "Other",
};

const nf = (n: number) => n.toLocaleString();

function timeAgo(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/* ---------------------------------------------------------------- primitives */

function Kpi({
  value,
  label,
  meta,
  accent,
}: {
  value: number;
  label: string;
  meta?: string;
  accent?: boolean;
}) {
  return (
    <div className={`ad-kpi${accent ? " ad-kpi-accent" : ""}`}>
      <div className="ad-kpi-value">{nf(value)}</div>
      <div className="ad-kpi-label">{label}</div>
      {meta && <div className="ad-kpi-meta">{meta}</div>}
    </div>
  );
}

function Section({
  title,
  note,
  children,
  action,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
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

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="ad-empty">{children}</div>;
}

/* ------------------------------------------------------------------- charts */

/** Single-series daily bars. Brand copper is safe here: one series has no
 *  CVD adjacent-pair to separate from. */
function DailyBars({
  data,
  label,
}: {
  data: { day: string; downloads: number }[];
  label: string;
}) {
  if (!data.length) return <Empty>No data in this window.</Empty>;
  const max = Math.max(1, ...data.map((d) => d.downloads));
  const total = data.reduce((s, d) => s + d.downloads, 0);
  const peak = data.reduce((a, b) => (b.downloads > a.downloads ? b : a));

  return (
    <div className="ad-card">
      <div className="ad-chart-meta">
        <span>
          <strong>{nf(total)}</strong> total
        </span>
        <span>
          peak <strong>{nf(peak.downloads)}</strong> on {peak.day.slice(5)}
        </span>
      </div>
      <div className="ad-bars" role="img" aria-label={label}>
        {data.map((d) => (
          <div key={d.day} className="ad-bars-col" title={`${d.day}: ${nf(d.downloads)}`}>
            <div
              className="ad-bars-fill"
              style={{ height: `${Math.max(2, (d.downloads / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="ad-axis">
        <span>{data[0]?.day.slice(5)}</span>
        <span>{data[data.length - 1]?.day.slice(5)}</span>
      </div>
    </div>
  );
}

function HourChart({ byHourUtc }: { byHourUtc: number[] }) {
  const max = Math.max(1, ...byHourUtc);
  return (
    <div className="ad-card">
      <div className="ad-bars ad-bars-hour" role="img" aria-label="Events by hour of day, UTC">
        {byHourUtc.map((v, h) => (
          <div key={h} className="ad-bars-col" title={`${String(h).padStart(2, "0")}:00 UTC — ${nf(v)}`}>
            <div className="ad-bars-fill" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="ad-axis ad-axis-hours">
        {[0, 6, 12, 18, 23].map((h) => (
          <span key={h}>{String(h).padStart(2, "0")}</span>
        ))}
      </div>
    </div>
  );
}

function DayLineChart({ byDayUtc }: { byDayUtc: TelemetryStats["byDayUtc"] }) {
  const [showTable, setShowTable] = useState(false);
  const width = 720;
  const height = 210;
  const padX = 28;
  const padY = 22;

  if (byDayUtc.length === 0) return <Empty>No events yet.</Empty>;

  const max = Math.max(1, ...byDayUtc.flatMap((d) => EVENT_KEYS.map((k) => d[k])));
  const stepX = byDayUtc.length > 1 ? (width - padX * 2) / (byDayUtc.length - 1) : 0;
  const yFor = (v: number) => height - padY - (v / max) * (height - padY * 2);
  const xFor = (i: number) => padX + i * stepX;
  const pathFor = (key: EventKey) =>
    byDayUtc.map((d, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(d[key])}`).join(" ");

  return (
    <div className="ad-card">
      <div className="ad-legend">
        {EVENT_KEYS.map((k) => (
          <span key={k} className="ad-legend-item">
            <span className="ad-swatch" style={{ background: EVENT_COLOR[k] }} />
            {EVENT_LABEL[k]}
          </span>
        ))}
        <button type="button" className="ad-btn-sm" onClick={() => setShowTable((s) => !s)}>
          {showTable ? "Chart" : "Table"}
        </button>
      </div>

      {showTable ? (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>Date (UTC)</th>
                {EVENT_KEYS.map((k) => (
                  <th key={k}>{EVENT_LABEL[k]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byDayUtc.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  {EVENT_KEYS.map((k) => (
                    <td key={k}>{d[k]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="ad-line" role="img" aria-label="Daily event counts">
          {[0, 0.5, 1].map((t) => (
            <line
              key={t}
              x1={padX}
              x2={width - padX}
              y1={padY + t * (height - padY * 2)}
              y2={padY + t * (height - padY * 2)}
              className="ad-gridline"
            />
          ))}
          {EVENT_KEYS.map((k) => (
            <path key={k} d={pathFor(k)} fill="none" stroke={EVENT_COLOR[k]} strokeWidth={2} />
          ))}
          {byDayUtc.map((d, i) =>
            EVENT_KEYS.map((k) => (
              <circle key={`${k}-${d.date}`} cx={xFor(i)} cy={yFor(d[k])} r={3.5} fill={EVENT_COLOR[k]}>
                <title>{`${d.date} · ${EVENT_FULL[k]}: ${d[k]}`}</title>
              </circle>
            ))
          )}
        </svg>
      )}
    </div>
  );
}

function BreakdownBars({
  rows,
  color,
}: {
  rows: { label: string; value: number }[];
  color: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="ad-card">
      {rows.map((r) => (
        <div key={r.label} className="ad-row">
          <div className="ad-row-label">{r.label}</div>
          <div className="ad-row-track">
            <div
              className="ad-row-fill"
              style={{ width: `${total > 0 ? Math.max(1.5, (r.value / max) * 100) : 0}%`, background: color }}
            />
          </div>
          <div className="ad-row-value">{nf(r.value)}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- waitlist */

function WaitlistTable({ waitlist }: { waitlist: WaitlistStats }) {
  const [copied, setCopied] = useState(false);
  const emails = waitlist.entries.map((e) => e.email).filter(Boolean) as string[];

  async function copyEmails() {
    await navigator.clipboard.writeText(emails.join(", "));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Section
      title="Waitlist"
      note={`${waitlist.count} signup${waitlist.count === 1 ? "" : "s"} (closed — the site now links straight to /start)`}
      action={
        emails.length > 0 ? (
          <button type="button" className="ad-btn-sm" onClick={copyEmails}>
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

  const load = useCallback(async (pw: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin-stats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.status === 401) {
        setError("Wrong password.");
        return;
      }
      if (!res.ok) {
        setError(`Request failed (${res.status}).`);
        return;
      }
      setStats((await res.json()) as Stats);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  if (!stats) {
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

  const { telemetry, waitlist, github, npm } = stats;
  const noTelemetry = telemetry.sampleSize === 0;

  return (
    <main className="ad-root">
      <header className="ad-header">
        <div>
          <h1>Bothread</h1>
          <p className="ad-sub">
            Updated {timeAgo(stats.generatedAt)} · all times UTC
          </p>
        </div>
        <button className="ad-btn-sm" onClick={() => void load(password)} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error && <p className="ad-error">{error}</p>}

      <Section title="Reach" note="Live from the GitHub and npm public APIs.">
        <div className="ad-kpis">
          <Kpi
            value={github.stars ?? 0}
            label="GitHub stars"
            meta={github.forks !== undefined ? `${nf(github.forks)} forks · ${nf(github.openIssues ?? 0)} open issues` : undefined}
            accent
          />
          <Kpi
            value={npm.lastMonth ?? 0}
            label="npm downloads"
            meta="last 30 days"
            accent
          />
          <Kpi value={waitlist.count} label="Waitlist signups" meta="all time" />
          <Kpi
            value={github.watchers ?? 0}
            label="Watchers"
            meta={github.pushedAt ? `pushed ${timeAgo(github.pushedAt)}` : undefined}
          />
        </div>
        {(github.error || npm.error) && (
          <p className="ad-error">
            {github.error && <>GitHub: {github.error}. </>}
            {npm.error && <>npm: {npm.error}.</>}
          </p>
        )}
      </Section>

      {npm.byDay && npm.byDay.length > 0 && (
        <Section title="npm downloads" note="Daily, last 30 days.">
          <DailyBars data={npm.byDay} label="npm downloads per day, last 30 days" />
        </Section>
      )}

      <Section
        title="Product usage"
        note="Anonymous CLI telemetry — installs, hub starts, and rooms created."
      >
        {noTelemetry ? (
          <Empty>
            <strong>No CLI events recorded yet.</strong>
            <p>
              Telemetry only reports from versions that ship it. If the published npm package predates
              the telemetry code, installs won't report until a newer version is published.
            </p>
          </Empty>
        ) : (
          <>
            <div className="ad-kpis">
              {EVENT_KEYS.map((k) => (
                <Kpi key={k} value={telemetry.totals[k]} label={EVENT_LABEL[k]} meta={EVENT_FULL[k]} />
              ))}
            </div>
            <div className="ad-stack">
              <DayLineChart byDayUtc={telemetry.byDayUtc} />
              <div className="ad-two">
                <div>
                  <h3 className="ad-h3">By platform</h3>
                  <BreakdownBars
                    color="var(--series-1)"
                    rows={(Object.keys(telemetry.byPlatform) as Platform[]).map((p) => ({
                      label: PLATFORM_LABEL[p],
                      value: telemetry.byPlatform[p],
                    }))}
                  />
                </div>
                <div>
                  <h3 className="ad-h3">By install channel</h3>
                  <BreakdownBars
                    color="var(--series-2)"
                    rows={(Object.keys(telemetry.byChannel) as Channel[]).map((c) => ({
                      label: CHANNEL_LABEL[c],
                      value: telemetry.byChannel[c],
                    }))}
                  />
                </div>
              </div>
              <div>
                <h3 className="ad-h3">By hour of day (UTC)</h3>
                <HourChart byHourUtc={telemetry.byHourUtc} />
              </div>
            </div>
          </>
        )}
      </Section>

      <WaitlistTable waitlist={waitlist} />
    </main>
  );
}
