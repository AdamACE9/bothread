import { useEffect, useMemo, useRef, useState } from "react";
import { createRoom, deleteRoom, getAudit, getConnectInfo, getHealth, listRoomSummaries, startDemo, type RoomSummary } from "./api";
import { relTime, useNow } from "./hooks";
import { Icon } from "./icons";
import { usePalette, usePaletteActions } from "./palette";
import { useToast } from "./toast";
import { Sparkline, brandColor, bucketize } from "./charts";
import { CopyButton, Kbd, initials } from "./ui";
import { modKey } from "./hooks";

export function Wordmark() {
  return (
    <span className="wordmark">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="wm" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="var(--copper)" />
            <stop offset=".55" stopColor="var(--saffron)" />
            <stop offset="1" stopColor="var(--teal)" />
          </linearGradient>
        </defs>
        <path d="M4 10c6 0 6 12 12 12s6-12 12-12" fill="none" stroke="url(#wm)" strokeWidth="3" strokeLinecap="round" />
        <path d="M4 22c6 0 6-12 12-12s6 12 12 12" fill="none" stroke="url(#wm)" strokeWidth="3" strokeLinecap="round" opacity=".55" />
      </svg>
      Bothread
    </span>
  );
}

export default function Landing({
  onOpen,
  theme,
  onToggleTheme,
}: {
  onOpen: (id: string) => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}) {
  const toast = useToast();
  const palette = usePalette();
  const now = useNow(20_000);
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [name, setName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [hub, setHub] = useState<{ version?: string; sessions: number; mcpUrl?: string } | null>(null);
  const [hubDown, setHubDown] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const [pulse, setPulse] = useState<Map<string, number[]>>(new Map());

  const refresh = () =>
    listRoomSummaries()
      .then((r) => {
        setRooms(r);
        setHubDown(false);
      })
      .catch(() => setHubDown(true));

  useEffect(() => {
    refresh();
    Promise.all([getHealth(), getConnectInfo()])
      .then(([h, c]) => setHub({ version: h.version, sessions: h.sessions, mcpUrl: c.mcpUrl }))
      .catch(() => setHubDown(true));
    // The list is cheap; keep "last active" and agent stacks fresh while it's open.
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    document.title = "Bothread";
  }, []);

  // A sparkline per room: audit events per 2.5 minutes over the last hour, for the rooms on screen.
  const roomIds = (rooms ?? []).slice(0, 12).map((s) => s.room.id).join(",");
  useEffect(() => {
    if (!roomIds) return;
    let alive = true;
    const load = () =>
      Promise.all(
        roomIds.split(",").map((id) =>
          getAudit(id, 200)
            .then((ev) => [id, bucketize(ev.map((e) => e.ts), Date.now(), 60 * 60_000, 24)] as const)
            .catch(() => null)
        )
      ).then((list) => alive && setPulse(new Map(list.filter((x): x is readonly [string, number[]] => !!x).map(([k, v]) => [k, v]))));
    load();
    const iv = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [roomIds]);

  const create = async () => {
    const n = name.trim();
    if (!n) {
      nameRef.current?.focus();
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const { room } = await createRoom(n, projectPath.trim() || undefined);
      setName("");
      setProjectPath("");
      onOpen(room.id);
    } catch (err) {
      toast.error(err, "Couldn't create the room");
    } finally {
      setBusy(false);
    }
  };

  const [demoBusy, setDemoBusy] = useState(false);
  const openDemo = async () => {
    if (demoBusy) return;
    setDemoBusy(true);
    try {
      const { roomId } = await startDemo();
      onOpen(roomId);
    } catch (err) {
      toast.error(err, "Couldn't start the demo");
    } finally {
      setDemoBusy(false);
    }
  };

  const remove = async (s: RoomSummary) => {
    setConfirmDelete(null);
    try {
      await deleteRoom(s.room.id);
      setRooms((prev) => prev?.filter((x) => x.room.id !== s.room.id) ?? null);
      toast.show({ tone: "info", title: `Deleted "${s.room.name}"` });
    } catch (err) {
      toast.error(err, "Couldn't delete the room");
    }
  };

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = rooms ?? [];
    const f = q ? list.filter((s) => `${s.room.name} ${s.room.projectPath ?? ""}`.toLowerCase().includes(q)) : list;
    // Rooms that need you first, then most recently active.
    return [...f].sort((a, b) => b.pendingApprovals - a.pendingApprovals || b.lastActivityAt - a.lastActivityAt);
  }, [rooms, filter]);

  usePaletteActions("landing", [
    { id: "new-room", group: "Rooms", label: "Create a new room", icon: "plus", run: () => nameRef.current?.focus() },
    ...(rooms ?? []).slice(0, 12).map((s) => ({
      id: `open-${s.room.id}`,
      group: "Open room",
      label: s.room.name,
      icon: "users" as const,
      hint: relTime(s.lastActivityAt, now),
      run: () => onOpen(s.room.id),
    })),
  ]);

  const waiting = (rooms ?? []).reduce((n, s) => n + s.pendingApprovals, 0);

  return (
    <div className="home">
      <header className="home-bar">
        <Wordmark />
        <span className={`hub-chip${hubDown ? " down" : ""}`}>
          <span className="hub-dot" />
          {hubDown ? "Hub unreachable" : hub ? `Hub running${hub.version ? ` v${hub.version}` : ""}` : "Connecting"}
        </span>
        <span className="spacer" />
        {hub?.mcpUrl && (
          <span className="mcp-chip" title="Agents connect to this MCP endpoint">
            <span className="mcp-label">MCP</span>
            <code>{hub.mcpUrl}</code>
            <CopyButton text={hub.mcpUrl} label="" done="" className="icon-btn sm" />
          </span>
        )}
        <button className="icon-btn" onClick={palette.open} aria-label="Command palette" title={`Command palette (${modKey}K)`}>
          <Icon name="command" />
        </button>
        <button className="icon-btn" onClick={onToggleTheme} aria-label="Toggle theme" title="Toggle theme">
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
      </header>

      <main className="home-main v2">
        <section className="hero">
          <div className="hero-copy">
            <h1>Your agents, one room, you in charge.</h1>
            <p className="lede">
              Start a room and paste its session ID into each coding agent. They claim files before editing, talk in one
              thread, and ask you before anything risky.
            </p>
            <form
              className="create-card"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <label className="create-field">
                <span>Room name</span>
                <input ref={nameRef} className="field lg" autoFocus placeholder="payments-refactor" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              </label>
              <label className="create-field">
                <span>
                  Project folder <em>optional</em>
                </span>
                <input
                  className="field mono"
                  placeholder="/Users/you/code/my-app  or  C:\code\my-app"
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  spellCheck={false}
                />
                <small>If it's a git repo, every agent's edits come back as a diff you can merge, trim or throw away.</small>
              </label>
              <div className="create-actions">
                <button className="btn primary lg" type="submit" disabled={busy}>
                  <Icon name="plus" size={16} />
                  {busy ? "Creating" : "Create room"}
                </button>
                <button className="btn lg demo-btn" type="button" onClick={openDemo} disabled={demoBusy} title="Three simulated agents working in a demo room">
                  <span className="demo-dot" aria-hidden="true" />
                  {demoBusy ? "Starting demo" : "See a live demo"}
                </button>
              </div>
            </form>
          </div>
          <LoomArt />
        </section>

        <section className="home-rooms" aria-label="Your rooms">
          <div className="rooms-head">
            <h2>
              Rooms {rooms && rooms.length > 0 && <span className="count">{rooms.length}</span>}
            </h2>
            {waiting > 0 && (
              <span className="attention">
                <Icon name="hand" size={14} /> {waiting} waiting on you
              </span>
            )}
            <span className="spacer" />
            {(rooms?.length ?? 0) > 4 && (
              <label className="filter">
                <Icon name="search" size={14} />
                <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </label>
            )}
          </div>

          {rooms === null ? (
            <div className="rooms-skeleton">
              <span />
              <span />
            </div>
          ) : rooms.length === 0 ? (
            <FirstRun />
          ) : visible.length === 0 ? (
            <p className="muted-line">No room matches "{filter}".</p>
          ) : (
            <ul className="room-grid">
              {visible.map((s) => {
                const active = now - s.lastActivityAt < 3 * 60_000 && s.room.status === "active";
                const series = pulse.get(s.room.id);
                return (
                  <li key={s.room.id}>
                    <div
                      className={`room-card${s.pendingApprovals ? " needs-you" : ""}${active ? " active" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${s.room.name}`}
                      onClick={() => onOpen(s.room.id)}
                      onKeyDown={(e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(s.room.id))}
                    >
                      <div className="rc-top">
                        <Orbit agents={s.agents} active={active} count={s.messageCount} />
                        <div className="rc-id">
                          <div className="room-title">
                            <span className="nm">{s.room.name}</span>
                            {s.room.status !== "active" && <span className={`pill ${s.room.status}`}>{s.room.status}</span>}
                          </div>
                          {s.room.projectPath ? (
                            <div className="room-path" title={s.room.projectPath}>
                              <Icon name="folder" size={12} />
                              <span>{s.room.projectPath}</span>
                            </div>
                          ) : (
                            <div className="room-path dim">No project folder</div>
                          )}
                          <div className={`rc-when${active ? " live" : ""}`}>
                            {active && <span className="live-dot" aria-hidden="true" />}
                            {active ? "Active now" : `Last active ${relTime(s.lastActivityAt, now)}`}
                          </div>
                        </div>
                        <div className="room-del" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                          {confirmDelete === s.room.id ? (
                            <span className="confirm">
                              <button className="btn sm danger solid" onClick={() => remove(s)}>
                                Delete forever
                              </button>
                              <button className="btn sm ghost" onClick={() => setConfirmDelete(null)}>
                                Keep
                              </button>
                            </span>
                          ) : (
                            <button className="icon-btn sm" title="Delete room" aria-label={`Delete room ${s.room.name}`} onClick={() => setConfirmDelete(s.room.id)}>
                              <Icon name="trash" size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                      <dl className="rc-stats">
                        <div>
                          <dt>Agents</dt>
                          <dd>{s.agents.length}</dd>
                        </div>
                        <div>
                          <dt>Messages</dt>
                          <dd>{s.messageCount}</dd>
                        </div>
                        <div>
                          <dt>Claims</dt>
                          <dd>{s.activeClaims}</dd>
                        </div>
                        <div className={s.pendingApprovals ? "hot" : ""}>
                          <dt>Approvals</dt>
                          <dd>{s.pendingApprovals}</dd>
                        </div>
                      </dl>
                      <div className="rc-spark">
                        <Sparkline values={series ?? new Array(24).fill(0)} width={300} height={34} color={s.pendingApprovals ? "var(--clay)" : "var(--copper)"} label={`${s.room.name}: activity over the last hour`} />
                        <span className="rc-spark-cap">{series && series.some(Boolean) ? "Activity, last hour" : "Quiet for the last hour"}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      <footer className="home-foot">
        <span>
          Press <Kbd>{modKey}</Kbd>
          <Kbd>K</Kbd> for commands, <Kbd>?</Kbd> for shortcuts
        </span>
        <span className="spacer" />
        <span>Runs on this machine. Your code never leaves it.</span>
      </footer>
    </div>
  );
}

/** A room as a little orbit: its agents on a ring, a shuttle circling while it's active. */
function Orbit({ agents, active, count }: { agents: { name: string; brand: string | null }[]; active: boolean; count: number }) {
  const size = 84;
  const c = size / 2;
  const r = 30;
  const shown = agents.slice(0, 6);
  return (
    <svg className={`orbit${active ? " spin" : ""}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${agents.length} agents${active ? ", active now" : ""}`}>
      <circle cx={c} cy={c} r={r} className="orbit-ring" />
      <circle cx={c} cy={c} r={r - 11} className="orbit-ring inner" />
      <g className="orbit-shuttle">
        <circle cx={c + r} cy={c} r={2.6} />
      </g>
      <text x={c} y={c + 4} textAnchor="middle" className="orbit-count">
        {count > 999 ? `${Math.round(count / 100) / 10}k` : count}
      </text>
      {shown.map((a, i) => {
        const ang = (i / Math.max(1, shown.length)) * Math.PI * 2 - Math.PI / 2;
        const x = c + r * Math.cos(ang);
        const y = c + r * Math.sin(ang);
        const col = brandColor(a.brand);
        return (
          <g key={a.name} className="orbit-node">
            <title>{a.name}</title>
            <circle cx={x} cy={y} r={9.5} className="orbit-node-bg" style={{ stroke: col }} />
            <text x={x} y={y + 3} textAnchor="middle" style={{ fill: col }}>
              {initials(a.name)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** The hero: warp threads, three agents riding the weft, a copper shuttle drawing the line between them. */
function LoomArt() {
  const warps = Array.from({ length: 13 }, (_, i) => 30 + i * 32);
  const wefts = [
    { y: 92, cls: "w1", agent: { x: 126, label: "CC", color: "var(--claude)" } },
    { y: 180, cls: "w2", agent: { x: 286, label: "CU", color: "var(--cursor)" } },
    { y: 268, cls: "w3", agent: { x: 190, label: "CO", color: "var(--codex)" } },
  ];
  const weave = (y: number, phase: number) => {
    let d = `M14,${y}`;
    for (let i = 0; i < warps.length; i++) {
      const x = warps[i]!;
      const dy = (i + phase) % 2 === 0 ? -7 : 7;
      d += ` Q${x - 16},${y + dy} ${x},${y}`;
    }
    return `${d} T${436},${y}`;
  };
  return (
    <div className="loom-art" aria-hidden="true">
      <svg viewBox="0 0 450 360" width="100%" height="100%">
        <defs>
          <linearGradient id="loom-thread" x1="0" x2="1">
            <stop offset="0" stopColor="var(--copper)" />
            <stop offset="1" stopColor="var(--saffron)" />
          </linearGradient>
          <radialGradient id="loom-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="var(--copper)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--copper)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="225" cy="180" rx="220" ry="170" fill="url(#loom-glow)" />
        {warps.map((x) => (
          <line key={x} x1={x} x2={x} y1={28} y2={332} className="warp" />
        ))}
        {wefts.map((w, i) => (
          <g key={w.cls}>
            <path d={weave(w.y, i)} className={`weft ${w.cls}`} />
            <path d={weave(w.y, i)} className={`weft-run ${w.cls}`} pathLength={100} />
          </g>
        ))}
        <path d="M126,92 C190,110 230,160 286,180 S220,240 190,268" className="tie" pathLength={100} />
        {wefts.map((w) => (
          <g key={w.agent.label} className={`loom-agent ${w.cls}`}>
            <circle cx={w.agent.x} cy={w.y} r={19} className="la-halo" style={{ fill: w.agent.color }} />
            <circle cx={w.agent.x} cy={w.y} r={14} className="la-core" style={{ stroke: w.agent.color }} />
            <text x={w.agent.x} y={w.y + 4} textAnchor="middle" style={{ fill: w.agent.color }}>
              {w.agent.label}
            </text>
          </g>
        ))}
        <g className="loom-you">
          <rect x="356" y="296" width="70" height="28" rx="14" />
          <text x="391" y="314" textAnchor="middle">
            You
          </text>
        </g>
      </svg>
    </div>
  );
}

function FirstRun() {
  return (
    <ol className="first-run">
      <li>
        <strong>Name a room</strong>
        <span>One room per piece of work. Point it at your repo to review each agent's diff.</span>
      </li>
      <li>
        <strong>Connect your agents</strong>
        <span>The room gives you a two-prompt setup for Claude Code, Cursor, Gemini, Codex and more.</span>
      </li>
      <li>
        <strong>Watch and steer</strong>
        <span>See every message and file claim live. Pause, redirect, approve or revoke at any time.</span>
      </li>
    </ol>
  );
}
