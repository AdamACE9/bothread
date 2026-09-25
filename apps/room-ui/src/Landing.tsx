import { useEffect, useMemo, useRef, useState } from "react";
import { createRoom, deleteRoom, getConnectInfo, getHealth, listRoomSummaries, type RoomSummary } from "./api";
import { relTime, useNow } from "./hooks";
import { Icon } from "./icons";
import { usePalette, usePaletteActions } from "./palette";
import { useToast } from "./toast";
import { Avatar, CopyButton, Kbd } from "./ui";
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

      <main className="home-main">
        <section className="home-intro">
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
              <input
                ref={nameRef}
                className="field lg"
                autoFocus
                placeholder="payments-refactor"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
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
            <button className="btn primary lg" type="submit" disabled={busy}>
              <Icon name="plus" size={16} />
              {busy ? "Creating" : "Create room"}
            </button>
          </form>
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
            <ul className="room-list">
              {visible.map((s) => (
                <li key={s.room.id}>
                  <div
                    className={`room-row${s.pendingApprovals ? " needs-you" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(s.room.id)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(s.room.id))}
                  >
                    <div className="room-main">
                      <div className="room-title">
                        <span className="nm">{s.room.name}</span>
                        {s.room.status !== "active" && <span className={`pill ${s.room.status}`}>{s.room.status}</span>}
                      </div>
                      {s.room.projectPath ? (
                        <div className="room-path" title={s.room.projectPath}>
                          <Icon name="folder" size={12} />
                          {s.room.projectPath}
                        </div>
                      ) : (
                        <div className="room-path dim">No project folder</div>
                      )}
                    </div>
                    <div className="room-stack" aria-label={`${s.agents.length} agents`}>
                      {s.agents.slice(0, 4).map((a) => (
                        <span key={a.name} title={a.name}>
                          <Avatar name={a.name} brand={a.brand} size={26} />
                        </span>
                      ))}
                      {s.agents.length > 4 && <span className="more">+{s.agents.length - 4}</span>}
                      {s.agents.length === 0 && <span className="none">no agents</span>}
                    </div>
                    <div className="room-stats">
                      {s.pendingApprovals > 0 ? (
                        <span className="stat hot">
                          {s.pendingApprovals} approval{s.pendingApprovals === 1 ? "" : "s"}
                        </span>
                      ) : s.activeClaims > 0 ? (
                        <span className="stat">
                          {s.activeClaims} claim{s.activeClaims === 1 ? "" : "s"}
                        </span>
                      ) : null}
                      <span className="stat dim">{relTime(s.lastActivityAt, now)}</span>
                    </div>
                    <div className="room-del" onClick={(e) => e.stopPropagation()}>
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
                        <button
                          className="icon-btn sm"
                          title="Delete room"
                          aria-label={`Delete room ${s.room.name}`}
                          onClick={() => setConfirmDelete(s.room.id)}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
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
