import { useEffect, useRef, useState } from "react";
import type { AgentBranch, Approval, AuditEvent, DiffHunkView, RiskAction, ThreadEntry } from "@bothread/shared";
import { applyHunks, decideApproval, discardBranch, getAudit, listBranches, mergeBranch, nudgeParticipant, sendOverseer, setParticipantStatus, setRoomStatus, updateRoomSettings } from "./api";
import ConnectPanel from "./ConnectPanel";
import { useRoom } from "./useRoom";
import { Avatar, brandClass, fmtTime, richText } from "./ui";

export default function RoomView({ roomId, onBack }: { roomId: string; onBack: () => void }) {
  const { detail, connected, refresh } = useRoom(roomId);
  const [showConnect, setShowConnect] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [rightTab, setRightTab] = useState<"locks" | "changes" | "activity">("locks");

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
        onSettings={() => setShowSettings(true)}
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
                  {p.kind === "agent" && p.listening && (
                    <span className="listening" title="Actively listening (parked in wait_for_update)">
                      <span className="pulse" /> listening
                    </span>
                  )}
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
                    <button
                      className="btn sm"
                      title={p.listening ? "Agent is listening — it'll see this at once" : "Agent isn't listening; this lands for when its app next runs it"}
                      onClick={() => nudgeParticipant(roomId, p.id).then(refresh)}
                    >
                      Nudge
                    </button>
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
            <button
              className={`rail-tab${rightTab === "activity" ? " active" : ""}`}
              onClick={() => setRightTab("activity")}
            >
              Activity
            </button>
          </div>

          {rightTab === "locks" ? (
            <>
              {snapshot.handoffs.length > 0 && (
                <div className="handoffs">
                  <div className="branch-group-label">Waiting on each other</div>
                  {snapshot.handoffs.map((h) => (
                    <div className="handoff" key={h.id}>
                      <span className="who">{h.requestedBy}</span> wants <code>{h.path}</code>
                      <div className="held">held by {h.heldBy}</div>
                    </div>
                  ))}
                </div>
              )}
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
          ) : rightTab === "changes" ? (
            <BranchPanel roomId={roomId} afterAction={refresh} />
          ) : (
            <AuditPanel roomId={roomId} connected={connected} />
          )}
        </aside>
      </div>

      <CommandBar roomId={roomId} paused={snapshot.room.status === "paused"} afterSend={refresh} />

      {pending && <ApprovalDock roomId={roomId} approval={pending} afterDecide={refresh} />}

      {showConnect && <ConnectPanel sessionId={sessionId} onClose={() => setShowConnect(false)} />}

      {showSettings && (
        <SettingsModal
          roomId={roomId}
          requireApprovalFor={snapshot.room.requireApprovalFor}
          onClose={() => setShowSettings(false)}
          afterSave={refresh}
        />
      )}
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
  onSettings: () => void;
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
      <button className="btn icon" title="Room settings" aria-label="Room settings" onClick={props.onSettings}>
        ⚙
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
            <ReadyBranchCard key={b.id} branch={b} busy={busy === b.id} act={act} roomId={roomId} />
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

function ReadyBranchCard({
  branch: b,
  busy,
  act,
  roomId,
}: {
  branch: AgentBranch;
  busy: boolean;
  act: (fn: () => Promise<unknown>, branchId: string) => Promise<void>;
  roomId: string;
}) {
  const [open, setOpen] = useState(false);
  const hunks = b.hunks ?? [];
  // Selection: hunk id -> kept. Default: keep all.
  const [kept, setKept] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(hunks.map((h) => [h.id, true]))
  );
  const keptIds = hunks.filter((h) => kept[h.id]).map((h) => h.id);
  const allKept = keptIds.length === hunks.length;
  const noneKept = keptIds.length === 0;

  const toggle = (id: string) => setKept((k) => ({ ...k, [id]: !k[id] }));

  return (
    <div className="branch-card ready">
      <div className="branch-head">
        <span className="branch-agent">{b.participantName}</span>
        <span className="branch-paths">
          {hunks.length > 0
            ? `${hunks.length} change${hunks.length !== 1 ? "s" : ""}`
            : `${b.paths.length} path${b.paths.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {hunks.length > 0 ? (
        <>
          <button className="diff-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? "▲ hide changes" : `▼ review ${hunks.length} change${hunks.length !== 1 ? "s" : ""}`}
          </button>
          {open && (
            <div className="hunks">
              {hunks.map((h) => (
                <HunkBlock key={h.id} hunk={h} kept={!!kept[h.id]} onToggle={() => toggle(h.id)} />
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="empty" style={{ fontSize: ".72rem", margin: "4px 0" }}>No textual changes detected.</p>
      )}

      <div className="branch-acts">
        <button className="btn sm danger" disabled={busy} onClick={() => act(() => discardBranch(roomId, b.id), b.id)}>
          Discard all
        </button>
        {allKept || hunks.length === 0 ? (
          <button className="btn sm primary" disabled={busy} onClick={() => act(() => mergeBranch(roomId, b.id), b.id)}>
            {busy ? "…" : "Merge all"}
          </button>
        ) : (
          <button
            className="btn sm primary"
            disabled={busy || noneKept}
            onClick={() => act(() => applyHunks(roomId, b.id, keptIds), b.id)}
            title={noneKept ? "Select at least one change, or use Discard all" : ""}
          >
            {busy ? "…" : `Apply ${keptIds.length} selected`}
          </button>
        )}
      </div>
    </div>
  );
}

function HunkBlock({ hunk, kept, onToggle }: { hunk: DiffHunkView; kept: boolean; onToggle: () => void }) {
  return (
    <div className={`hunk${kept ? "" : " dropped"}`}>
      <label className="hunk-head">
        <input type="checkbox" checked={kept} onChange={onToggle} />
        <span className="hunk-file">{hunk.file}</span>
        <span className="hunk-stat">
          <span className="add">+{hunk.additions}</span> <span className="del">−{hunk.deletions}</span>
        </span>
      </label>
      <pre className="diff-view">
        {hunk.lines.map((ln, i) => {
          const cls = ln.startsWith("+") ? "line-add" : ln.startsWith("-") ? "line-del" : ln.startsWith("@@") ? "line-hdr" : "";
          return (
            <div key={i} className={cls}>
              {ln || " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

const AUDIT_LABELS: Record<string, string> = {
  "room.create": "Room created",
  "room.active": "Room resumed",
  "room.paused": "Room paused",
  "room.closed": "Room closed",
  "room.settings": "Settings changed",
  "participant.join": "Joined",
  "participant.leave": "Left",
  "participant.muted": "Muted",
  "participant.active": "Un-muted",
  "participant.revoked": "Revoked",
  "participant.nudge": "Nudged",
  "message.send": "Message",
  "message.overseer": "Overseer message",
  "lease.claim": "Claimed files",
  "lease.release": "Released files",
  "lease.renew": "Renewed claim",
  "lease.collision": "Collision prevented",
  "approval.request": "Approval requested",
  "approval.approved": "Approved",
  "approval.rejected": "Rejected",
  "approval.edited": "Edited & redirected",
  "branch.merge": "Changes merged",
  "branch.discard": "Changes discarded",
  "branch.apply": "Changes partly applied",
  "handoff.request": "Hand-off requested",
};

function auditDetail(e: AuditEvent): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  if (Array.isArray(p.paths)) return (p.paths as string[]).join(", ");
  if (typeof p.path === "string") return p.path;
  if (Array.isArray(p.conflicts) && p.conflicts.length) {
    const c = p.conflicts[0] as { path?: string };
    return c?.path ?? "";
  }
  if (typeof p.participant === "string") return p.participant;
  if (typeof p.holder === "string") return `→ ${p.holder}`;
  if (typeof p.action === "string") return p.action;
  if (p.settings && typeof p.settings === "object") {
    const s = p.settings as { requireApprovalFor?: string[] };
    return s.requireApprovalFor?.length ? `approve: ${s.requireApprovalFor.join(", ")}` : "no approval gates";
  }
  return "";
}

function AuditPanel({ roomId, connected }: { roomId: string; connected: boolean }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const load = () => getAudit(roomId, 200).then(setEvents).catch(() => null);
  useEffect(() => {
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [roomId, connected]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!events.length) return <p className="empty">No activity recorded yet.</p>;

  return (
    <div className="audit">
      {events.map((e) => {
        const detail = auditDetail(e);
        const tone = e.type.startsWith("lease.collision")
          ? "alert"
          : e.type.startsWith("approval") || e.type.startsWith("room.") || e.type === "participant.revoked"
            ? "steer"
            : "";
        return (
          <div className={`audit-row ${tone}`} key={e.id}>
            <span className="audit-dot" />
            <div className="audit-body">
              <div className="audit-line">
                <span className="audit-type">{AUDIT_LABELS[e.type] ?? e.type}</span>
                {e.actorName && <span className="audit-actor">{e.actorName}</span>}
                <span className="audit-time">{fmtTime(e.ts)}</span>
              </div>
              {detail && <div className="audit-detail">{detail}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const RISK_ACTIONS: RiskAction[] = ["delete", "deploy", "shell", "git_push", "install", "migration", "network", "other"];
const RISK_LABELS: Record<RiskAction, string> = {
  delete: "Delete files/folders",
  deploy: "Deploy",
  shell: "Run shell commands",
  git_push: "git push",
  install: "Install packages",
  migration: "Run DB migrations",
  network: "Network calls",
  other: "Other risky actions",
};

function SettingsModal({
  roomId,
  requireApprovalFor,
  onClose,
  afterSave,
}: {
  roomId: string;
  requireApprovalFor: RiskAction[];
  onClose: () => void;
  afterSave: () => void;
}) {
  const [sel, setSel] = useState<Set<RiskAction>>(new Set(requireApprovalFor));
  const [busy, setBusy] = useState(false);
  const toggle = (a: RiskAction) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(a) ? n.delete(a) : n.add(a);
      return n;
    });
  const save = async () => {
    setBusy(true);
    try {
      await updateRoomSettings(roomId, { requireApprovalFor: [...sel] });
      afterSave();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" role="dialog" aria-label="Room settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Room settings</h2>
          <button className="btn sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="settings-intro">
          Choose which risky actions an agent must get your <strong>approval</strong> for before doing.
          Agents see this the moment it changes and will call <code>request_approval</code> first. Off by
          default — each agent's own app already gates risky actions.
        </p>
        <div className="risk-grid">
          {RISK_ACTIONS.map((a) => (
            <label key={a} className={`risk${sel.has(a) ? " on" : ""}`}>
              <input type="checkbox" checked={sel.has(a)} onChange={() => toggle(a)} />
              <span>{RISK_LABELS[a]}</span>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => setSel(new Set())} disabled={busy}>Clear all</button>
          <button className="btn primary" onClick={save} disabled={busy} style={{ marginLeft: "auto" }}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
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
