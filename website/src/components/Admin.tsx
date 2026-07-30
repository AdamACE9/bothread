import { useState } from "react";

type EventKey = "package_installed" | "bothread_start" | "room_created";
type Platform = "windows" | "mac" | "linux" | "other";
type Channel = "npx" | "global" | "dev-clone" | "other";

interface Stats {
  totals: Record<EventKey, number>;
  byPlatform: Record<Platform, number>;
  byChannel: Record<Channel, number>;
  byDayUtc: (Record<EventKey, number> & { date: string })[];
  byHourUtc: number[];
  sampleSize: number;
  oldestEvent: string | null;
  newestEvent: string | null;
  generatedAt: string;
}

const EVENT_LABEL: Record<EventKey, string> = {
  package_installed: "Package installed (npm/npx fetch)",
  bothread_start: "bothread start",
  room_created: "Room created",
};

// Fixed categorical order — slots 1/2/3 from the validated palette, never reordered by value.
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
const PLATFORM_COLOR: Record<Platform, string> = {
  windows: "var(--series-1)",
  mac: "var(--series-2)",
  linux: "var(--series-3)",
  other: "var(--series-4)",
};

const CHANNEL_LABEL: Record<Channel, string> = {
  npx: "npx bothread start",
  global: "npm install -g bothread",
  "dev-clone": "git clone (dev)",
  other: "Other",
};
const CHANNEL_COLOR: Record<Channel, string> = {
  npx: "var(--series-1)",
  global: "var(--series-2)",
  "dev-clone": "var(--series-3)",
  other: "var(--series-4)",
};

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="admin-tile">
      <div className="admin-tile-value">{value.toLocaleString()}</div>
      <div className="admin-tile-label">{label}</div>
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="admin-bar-row" title={`${label}: ${value.toLocaleString()}`}>
      <div className="admin-bar-label">{label}</div>
      <div className="admin-bar-track">
        <div className="admin-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="admin-bar-value">{value.toLocaleString()}</div>
    </div>
  );
}

function HourChart({ byHourUtc }: { byHourUtc: number[] }) {
  const max = Math.max(1, ...byHourUtc);
  return (
    <div className="admin-hour-chart" role="img" aria-label="Events by hour of day, UTC">
      {byHourUtc.map((v, h) => (
        <div key={h} className="admin-hour-col" title={`${h}:00 UTC — ${v.toLocaleString()}`}>
          <div
            className="admin-hour-fill"
            style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
          />
          {h % 3 === 0 && <div className="admin-hour-tick">{h}</div>}
        </div>
      ))}
    </div>
  );
}

function DayLineChart({ byDayUtc }: { byDayUtc: Stats["byDayUtc"] }) {
  const [showTable, setShowTable] = useState(false);
  const keys: EventKey[] = ["package_installed", "bothread_start", "room_created"];
  const width = 720;
  const height = 200;
  const pad = 24;

  if (byDayUtc.length === 0) {
    return <p className="admin-empty">No events yet.</p>;
  }

  const max = Math.max(1, ...byDayUtc.flatMap((d) => keys.map((k) => d[k])));
  const stepX = byDayUtc.length > 1 ? (width - pad * 2) / (byDayUtc.length - 1) : 0;
  const yFor = (v: number) => height - pad - (v / max) * (height - pad * 2);
  const xFor = (i: number) => pad + i * stepX;

  const pathFor = (key: EventKey) =>
    byDayUtc.map((d, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(d[key])}`).join(" ");

  return (
    <div>
      <div className="admin-legend">
        {keys.map((k) => (
          <span key={k} className="admin-legend-item">
            <span className="admin-legend-swatch" style={{ background: EVENT_COLOR[k] }} />
            {EVENT_LABEL[k]}
          </span>
        ))}
        <button type="button" className="admin-table-toggle" onClick={() => setShowTable((s) => !s)}>
          {showTable ? "Show chart" : "Show table"}
        </button>
      </div>

      {showTable ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Date (UTC)</th>
                {keys.map((k) => (
                  <th key={k}>{EVENT_LABEL[k]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byDayUtc.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  {keys.map((k) => (
                    <td key={k}>{d[k]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="admin-line-chart" role="img" aria-label="Daily event counts">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <line
              key={t}
              x1={pad}
              x2={width - pad}
              y1={pad + t * (height - pad * 2)}
              y2={pad + t * (height - pad * 2)}
              className="admin-gridline"
            />
          ))}
          {keys.map((k) => (
            <path key={k} d={pathFor(k)} fill="none" stroke={EVENT_COLOR[k]} strokeWidth={2} />
          ))}
          {byDayUtc.map((d, i) =>
            keys.map((k) => (
              <circle key={`${k}-${d.date}`} cx={xFor(i)} cy={yFor(d[k])} r={3} fill={EVENT_COLOR[k]}>
                <title>{`${d.date} · ${EVENT_LABEL[k]}: ${d[k]}`}</title>
              </circle>
            ))
          )}
        </svg>
      )}
    </div>
  );
}

export default function Admin() {
  const [password, setPassword] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin-stats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) {
        setError("Wrong password.");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError(`Something went wrong (${res.status}).`);
        setLoading(false);
        return;
      }
      setStats((await res.json()) as Stats);
    } catch {
      setError("Couldn't reach the server.");
    }
    setLoading(false);
  }

  if (!stats) {
    return (
      <main className="admin-gate">
        <form onSubmit={submit} className="admin-gate-form">
          <h1>Bothread admin</h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
          />
          <button type="submit" disabled={loading}>
            {loading ? "Checking…" : "Enter"}
          </button>
          {error && <p className="admin-error">{error}</p>}
        </form>
      </main>
    );
  }

  const eventKeys: EventKey[] = ["package_installed", "bothread_start", "room_created"];
  const platformMax = Math.max(1, ...Object.values(stats.byPlatform));
  const channelMax = Math.max(1, ...Object.values(stats.byChannel));

  return (
    <main className="admin-root">
      <div className="admin-header">
        <h1>Bothread usage</h1>
        <p className="admin-sub">
          {stats.sampleSize.toLocaleString()} events
          {stats.oldestEvent && (
            <> · since {new Date(stats.oldestEvent).toISOString().slice(0, 10)}</>
          )}
          {" · times shown in UTC (no timezone is collected)"}
        </p>
      </div>

      <div className="admin-tiles">
        {eventKeys.map((k) => (
          <StatTile key={k} label={EVENT_LABEL[k]} value={stats.totals[k]} />
        ))}
      </div>

      <section className="admin-section">
        <h2>By day</h2>
        <DayLineChart byDayUtc={stats.byDayUtc} />
      </section>

      <section className="admin-section">
        <h2>By hour of day (UTC)</h2>
        <HourChart byHourUtc={stats.byHourUtc} />
      </section>

      <div className="admin-two-col">
        <section className="admin-section">
          <h2>By platform</h2>
          {(Object.keys(stats.byPlatform) as Platform[]).map((p) => (
            <BarRow
              key={p}
              label={PLATFORM_LABEL[p]}
              value={stats.byPlatform[p]}
              max={platformMax}
              color={PLATFORM_COLOR[p]}
            />
          ))}
        </section>

        <section className="admin-section">
          <h2>By install channel</h2>
          {(Object.keys(stats.byChannel) as Channel[]).map((c) => (
            <BarRow
              key={c}
              label={CHANNEL_LABEL[c]}
              value={stats.byChannel[c]}
              max={channelMax}
              color={CHANNEL_COLOR[c]}
            />
          ))}
        </section>
      </div>
    </main>
  );
}
