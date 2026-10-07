import { useEffect, useState } from "react";
import type { AgentBranch, AuditEvent, DiffHunkView, HandoffView, Lease, LockView, NoteKind, RoomNote, RoomTask, TaskStatus } from "@bothread/shared";
import { applyHunks, createTask, discardBranch, getAudit, mergeBranch, recordNote, resolveNote, updateTask } from "../api";
import { relTime, untilTime } from "../hooks";
import { Icon, type IconName } from "../icons";
import { useToast } from "../toast";
import { DiffBar, Ring, SegBar, brandColor } from "../charts";
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
                <Avatar name={h.heldBy} brand={brandByName.get(h.heldBy)} size={20} />
                <span className="who">{h.heldBy}</span>
                <span className="handoff-wire" aria-label="should hand off to">
                  <Icon name="arrowRight" size={12} />
                </span>
                <Avatar name={h.requestedBy} brand={brandByName.get(h.requestedBy)} size={20} />
                <span className="who">{h.requestedBy}</span>
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
        <>
          <div className="claims-sum">
            <SegBar
              height={10}
              segments={[...byHolder.entries()].map(([h, ls]) => ({ key: h, value: ls.length, color: brandColor(brandByName.get(h)), label: h }))}
            />
            <span className="claims-sum-n">
              {locks.length} file{locks.length === 1 ? "" : "s"} held by {byHolder.size} agent{byHolder.size === 1 ? "" : "s"}
            </span>
          </div>
          {[...byHolder.entries()].map(([holder, ls]) => (
            <section className="block claim-group" key={holder} style={{ ["--accent" as string]: brandColor(brandByName.get(holder)) }}>
              <h3 className="holder-head">
                <span className="holder-av">
                  <Avatar name={holder} brand={brandByName.get(holder)} size={24} ring={ls[0]?.heldByListening ? "live" : undefined} />
                </span>
                {holder}
                <span className="count">{ls.length}</span>
              </h3>
              {ls.map((l) => {
                const idleMs = now - l.heldByLastSeen;
                const stale = !l.heldByListening && idleMs > 120_000;
                const lease = leaseFor(l);
                const span = lease ? lease.expiresAt - lease.createdAt : 0;
                const left = Math.max(0, l.expiresAt - now);
                const frac = span > 0 ? Math.min(1, left / span) : 1;
                return (
                  <div className={`claim${stale ? " stale" : ""}${frac < 0.2 ? " low" : ""}`} key={`${l.path}:${l.heldBy}`}>
                    <div className="claim-path">
                      <Icon name="lock" size={12} />
                      <code title={l.path}>{l.path}</code>
                      <span className={`kind ${l.exclusive ? "ex" : "sh"}`}>{l.exclusive ? "exclusive" : "shared"}</span>
                    </div>
                    {lease?.reason && <p className="claim-reason">{lease.reason}</p>}
                    <div className="ttl" role="img" aria-label={`Claim time left: ${untilTime(l.expiresAt, now)}`}>
                      <span className="ttl-fill" style={{ width: `${frac * 100}%` }} />
                    </div>
                    <div className="claim-meta">
                      {l.heldByListening ? (
                        <span className="fresh">
                          <span className="pulse" aria-hidden="true" /> Holder listening
                        </span>
                      ) : stale ? (
                        <span className="warn">
                          <Icon name="alert" size={11} /> Holder quiet {Math.round(idleMs / 60000)}m, may be stale
                        </span>
                      ) : (
                        <span>Holder seen {relTime(l.heldByLastSeen, now)}</span>
                      )}
                      <span className="spacer" />
                      <span className="ttl-left" title={new Date(l.expiresAt).toLocaleString()}>
                        {untilTime(l.expiresAt, now)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

/* -------------------------------- Tasks -------------------------------- */

type Lane = "doing" | "next" | "blocked" | "done";
const LANES: { id: Lane; label: string; color: string; empty: string }[] = [
  { id: "doing", label: "In progress", color: "var(--saffron)", empty: "Nobody is on a task" },
  { id: "next", label: "Up next", color: "var(--sky)", empty: "Nothing ready to grab" },
  { id: "blocked", label: "Blocked", color: "var(--clay)", empty: "Nothing waiting" },
  { id: "done", label: "Done", color: "var(--teal)", empty: "Nothing finished yet" },
];
function laneOf(t: RoomTask): Lane | null {
  if (t.status === "in_progress") return "doing";
  if (t.status === "open") return t.blocked ? "blocked" : "next";
  if (t.status === "done") return "done";
  return null;
}

export function TasksPanel({
  roomId,
  tasks,
  afterAction,
  brandByName = new Map(),
}: {
  roomId: string;
  tasks: RoomTask[];
  afterAction: () => void;
  brandByName?: Map<string, string | undefined>;
}) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

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

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const lanes = new Map<Lane, RoomTask[]>(LANES.map((l) => [l.id, []]));
  for (const t of tasks) {
    const l = laneOf(t);
    if (l) lanes.get(l)!.push(t);
  }
  const cancelled = tasks.filter((t) => t.status === "cancelled");
  const live = tasks.length - cancelled.length;
  const done = lanes.get("done")!.length;
  // Which tasks the hovered card waits on, and which wait on it: lit up together.
  const hovered = hover ? byId.get(hover) : undefined;
  const related = new Set<string>([...(hovered?.blockedBy ?? []), ...tasks.filter((t) => hover && t.blockedBy?.includes(hover)).map((t) => t.id)]);

  const card = (t: RoomTask, lane: Lane) => {
    const blocks = tasks.filter((x) => x.blockedBy?.includes(t.id) && x.status !== "done" && x.status !== "cancelled");
    return (
      <div
        className={`kcard ${lane}${related.has(t.id) ? " related" : ""}${hover === t.id ? " lit" : ""}`}
        key={t.id}
        onMouseEnter={() => setHover(t.id)}
        onMouseLeave={() => setHover(null)}
        onFocus={() => setHover(t.id)}
        onBlur={() => setHover(null)}
        style={{ ["--accent" as string]: t.ownerName ? brandColor(brandByName.get(t.ownerName)) : "var(--line)" }}
      >
        <div className="kcard-top">
          <button
            className={`task-check${t.status === "done" ? " on" : ""}`}
            aria-label={t.status === "done" ? `Reopen ${t.title}` : `Mark ${t.title} done`}
            disabled={busy === t.id || lane === "blocked"}
            onClick={() => run(t.id, () => updateTask(roomId, t.id, { status: t.status === "done" ? "open" : "done" }))}
          >
            {t.status === "done" ? <Icon name="check" size={11} /> : lane === "blocked" ? <Icon name="lock" size={10} /> : null}
          </button>
          <span className="kcard-title">{t.title}</span>
        </div>
        {t.note && lane !== "done" && <p className="kcard-note">{t.note}</p>}
        {(t.blockedBy ?? []).length > 0 && lane === "blocked" && (
          <div className="kdeps">
            {(t.blockedBy ?? []).map((id) => {
              const b = byId.get(id);
              return (
                <span key={id} className={`dep-chip ${b ? laneOf(b) ?? "" : ""}`} title={b ? `Waits on: ${b.title}` : id}>
                  <Icon name="arrowRight" size={10} style={{ transform: "rotate(180deg)" }} />
                  {b?.title ?? "another task"}
                </span>
              );
            })}
          </div>
        )}
        {blocks.length > 0 && lane !== "blocked" && lane !== "done" && (
          <div className="kdeps">
            <span className="dep-chip unblocks" title={blocks.map((b) => b.title).join("\n")}>
              <Icon name="arrowRight" size={10} />
              Unblocks {blocks.length}
            </span>
          </div>
        )}
        <div className="kcard-meta">
          {t.ownerName ? (
            <span className="kowner">
              <Avatar name={t.ownerName} brand={brandByName.get(t.ownerName)} size={16} />
              {t.ownerName}
            </span>
          ) : (
            <span className="dim">Unassigned</span>
          )}
          <span className="spacer" />
          {t.status !== "done" && (
            <button className="icon-btn sm kcancel" aria-label={`Cancel ${t.title}`} title="Cancel task" disabled={busy === t.id} onClick={() => run(t.id, () => updateTask(roomId, t.id, { status: "cancelled" }))}>
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="panel-body">
      {live > 0 && (
        <div className="kflow">
          <Ring value={done} total={live} size={44} stroke={5} label={`${done} of ${live} tasks done`}>
            <span className="kflow-pct">{Math.round((done / live) * 100)}%</span>
          </Ring>
          <div className="kflow-main">
            <span className="kflow-title">
              {done} of {live} done
            </span>
            <SegBar height={8} segments={LANES.map((l) => ({ key: l.id, value: lanes.get(l.id)!.length, color: l.color, label: l.label }))} />
            <span className="kflow-legend">
              {LANES.map((l) => (
                <span key={l.id} className="dkey">
                  <i style={{ background: l.color }} />
                  {l.label} {lanes.get(l.id)!.length}
                </span>
              ))}
            </span>
          </div>
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
        <div className="kboard">
          {LANES.map((l) => {
            const list = lanes.get(l.id)!;
            return (
              <section className={`klane ${l.id}`} key={l.id} style={{ ["--lane" as string]: l.color }} aria-label={`${l.label}, ${list.length}`}>
                <h3 className="klane-head">
                  <i aria-hidden="true" />
                  {l.label}
                  <span className="count">{list.length}</span>
                </h3>
                {list.length === 0 ? <p className="klane-empty">{l.empty}</p> : list.map((t) => card(t, l.id))}
              </section>
            );
          })}
        </div>
      )}
      {cancelled.length > 0 && (
        <>
          <button className="linkish" onClick={() => setShowCancelled((s) => !s)}>
            {showCancelled ? "Hide cancelled tasks" : `Show cancelled tasks (${cancelled.length})`}
          </button>
          {showCancelled &&
            cancelled.map((t) => (
              <div className="task cancelled" key={t.id}>
                <span className="task-lock" aria-hidden="true">
                  <Icon name="x" size={12} />
                </span>
                <div className="task-main">
                  <div className="task-title">{t.title}</div>
                  <div className="task-meta">
                    <span className="dim">{t.ownerName ?? "Unassigned"}</span>
                    <span className="dim">{relTime(t.updatedAt)}</span>
                  </div>
                </div>
              </div>
            ))}
        </>
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
  brandByName = new Map(),
}: {
  brandByName?: Map<string, string | undefined>;
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
            <ReadyBranch key={b.id} branch={b} busy={busy === b.id} roomId={roomId} act={act} brand={brandByName.get(b.participantName)} />
          ))}
        </section>
      )}
      {tracking.length > 0 && (
        <section className="block">
          <h3>Being edited</h3>
          {tracking.map((b) => (
            <div className="branch tracking" key={b.id}>
              <div className="branch-head">
                <Avatar name={b.participantName} brand={brandByName.get(b.participantName)} size={22} />
                <span className="agent">{b.participantName}</span>
                <span className="pulse" aria-hidden="true" />
                <span className="dim">editing {b.paths.length} path{b.paths.length === 1 ? "" : "s"}</span>
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
  brand,
}: {
  brand?: string;
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
  const perFile = files.map((f) => {
    const hs = hunks.filter((h) => h.file === f);
    return { file: f, adds: hs.reduce((n, h) => n + h.additions, 0), dels: hs.reduce((n, h) => n + h.deletions, 0) };
  });
  const widest = Math.max(1, ...perFile.map((f) => f.adds + f.dels));

  return (
    <div className="branch ready" style={{ ["--accent" as string]: brandColor(brand) }}>
      <div className="branch-head">
        <Avatar name={b.participantName} brand={brand} size={22} />
        <span className="agent">{b.participantName}</span>
        <span className="diffstat">
          <span className="add">+{adds}</span>
          <span className="del">−{dels}</span>
        </span>
        <span className="dim">
          {files.length || b.paths.length} file{(files.length || b.paths.length) === 1 ? "" : "s"}
        </span>
      </div>
      {perFile.length > 0 && (
        <ul className="file-bars">
          {perFile.map((f) => (
            <li key={f.file}>
              <code title={f.file}>{f.file}</code>
              <span className="diffstat">
                <span className="add">+{f.adds}</span>
                <span className="del">−{f.dels}</span>
              </span>
              <DiffBar adds={f.adds} dels={f.dels} width={Math.max(10, Math.round(((f.adds + f.dels) / widest) * 80))} height={6} />
            </li>
          ))}
        </ul>
      )}
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
  "task.claim_next": "Took the next task",
  "room.delete": "Room deleted",
  "lease.guard": "Edit blocked",
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

function auditIcon(type: string): { icon: IconName; tone: string } {
  if (type === "lease.collision") return { icon: "shield", tone: "alert" };
  if (type.startsWith("lease.")) return { icon: "lock", tone: "claim" };
  if (type.startsWith("approval.")) return { icon: "hand", tone: "steer" };
  if (type.startsWith("branch.")) return { icon: "diff", tone: "diff" };
  if (type.startsWith("handoff.")) return { icon: "arrowRight", tone: "claim" };
  if (type.startsWith("task.")) return { icon: "tasks", tone: "task" };
  if (type.startsWith("note.")) return { icon: "note", tone: "note" };
  if (type.startsWith("message.")) return { icon: "reply", tone: "chat" };
  if (type === "participant.join") return { icon: "users", tone: "join" };
  if (type.startsWith("participant.")) return { icon: "users", tone: "steer" };
  if (type.startsWith("room.")) return { icon: type === "room.paused" ? "pause" : "gear", tone: "steer" };
  return { icon: "sparkle", tone: "" };
}

export function ActivityPanel({
  roomId,
  tick,
  events: given,
  brandByName = new Map(),
}: {
  roomId: string;
  tick: number;
  /** When the room already holds the audit trail, the panel reuses it instead of fetching. */
  events?: AuditEvent[];
  brandByName?: Map<string, string | undefined>;
}) {
  const [fetched, setFetched] = useState<AuditEvent[] | null>(null);
  const [hideChat, setHideChat] = useState(true);
  useEffect(() => {
    if (given) return;
    getAudit(roomId, 250).then(setFetched).catch(() => null);
  }, [roomId, tick, given]);
  const events = given ?? fetched;

  if (!events) return <div className="panel-body" />;
  const list = hideChat ? events.filter((e) => e.type !== "message.send" && e.type !== "message.overseer") : events;

  let lastMinute = "";
  return (
    <div className="panel-body">
      <label className="toggle-row">
        <input type="checkbox" checked={hideChat} onChange={(e) => setHideChat(e.target.checked)} />
        Hide chat messages
      </label>
      {list.length === 0 ? (
        <Empty icon={<Icon name="activity" size={22} />} title="Nothing recorded yet" />
      ) : (
        <ol className="vt">
          {list.map((e) => {
            const detail = auditDetail(e);
            const { icon, tone } = auditIcon(e.type);
            const minute = fmtTime(e.ts);
            const showTime = minute !== lastMinute;
            lastMinute = minute;
            return (
              <li className={`vt-row${tone ? ` vt-${tone}` : ""}`} key={e.id}>
                <span className="vt-time">{showTime ? minute : ""}</span>
                <span className="vt-node" aria-hidden="true">
                  <Icon name={icon} size={12} />
                </span>
                <div className="vt-body">
                  <div className="vt-line">
                    {e.actorName && (
                      <span className="vt-actor" style={{ ["--accent" as string]: brandColor(brandByName.get(e.actorName)) }}>
                        {e.actorName}
                      </span>
                    )}
                    <span className="vt-type">{AUDIT_LABELS[e.type] ?? e.type}</span>
                  </div>
                  {detail && <div className="vt-detail">{detail}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
