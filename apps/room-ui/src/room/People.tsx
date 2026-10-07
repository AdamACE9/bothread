import { useEffect, useRef, useState } from "react";
import type { ParticipantView } from "@bothread/shared";
import { nudgeParticipant, setParticipantStatus } from "../api";
import { relTime } from "../hooks";
import { Icon } from "../icons";
import { useToast } from "../toast";
import { Sparkline, brandColor } from "../charts";
import { Avatar, presence } from "../ui";
import { modelLine } from "./mentions";

/** "src/levels/**" stays "levels/**"; "src/physics.ts" becomes "physics.ts". */
function shortPath(f: string): string {
  const parts = f.split("/").filter(Boolean);
  return parts.slice(/\*/.test(parts[parts.length - 1] ?? "") ? -2 : -1).join("/") || f;
}

function statusLine(p: ParticipantView, now: number): string {
  if (p.status === "revoked") return "Access revoked";
  if (p.status === "left") return `Left ${relTime(p.lastSeen, now)}`;
  if (p.status === "muted") return "Muted";
  if (p.listening) return "Listening";
  if (p.idle) return `Quiet since ${relTime(p.lastSeen, now)}`;
  return `Working, seen ${relTime(p.lastSeen, now)}`;
}

export default function People({
  roomId,
  participants,
  now,
  afterAction,
  onConnect,
  onMention,
  onPing,
  focused,
  onFocusAgent,
  doing,
  activity,
}: {
  roomId: string;
  participants: ParticipantView[];
  /** Messages per minute over the last 10 minutes, per agent name. */
  activity?: Map<string, number[]>;
  now: number;
  afterAction: () => void;
  onConnect: () => void;
  onMention: (name: string) => void;
  onPing: (name: string) => void;
  focused?: string | null;
  onFocusAgent: (name: string | null) => void;
  doing?: Map<string, { label: string; ts: number }>;
}) {
  const agents = participants.filter((p) => p.kind === "agent");
  const here = agents.filter((p) => p.status !== "left" && p.status !== "revoked");
  const gone = agents.filter((p) => p.status === "left" || p.status === "revoked");
  const [showGone, setShowGone] = useState(false);

  return (
    <aside className="people" aria-label="Agents in this room">
      <div className="rail-head">
        <h2>Agents</h2>
        <span className="count">{here.length}</span>
      </div>

      {here.length === 0 ? (
        <div className="people-empty">
          <p>Nobody has joined yet.</p>
          <button className="btn sm" onClick={onConnect}>
            <Icon name="plus" size={13} /> Connect an agent
          </button>
        </div>
      ) : (
        <ul className="people-list">
          {here.map((p) => (
            <AgentCard key={p.id} p={p} roomId={roomId} now={now} afterAction={afterAction} onMention={onMention} onPing={onPing} focused={focused === p.name} onFocus={() => onFocusAgent(focused === p.name ? null : p.name)} doing={doing?.get(p.name)} activity={activity?.get(p.name)} />
          ))}
        </ul>
      )}

      {gone.length > 0 && (
        <div className="people-gone">
          <button className="linkish" onClick={() => setShowGone((s) => !s)} aria-expanded={showGone}>
            <Icon name="chevron" size={13} style={{ transform: showGone ? "none" : "rotate(-90deg)" }} />
            {gone.length} no longer here
          </button>
          {showGone && (
            <ul className="people-list dim">
              {gone.map((p) => (
                <AgentCard key={p.id} p={p} roomId={roomId} now={now} afterAction={afterAction} onMention={onMention} onPing={onPing} focused={focused === p.name} onFocus={() => onFocusAgent(focused === p.name ? null : p.name)} doing={doing?.get(p.name)} activity={activity?.get(p.name)} />
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="people-you">
        <Avatar name="You" kind="human" size={26} />
        <div>
          <div className="nm">You</div>
          <div className="meta">Overseer. Agents see when you're watching.</div>
        </div>
      </div>
    </aside>
  );
}

function AgentCard({
  p,
  roomId,
  now,
  afterAction,
  onMention,
  onPing,
  focused,
  onFocus,
  doing,
  activity,
}: {
  activity?: number[];
  onPing: (name: string) => void;
  focused: boolean;
  onFocus: () => void;
  doing?: { label: string; ts: number };
  p: ParticipantView;
  roomId: string;
  now: number;
  afterAction: () => void;
  onMention: (name: string) => void;
}) {
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = p.status !== "left" && p.status !== "revoked";

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenu(false);
        setConfirmRevoke(false);
      }
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setMenu(false);
    setConfirmRevoke(false);
    try {
      await fn();
      toast.show({ tone: "success", title: done });
      afterAction();
    } catch (err) {
      toast.error(err);
    }
  };

  const nudge = () =>
    act(
      () =>
        nudgeParticipant(roomId, p.id).then((r) => {
          if (!r.listening) toast.show({ title: `${p.name} isn't listening right now`, body: "The nudge waits in the thread for its next turn." });
        }),
      `Nudged ${p.name}`
    );

  return (
    <li className={`agent-card ${presence(p)}${focused ? " focused" : ""}`} style={{ ["--accent" as string]: brandColor(p.brand) }}>
      <span className="agent-av">
        <Avatar name={p.name} brand={p.brand} size={36} ring={presence(p)} />
      </span>
      <div className="agent-body">
        <div className="agent-top">
          <button
            type="button"
            className="nm nm-btn"
            onClick={onFocus}
            aria-pressed={focused}
            title={focused ? "Show the whole thread" : `Show only messages by or mentioning ${p.name}`}
          >
            {p.name}
          </button>
          {p.brand && !p.model && <span className="brand">{p.brand}</span>}
          {active && (
            <button className="ping-btn" onClick={() => onPing(p.name)} title={`Ping ${p.name}: @mention it with Stop and read`}>
              <Icon name="zap" size={12} /> Ping
            </button>
          )}
          {active && (
            <div className="menu-wrap" ref={menuRef}>
              <button className="icon-btn sm" onClick={() => setMenu((m) => !m)} aria-label={`Actions for ${p.name}`} aria-expanded={menu}>
                <Icon name="more" size={15} />
              </button>
              {menu && (
                <div className="menu" role="menu">
                  <button role="menuitem" onClick={() => (setMenu(false), onMention(p.name))}>
                    <Icon name="reply" size={14} /> Message {p.name}
                  </button>
                  <button role="menuitem" onClick={() => (setMenu(false), onPing(p.name))}>
                    <Icon name="zap" size={14} /> Ping (stop and read)
                  </button>
                  <button role="menuitem" onClick={() => (setMenu(false), onFocus())}>
                    <Icon name="search" size={14} /> {focused ? "Show the whole thread" : "Show only its messages"}
                  </button>
                  <button role="menuitem" onClick={nudge}>
                    <Icon name="bell" size={14} /> Nudge
                  </button>
                  {p.status === "muted" ? (
                    <button role="menuitem" onClick={() => act(() => setParticipantStatus(roomId, p.id, "active"), `Unmuted ${p.name}`)}>
                      <Icon name="play" size={14} /> Unmute
                    </button>
                  ) : (
                    <button role="menuitem" onClick={() => act(() => setParticipantStatus(roomId, p.id, "muted"), `Muted ${p.name}`)}>
                      <Icon name="pause" size={14} /> Mute
                    </button>
                  )}
                  {confirmRevoke ? (
                    <button
                      role="menuitem"
                      className="danger solid"
                      onClick={() => act(() => setParticipantStatus(roomId, p.id, "revoked"), `Revoked ${p.name}`)}
                    >
                      <Icon name="shield" size={14} /> Yes, revoke and free its files
                    </button>
                  ) : (
                    <button role="menuitem" className="danger" onClick={() => setConfirmRevoke(true)}>
                      <Icon name="shield" size={14} /> Revoke access
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {modelLine(p) && (
          <div className="agent-model" title={modelLine(p)}>
            {modelLine(p)}
          </div>
        )}
        <div className={`agent-status ${presence(p)}`}>
          {p.listening && active && <span className="pulse" aria-hidden="true" />}
          {statusLine(p, now)}
          {active && p.idle && !p.listening && (
            <button className="linkish" onClick={nudge}>
              Nudge
            </button>
          )}
        </div>
        {doing && active && (
          <div className="agent-doing" title={new Date(doing.ts).toLocaleString()}>
            <span className="doing-mark" aria-hidden="true" />
            <span className="doing-text">{doing.label}</span>
            <span className="doing-when">{relTime(doing.ts, now)}</span>
          </div>
        )}
        {active && activity && (
          <div className="agent-pulse">
            <Sparkline values={activity} width={92} height={22} color={brandColor(p.brand)} label={`${p.name}: messages per minute, last 10 minutes`} />
            <span className="pulse-n">
              {activity.reduce((a, b) => a + b, 0)}
              <small> msgs, 10 min</small>
            </span>
          </div>
        )}
        {p.claimedFiles.length > 0 && (
          <div className="agent-files" title={p.claimedFiles.join("\n")}>
            {p.claimedFiles.slice(0, 3).map((f) => (
              <code key={f}>
                <Icon name="lock" size={10} />
                {shortPath(f)}
              </code>
            ))}
            {p.claimedFiles.length > 3 && <span className="more">+{p.claimedFiles.length - 3}</span>}
          </div>
        )}
        {p.capabilities && p.capabilities.length > 0 && (
          <div className="agent-caps" title="Declared by the agent when it joined">
            {p.capabilities.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
