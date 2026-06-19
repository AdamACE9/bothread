import { useEffect, useRef, useState } from "react";
import type { AgentBranch, Approval, ThreadEntry } from "@bothread/shared";
import { decideApproval, discardBranch, listBranches, mergeBranch, sendOverseer, setParticipantStatus, setRoomStatus } from "./api";
import ConnectPanel from "./ConnectPanel";
import { useRoom } from "./useRoom";
import { Avatar, brandClass, fmtTime, richText } from "./ui";

export default function RoomView({ roomId, onBack }: { roomId: string; onBack: () => void }) {
  const { detail, connected, refresh } = useRoom(roomId);
  const [showConnect, setShowConnect] = useState(false);
  const [rightTab, setRightTab] = useState<"locks" | "changes">("locks");

  if (!detail) {
    return (
      <div className="room-app">
        <header className="rhead">
          <button className="back" onClick={onBack} aria-label="Back to rooms">
            ‹
          </button>
          <h1>Loading room…</h1>
        </header>
        <div />
        <div />
      </div>
    );
  }

  const { snapshot, sessionId, leases, pendingApprovals } = detail;
  const brandByName = new Map(snapshot.participants.map((p) => [p.name, p.brand]));
  const pending = pendingApprovals[0];

  return (
    <div className="room-app">
      <Header
        roomId={roomId}
        name={snapshot.room.name}
        status={snapshot.room.status}
        sessionId={sessionId}
        connected={connected}
        agents={snapshot.participants.filter((p) => p.kind === "agent" && p.status !== "left").length}
        onBack={onBack}
        afterAction={refresh}
        onConnect={() => setShowConnect(true)}
      />

      <div className="rmain">
        <aside className="rail">
          <h2>Participants</h2>
          {snapshot.participants.map((p) => (
            <div className="part" key={p.id}>
              <Avatar name={p.name} brand={p.brand} kind={p.kind} />
              <div>
                <div className="nm">
                  {p.name}
                  <span className={`statusdot ${p.status}`} title={p.status} />
                </div>
                <div className="meta">
                  {p.kind === "human" ? "overseer" : p.brand ?? "agent"} · {p.status}
                </div>
                {p.claimedFiles.length > 0 && (
                  <div className="files">
                    {p.claimedFiles.map((f) => (
                      <code key={f}>{f}</code>
                    ))}
                  </div>
                )}
                {p.kind === "agent" && p.status !== "revoked" && (
                  <div className="acts">
                    {p.status === "muted" ? (
                      <button
                        className="btn sm"
                        onClick={() => setParticipantStatus(roomId, p.id, "active").then(refresh)}
                      >
                        Unmute
                      </button>
                    ) : (
                      <button
                        className="btn sm"
                        onClick={() => setParticipantStatus(roomId, p.id, "muted").then(refresh)}
                      >
                        Mute
                      </button>
                    )}
                    <button
                      className="btn sm danger"
                      onClick={() => setParticipantStatus(roomId, p.id, "revoked").then(refresh)}
                    >
                      Revoke
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </aside>

        <Thread thread={snapshot.thread} brandByName={brandByName} />

        <aside className="rail right">
          <div className="rail-tabs">
            <button
              className={`rail-tab${rightTab === "locks" ? " active" : ""}`}
              onClick={() => setRightTab("locks")}
            >
              Locks
            </button>
            <button
              className={`rail-tab${rightTab === "changes" ? " active" : ""}`}
              onClick={() => setRightTab("changes")}
            >
              Changes
            </button>
          </div>

          {rightTab === "locks" ? (
            <>
              {leases.length === 0 ? (
                <p className="empty">No files claimed.</p>
              ) : (
                leases.map((l) => (
                  <div className="lock" key={l.id}>
                    <div className="path">{l.pathPattern}</div>
                    <div className="holder">
                      <span className={`av ${brandClass(brandByName.get(l.participantName) ?? "")}`} style={{ width: 18, height: 18, fontSize: ".55rem" }}>
                        {l.participantName.slice(0, 1)}
                      </span>
                      {l.participantName}
                      <span className="ex" style={{ marginLeft: "auto" }}>
                        {l.exclusive ? "excl" : "shared"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </>
          ) : (
            <BranchPanel roomId={roomId} afterAction={refresh} />
          )}
        </aside>
      </div>

      <CommandBar roomId={roomId} paused={snapshot.room.status === "paused"} afterSend={refresh} />

      {pending && <ApprovalDock roomId={roomId} approval={pending} afterDecide={refresh} />}

      {showConnect && <ConnectPanel sessionId={sessionId} onClose={() => setShowConnect(false)} />}
    </div>
  );
}

function Header(props: {
  roomId: string;
  name: string;
  status: string;
  sessionId: string;
  connected: boolean;
  agents: number;
  onBack: () => void;
  afterAction: () => void;
  onConnect: () => void;
}) {
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  const paused = props.status === "paused";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  };

  return (
    <header className="rhead">
      <button className="back" onClick={props.onBack} aria-label="Back to rooms">
        ‹
      </button>
      <h1>{props.name}</h1>
      <span className={`pill ${props.status}`}>
        <span className="dot" />
        {props.status}
      </span>
      <span className="conn" title={props.connected ? "Live" : "Reconnecting…"} aria-live="polite">
        <span className={props.connected ? "dot on" : "dot"} style={{ width: 7, height: 7, borderRadius: "50%" }} />
      </span>
      <span className="meta mono" style={{ fontSize: ".72rem", color: "var(--muted-1)" }}>
        {props.agents} agent{props.agents === 1 ? "" : "s"}
      </span>

      <span className="spacer" />

      <button className="btn primary" onClick={props.onConnect}>
        + Connect an agent
      </button>

      <span className="sid">
        session
        <code>{reveal ? props.sessionId : "•".repeat(16)}</code>
        <button className="btn sm" onClick={() => setReveal((r) => !r)}>
          {reveal ? "Hide" : "Reveal"}
        </button>
        <button className="btn sm" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </span>

      <button
        className="btn"
        onClick={() => setRoomStatus(props.roomId, paused ? "active" : "paused").then(props.afterAction)}
      >
        {paused ? "Resume" : "Pause"}
      </button>
    </header>
  );
}

function Thread({ thread, brandByName }: { thread: ThreadEntry[]; brandByName: Map<string, string | undefined> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length]);

  return (
    <div className="thread" ref={ref} role="log" aria-live="polite" aria-label="Room conversation">
      {thread.map((m) => {
        if (m.kind === "system") {
          const cls = m.importance === "interrupt" ? "interrupt" : m.importance === "steering" ? "steering" : "";
          return (
            <div className={`sysline ${cls}`} key={m.seq} role={m.importance === "interrupt" ? "alert" : undefined}>
              <span className="bar" />
              <span>{richText(m.text)}</span>
            </div>
          );
        }
        return (
          <div className={`msg ${m.kind}`} key={m.seq}>
            <Avatar name={m.author} brand={brandByName.get(m.author)} kind={m.kind === "human" ? "human" : "agent"} />
            <div className="body">
              <div className="head">
                <span className="author">{m.author}</span>
                <span className="time">{fmtTime(m.at)}</span>
              </div>
              <div className="text">{richText(m.text)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CommandBar({ roomId, paused, afterSend }: { roomId: string; paused: boolean; afterSend: () => void }) {
  const [text, setText] = useState("");
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await sendOverseer(roomId, t);
    afterSend();
  };
  return (
    <div className="cmdbar">
      <textarea
        className="field"
        rows={1}
        placeholder={paused ? "Room is paused. Message agents as the overseer…" : "Message the room as the overseer…"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button className="btn primary" onClick={send}>
        Send
      </button>
    </div>
  );
}

function BranchPanel({ roomId, afterAction }: { roomId: string; afterAction: () => void }) {
  const [branches, setBranches] = useState<AgentBranch[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = (all = showAll) => {
    listBranches(roomId, all).then(setBranches).catch(() => null);
  };

  useEffect(() => { load(); }, [roomId, showAll]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>, branchId: string) => {
    setBusy(branchId);
    try { await fn(); load(); afterAction(); } finally { setBusy(null); }
  };

  const readyBranches = branches.filter((b) => b.status === "ready");
  const trackingBranches = branches.filter((b) => b.status === "tracking");

  return (
    <div className="branch-panel">
      {!branches.length && (
        <p className="empty">
          No agent changes tracked yet. Changes appear here when an agent claims files in a git repo and releases them.
        </p>
      )}

      {trackingBranches.length > 0 && (
        <div className="branch-group">
          <div className="branch-group-label">In progress</div>
          {trackingBranches.map((b) => (
            <div className="branch-card tracking" key={b.id}>
              <div className="branch-agent">{b.participantName}</div>
              <div className="branch-paths">{b.paths.slice(0, 3).join(", ")}{b.paths.length > 3 ? ` +${b.paths.length - 3}` : ""}</div>
              <span className="branch-status">tracking…</span>
            </div>
          ))}
        </div>
      )}

      {readyBranches.length > 0 && (
        <div className="branch-group">
          <div className="branch-group-label">Ready to review</div>
          {readyBranches.map((b) => (
            <div className="branch-card ready" key={b.id}>
              <div className="branch-head">
                <span className="branch-agent">{b.participantName}</span>
                <span className="branch-paths">{b.paths.length} path{b.paths.length !== 1 ? "s" : ""}</span>
              </div>
              {b.diff ? (
                <button
                  className="diff-toggle"
                  onClick={() => setExpanded(expanded === b.id ? null : b.id)}
                >
                  {expanded === b.id ? "▲ hide diff" : "▼ view diff"}
                </button>
              ) : (
                <p className="empty" style={{ fontSize: ".72rem", margin: "4px 0" }}>No changes detected.</p>
              )}
              {expanded === b.id && b.diff && (
                <pre className="diff-view">{b.diff}</pre>
              )}
              <div className="branch-acts">
                <button
                  className="btn sm danger"
                  disabled={busy === b.id}
                  onClick={() => act(() => discardBranch(roomId, b.id), b.id)}
                >
                  Discard
                </button>
                <button
                  className="btn sm primary"
                  disabled={busy === b.id}
                  onClick={() => act(() => mergeBranch(roomId, b.id), b.id)}
                >
                  {busy === b.id ? "…" : "Merge to git"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button className="btn sm" onClick={() => load()}>Refresh</button>
        <button className="btn sm" onClick={() => { setShowAll((a) => !a); }}>
          {showAll ? "Hide history" : "Show history"}
        </button>
      </div>
    </div>
  );
}

function ApprovalDock({ roomId, approval, afterDecide }: { roomId: string; approval: Approval; afterDecide: () => void }) {
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState("");

  const decide = async (decision: "approved" | "rejected" | "edited", note?: string) => {
    await decideApproval(roomId, approval.id, decision, note);
    setEditing(false);
    setInstruction("");
    afterDecide();
  };

  return (
    <div className="dock" role="alertdialog" aria-label="Approval required">
      <div className="label">Approval needed</div>
      <p className="what">
        <span className="who">{approval.requestedByName}</span> wants to{" "}
        <strong>{approval.action}</strong>: {richText(approval.details)}
      </p>
      {editing ? (
        <div className="acts">
          <input
            className="field"
            autoFocus
            placeholder="Do this instead…"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && instruction.trim() && decide("edited", instruction.trim())}
          />
          <button className="btn primary" onClick={() => instruction.trim() && decide("edited", instruction.trim())}>
            Send
          </button>
          <button className="btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="acts">
          <button className="btn danger" onClick={() => decide("rejected")}>
            Deny
          </button>
          <button className="btn" onClick={() => setEditing(true)}>
            Edit & redirect
          </button>
          <button className="btn primary" onClick={() => decide("approved")} style={{ marginLeft: "auto" }}>
            Approve
          </button>
        </div>
      )}
    </div>
  );
}
