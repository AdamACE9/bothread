import { useEffect, useState } from "react";
import type { AgentBranch, AuditEvent, DiffHunkView, HandoffView, Lease, LockView, NoteKind, RoomNote, RoomTask, TaskStatus } from "@bothread/shared";
import { applyHunks, createTask, discardBranch, getAudit, mergeBranch, recordNote, resolveNote, updateTask } from "../api";
import { relTime, untilTime } from "../hooks";
import { Icon } from "../icons";
import { useToast } from "../toast";
import { Avatar, Empty, fmtTime } from "../ui";

/* ------------------------------- Claims -------------------------------- */

export function ClaimsPanel({
  locks,
  leases,
  handoffs,
  brandByName,
  now,
}: {
  locks: LockView[];
  leases: Lease[];
  handoffs: HandoffView[];
  brandByName: Map<string, string | undefined>;
  now: number;
}) {
  const byHolder = new Map<string, LockView[]>();
  for (const l of locks) byHolder.set(l.heldByName, [...(byHolder.get(l.heldByName) ?? []), l]);
  const leaseFor = (l: LockView) => leases.find((x) => x.pathPattern === l.path && x.participantId === l.heldBy);

  return (
    <div className="panel-body">
      {handoffs.length > 0 && (
        <section className="block">
          <h3>Waiting on each other</h3>
          {handoffs.map((h) => (
            <div className="handoff" key={h.id}>
              <div className="handoff-flow">
                <span className="who">{h.requestedBy}</span>
                <Icon name="arrowDown" size={12} style={{ transform: "rotate(-90deg)" }} />
                <span className="who dim">{h.heldBy}</span>
              </div>
              <code>{h.path}</code>
              {h.message && <p className="handoff-msg">"{h.message}"</p>}
            </div>
          ))}
        </section>
      )}
      {locks.length === 0 ? (
        <Empty icon={<Icon name="lock" size={22} />} title="No files claimed">
          Agents claim files before they edit them. Two agents can never hold the same file exclusively.
        </Empty>
      ) : (
        [...byHolder.entries()].map(([holder, ls]) => (
          <section className="block" key={holder}>
            <h3 className="holder-head">
              <Avatar name={holder} brand={brandByName.get(holder)} size={20} />
              {holder}
              <span className="count">{ls.length}</span>
            </h3>
            {ls.map((l) => {
              const idleMs = now - l.heldByLastSeen;
              const stale = !l.heldByListening && idleMs > 120_000;
              const lease = leaseFor(l);
              return (
                <div className={`claim${stale ? " stale" : ""}`} key={`${l.path}:${l.heldBy}`}>
                  <div className="claim-path">
                    <code>{l.path}</code>
                    <span className={`kind ${l.exclusive ? "ex" : "sh"}`}>{l.exclusive ? "exclusive" : "shared"}</span>
                  </div>
                  {lease?.reason && <p className="claim-reason">{lease.reason}</p>}
                  <div className="claim-meta">
                    {l.heldByListening ? (
                      <span className="fresh">Holder listening</span>
                    ) : stale ? (
                      <span className="warn">
                        <Icon name="alert" size={11} /> Holder quiet {Math.round(idleMs / 60000)}m, may be stale
                      </span>
                    ) : (
                      <span>Holder seen {relTime(l.heldByLastSeen, now)}</span>
                    )}
                    <span className="spacer" />
                    <span title={new Date(l.expiresAt).toLocaleString()}>{untilTime(l.expiresAt, now)}</span>
                  </div>
                </div>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}

/* -------------------------------- Tasks -------------------------------- */

const TASK_GROUPS: { status: TaskStatus; label: string }[] = [
  { status: "in_progress", label: "In progress" },
  { status: "open", label: "Up for grabs" },
  { status: "done", label: "Done" },
  { status: "cancelled", label: "Cancelled" },
];

export function TasksPanel({ roomId, tasks, afterAction }: { roomId: string; tasks: RoomTask[]; afterAction: () => void }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
      afterAction();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const add = () => {
    const t = title.trim();
    if (!t) return;
    run("new", async () => {
      await createTask(roomId, t, note.trim() || undefined, false);
      setTitle("");
      setNote("");
      setAdding(false);
    });
  };

  const done = tasks.filter((t) => t.status === "done").length;
  const live = tasks.filter((t) => t.status !== "cancelled").length;

  return (
    <div className="panel-body">
      {live > 0 && (
        <div className="progress" title={`${done} of ${live} done`}>
          <div className="progress-bar">
            <span style={{ width: `${(done / live) * 100}%` }} />
          </div>
          <span>
            {done}/{live} done
          </span>
        </div>
      )}
      {adding ? (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input className="field sm" autoFocus placeholder="What needs doing?" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          <input className="field sm" placeholder="Detail for the agent (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          <div className="row">
            <button type="button" className="btn sm ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="btn sm primary" disabled={busy === "new" || !title.trim()}>
              Add task
            </button>
          </div>
        </form>
      ) : (
        <button className="add-row" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> Add a task for the agents
        </button>
      )}

      {tasks.length === 0 ? (
        <Empty icon={<Icon name="tasks" size={22} />} title="No tasks yet">
          Add one here, or agents will create them with create_task as they split up the work.
        </Empty>
      ) : (
        TASK_GROUPS.filter((g) => showClosed || g.status === "in_progress" || g.status === "open").map((g) => {
          const list = tasks.filter((t) => t.status === g.status);
          if (!list.length) return null;
          return (
            <section className="block" key={g.status}>
              <h3>
                {g.label} <span className="count">{list.length}</span>
              </h3>
              {list.map((t) => (
                <div className={`task ${t.status}`} key={t.id}>
                  <button
                    className={`task-check${t.status === "done" ? " on" : ""}`}
                    aria-label={t.status === "done" ? "Reopen task" : "Mark done"}
                    disabled={busy === t.id || t.status === "cancelled"}
                    onClick={() => run(t.id, () => updateTask(roomId, t.id, { status: t.status === "done" ? "open" : "done" }))}
                  >
                    {t.status === "done" && <Icon name="check" size={12} />}
                  </button>
                  <div className="task-main">
                    <div className="task-title">{t.title}</div>
                    {t.note && <div className="task-note">{t.note}</div>}
                    <div className="task-meta">
                      {t.ownerName ? <span className="owner">{t.ownerName}</span> : <span className="dim">Unassigned</span>}
                      <span className="dim">{relTime(t.updatedAt)}</span>
                      {t.status !== "done" && t.status !== "cancelled" && (
                        <button className="linkish danger" disabled={busy === t.id} onClick={() => run(t.id, () => updateTask(roomId, t.id, { status: "cancelled" }))}>
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          );
        })
      )}
      {tasks.some((t) => t.status === "done" || t.status === "cancelled") && (
        <button className="linkish" onClick={() => setShowClosed((s) => !s)}>
          {showClosed ? "Hide finished tasks" : `Show finished tasks (${tasks.filter((t) => t.status === "done" || t.status === "cancelled").length})`}
        </button>
      )}
    </div>
  );
}

/* ------------------------------- Changes ------------------------------- */

export function ChangesPanel({
  roomId,
  branches,
  hasProject,
  showAll,
  onToggleAll,
  afterAction,
}: {
  roomId: string;
  branches: AgentBranch[];
  hasProject: boolean;
  showAll: boolean;
  onToggleAll: () => void;
  afterAction: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, branchId: string, done: string) => {
    setBusy(branchId);
    try {
      await fn();
      toast.show({ tone: "success", title: done });
      afterAction();
    } catch (err) {
      toast.error(err, "That didn't apply");
    } finally {
      setBusy(null);
    }
  };

  const ready = branches.filter((b) => b.status === "ready");
  const tracking = branches.filter((b) => b.status === "tracking");
  const history = branches.filter((b) => b.status === "merged" || b.status === "discarded");

  if (!hasProject) {
    return (
      <div className="panel-body">
        <Empty icon={<Icon name="diff" size={22} />} title="Diff review is off for this room">
          Create a room with a project folder that's a git repo and each agent's edits land here as a diff you can merge,
          trim hunk by hunk, or discard. Your own uncommitted work is never touched.
        </Empty>
      </div>
    );
  }

  return (
    <div className="panel-body">
      {!branches.length && (
        <Empty icon={<Icon name="diff" size={22} />} title="No changes to review yet">
          When an agent releases the files it claimed, its edits show up here.
        </Empty>
      )}
      {ready.length > 0 && (
        <section className="block">
          <h3>
            Ready for review <span className="count hot">{ready.length}</span>
          </h3>
          {ready.map((b) => (
            <ReadyBranch key={b.id} branch={b} busy={busy === b.id} roomId={roomId} act={act} />
          ))}
        </section>
      )}
      {tracking.length > 0 && (
        <section className="block">
          <h3>Being edited</h3>
          {tracking.map((b) => (
            <div className="branch tracking" key={b.id}>
              <div className="branch-head">
                <span className="agent">{b.participantName}</span>
                <span className="pulse" aria-hidden="true" />
              </div>
              <div className="branch-files">{b.paths.slice(0, 4).map((p) => <code key={p}>{p}</code>)}</div>
            </div>
          ))}
        </section>
      )}
      {showAll && history.length > 0 && (
        <section className="block">
          <h3>History</h3>
          {history.map((b) => (
            <div className="branch done" key={b.id}>
              <div className="branch-head">
                <span className="agent">{b.participantName}</span>
                <span className={`pill ${b.status}`}>{b.status}</span>
                <span className="dim">{b.finalizedAt ? relTime(b.finalizedAt) : ""}</span>
              </div>
            </div>
          ))}
        </section>
      )}
      <button className="linkish" onClick={onToggleAll}>
        {showAll ? "Hide history" : "Show merged and discarded"}
      </button>
    </div>
  );
}

function ReadyBranch({
  branch: b,
  busy,
  roomId,
  act,
}: {
  branch: AgentBranch;
  busy: boolean;
  roomId: string;
  act: (fn: () => Promise<unknown>, id: string, done: string) => Promise<void>;
}) {
  const hunks = b.hunks ?? [];
  const [open, setOpen] = useState(hunks.length <= 3);
  const [kept, setKept] = useState<Record<string, boolean>>(() => Object.fromEntries(hunks.map((h) => [h.id, true])));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const keptIds = hunks.filter((h) => kept[h.id]).map((h) => h.id);
  const allKept = keptIds.length === hunks.length;
  const adds = hunks.reduce((n, h) => n + h.additions, 0);
  const dels = hunks.reduce((n, h) => n + h.deletions, 0);
  const files = Array.from(new Set(hunks.map((h) => h.file)));

  return (
    <div className="branch ready">
      <div className="branch-head">
        <span className="agent">{b.participantName}</span>
        <span className="diffstat">
          <span className="add">+{adds}</span>
          <span className="del">−{dels}</span>
        </span>
        <span className="dim">
          {files.length || b.paths.length} file{(files.length || b.paths.length) === 1 ? "" : "s"}
        </span>
      </div>
      {hunks.length > 0 ? (
        <>
          <button className="linkish" onClick={() => setOpen((o) => !o)}>
            <Icon name="chevron" size={13} style={{ transform: open ? "none" : "rotate(-90deg)" }} />
            {open ? "Hide the diff" : `Review ${hunks.length} change${hunks.length === 1 ? "" : "s"}`}
          </button>
          {open && (
            <div className="hunks">
              {hunks.map((h) => (
                <Hunk key={h.id} hunk={h} kept={!!kept[h.id]} onToggle={() => setKept((k) => ({ ...k, [h.id]: !k[h.id] }))} />
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="dim small">No text changes detected.</p>
      )}
      <div className="branch-acts">
        {confirmDiscard ? (
          <>
            <button className="btn sm danger solid" disabled={busy} onClick={() => act(() => discardBranch(roomId, b.id), b.id, `Discarded ${b.participantName}'s changes`)}>
              Discard for good
            </button>
            <button className="btn sm ghost" onClick={() => setConfirmDiscard(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="btn sm danger" disabled={busy} onClick={() => setConfirmDiscard(true)}>
            Discard
          </button>
        )}
        <span className="spacer" />
        {allKept || hunks.length === 0 ? (
          <button className="btn sm primary" disabled={busy} onClick={() => act(() => mergeBranch(roomId, b.id), b.id, `Merged ${b.participantName}'s changes`)}>
            <Icon name="check" size={13} /> {busy ? "Merging" : "Merge all"}
          </button>
        ) : (
          <button
            className="btn sm primary"
            disabled={busy || keptIds.length === 0}
            onClick={() => act(() => applyHunks(roomId, b.id, keptIds), b.id, `Kept ${keptIds.length} of ${hunks.length} changes`)}
          >
            <Icon name="check" size={13} /> Keep {keptIds.length} of {hunks.length}
          </button>
        )}
      </div>
    </div>
  );
}

function Hunk({ hunk, kept, onToggle }: { hunk: DiffHunkView; kept: boolean; onToggle: () => void }) {
  return (
    <div className={`hunk${kept ? "" : " dropped"}`}>
      <label className="hunk-head">
        <input type="checkbox" checked={kept} onChange={onToggle} />
        <span className="hunk-file">{hunk.file}</span>
        <span className="diffstat">
          <span className="add">+{hunk.additions}</span>
          <span className="del">−{hunk.deletions}</span>
        </span>
      </label>
      <pre className="diff">
        {hunk.lines.map((ln, i) => {
          const cls = ln.startsWith("+") ? "a" : ln.startsWith("-") ? "d" : ln.startsWith("@@") ? "h" : "";
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

/* -------------------------------- Notes -------------------------------- */

const NOTE_LABEL: Record<NoteKind, string> = { decision: "Decision", issue: "Issue", verification: "Verified" };

export function NotesPanel({ roomId, notes, afterAction }: { roomId: string; notes: RoomNote[]; afterAction: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<NoteKind>("decision");
  const [filter, setFilter] = useState<NoteKind | "all">("all");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const submit = async () => {
    const t = title.trim();
    if (!t) return;
    setBusy("new");
    try {
      await recordNote(roomId, kind, t, detail.trim() || undefined);
      setTitle("");
      setDetail("");
      setAdding(false);
      afterAction();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (n: RoomNote) => {
    setBusy(n.id);
    try {
      await resolveNote(roomId, n.id);
      afterAction();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const resolved = notes.filter((n) => n.status === "resolved");
  const visible = notes
    .filter((n) => (showResolved ? true : n.status === "open"))
    .filter((n) => filter === "all" || n.kind === filter)
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="panel-body">
      {adding ? (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="seg">
            {(["decision", "issue", "verification"] as NoteKind[]).map((k) => (
              <button type="button" key={k} className={`seg-btn ${k}${kind === k ? " on" : ""}`} onClick={() => setKind(k)}>
                {NOTE_LABEL[k]}
              </button>
            ))}
          </div>
          <input className="field sm" autoFocus placeholder="Short title, e.g. physics.ts owns collision" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          <textarea
            className="field sm"
            rows={3}
            placeholder={kind === "verification" ? "Tested / expected / actual" : "Context (optional)"}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
          <div className="row">
            <button type="button" className="btn sm ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="btn sm primary" disabled={busy === "new" || !title.trim()}>
              Record
            </button>
          </div>
        </form>
      ) : (
        <button className="add-row" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> Record a decision, issue or check
        </button>
      )}

      {notes.length > 0 && (
        <div className="chips">
          {(["all", "decision", "issue", "verification"] as const).map((k) => {
            const n = k === "all" ? notes.filter((x) => x.status === "open").length : notes.filter((x) => x.kind === k && x.status === "open").length;
            return (
              <button key={k} className={`chip${filter === k ? " on" : ""}`} onClick={() => setFilter(k)}>
                {k === "all" ? "All" : NOTE_LABEL[k]} <span className="n">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {notes.length === 0 ? (
        <Empty icon={<Icon name="note" size={22} />} title="Nothing on record">
          Decisions, flagged issues and test reports live here so nobody has to dig them out of the chat.
        </Empty>
      ) : (
        visible.map((n) => (
          <div className={`note ${n.kind}${n.status === "resolved" ? " resolved" : ""}`} key={n.id}>
            <div className="note-head">
              <span className={`note-kind ${n.kind}`}>{NOTE_LABEL[n.kind]}</span>
              <span className="note-title">{n.title}</span>
            </div>
            {n.detail && <pre className="note-detail">{n.detail}</pre>}
            <div className="note-meta">
              <span>{n.authorName}</span>
              <span className="dim">{relTime(n.createdAt)}</span>
              <span className="spacer" />
              {n.status === "open" ? (
                <button className="linkish" disabled={busy === n.id} onClick={() => resolve(n)}>
                  Mark resolved
                </button>
              ) : (
                <span className="dim">Resolved</span>
              )}
            </div>
          </div>
        ))
      )}
      {resolved.length > 0 && (
        <button className="linkish" onClick={() => setShowResolved((s) => !s)}>
          {showResolved ? "Hide resolved" : `Show resolved (${resolved.length})`}
        </button>
      )}
    </div>
  );
}

/* ------------------------------- Activity ------------------------------ */

export const AUDIT_LABELS: Record<string, string> = {
  "room.create": "Room created",
  "room.active": "Room resumed",
  "room.paused": "Room paused",
  "room.closed": "Room closed",
  "room.rename": "Room renamed",
  "room.settings": "Settings changed",
  "participant.join": "Joined",
  "participant.leave": "Left",
  "participant.muted": "Muted",
  "participant.active": "Unmuted",
  "participant.revoked": "Revoked",
  "participant.nudge": "Nudged",
  "message.send": "Message",
  "message.edit": "Edited a message",
  "message.retract": "Retracted a message",
  "message.overseer": "You wrote",
  "lease.claim": "Claimed files",
  "lease.release": "Released files",
  "lease.renew": "Renewed a claim",
  "lease.collision": "Collision prevented",
  "approval.request": "Asked for approval",
  "approval.approved": "Approved",
  "approval.rejected": "Denied",
  "approval.edited": "Redirected",
  "branch.merge": "Changes merged",
  "branch.discard": "Changes discarded",
  "branch.apply": "Changes partly kept",
  "handoff.request": "Asked for a hand-off",
  "handoff.cancel": "Withdrew a hand-off",
  "task.create": "Added a task",
  "task.update": "Updated a task",
  "note.record": "Recorded a note",
  "note.resolve": "Resolved a note",
};

export function auditDetail(e: AuditEvent): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  if (Array.isArray(p.paths)) return (p.paths as string[]).join(", ");
  if (typeof p.path === "string") return p.path;
  if (Array.isArray(p.conflicts) && p.conflicts.length) return (p.conflicts[0] as { path?: string })?.path ?? "";
  if (typeof p.participant === "string") return p.participant;
  if (typeof p.title === "string") return p.title;
  if (typeof p.holder === "string") return `from ${p.holder}`;
  if (typeof p.action === "string") return p.action;
  if (p.settings && typeof p.settings === "object") {
    const s = p.settings as { requireApprovalFor?: string[] };
    return s.requireApprovalFor?.length ? `approval needed for ${s.requireApprovalFor.join(", ")}` : "no approval gates";
  }
  return "";
}

export function ActivityPanel({ roomId, tick }: { roomId: string; tick: number }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [hideChat, setHideChat] = useState(true);
  useEffect(() => {
    getAudit(roomId, 250).then(setEvents).catch(() => null);
  }, [roomId, tick]);

  if (!events) return <div className="panel-body" />;
  const list = hideChat ? events.filter((e) => e.type !== "message.send" && e.type !== "message.overseer") : events;

  return (
    <div className="panel-body">
      <label className="toggle-row">
        <input type="checkbox" checked={hideChat} onChange={(e) => setHideChat(e.target.checked)} />
        Hide chat messages
      </label>
      {list.length === 0 ? (
        <Empty icon={<Icon name="activity" size={22} />} title="Nothing recorded yet" />
      ) : (
        <ol className="audit">
          {list.map((e) => {
            const detail = auditDetail(e);
            const tone = e.type === "lease.collision" ? "alert" : e.type.startsWith("approval") || e.type.startsWith("room.") || e.type === "participant.revoked" ? "steer" : "";
            return (
              <li className={`audit-row ${tone}`} key={e.id}>
                <span className="audit-dot" />
                <div className="audit-body">
                  <div className="audit-line">
                    <span className="audit-type">{AUDIT_LABELS[e.type] ?? e.type}</span>
                    {e.actorName && <span className="audit-actor">{e.actorName}</span>}
                    <time>{fmtTime(e.ts)}</time>
                  </div>
                  {detail && <div className="audit-detail">{detail}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
