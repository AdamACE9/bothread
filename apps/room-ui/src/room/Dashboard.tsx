import type { AgentBranch, Approval, RoomSnapshot } from "@bothread/shared";
import { DiffBar, Ring, SegBar, Sparkline, brandColor, bucketize } from "../charts";
import { Icon } from "../icons";
import { Avatar, presence } from "../ui";

type Tab = "claims" | "tasks" | "changes" | "notes" | "activity";
export type StageView = "thread" | "map" | "timeline";

/**
 * The room at a glance: six live instruments in one band under the header.
 * Every cell is a button that opens the place where that number lives.
 */
export default function Dashboard({
  snapshot,
  branches,
  approvals,
  now,
  onOpenTab,
  onView,
  onApprovals,
}: {
  snapshot: RoomSnapshot;
  branches: AgentBranch[];
  approvals: Approval[];
  now: number;
  onOpenTab: (t: Tab) => void;
  onView: (v: StageView) => void;
  onApprovals: () => void;
}) {
  const agents = snapshot.participants.filter((p) => p.kind === "agent" && p.status !== "left" && p.status !== "revoked");
  const listening = agents.filter((a) => a.listening).length;
  const brandByName = new Map(snapshot.participants.map((p) => [p.name, p.brand]));

  // Messages: one bucket per minute, over the room's life up to the last 30 minutes.
  const talk = snapshot.thread.filter((m) => m.kind !== "system");
  const first = talk[0]?.at ?? now;
  const minutes = Math.min(30, Math.max(10, Math.ceil((now - first) / 60_000)));
  const perMin = bucketize(
    talk.map((m) => m.at),
    now,
    minutes * 60_000,
    minutes
  );
  const recent = perMin.slice(-10).reduce((a, b) => a + b, 0);

  // Claims by holder, in brand colors.
  const byHolder = new Map<string, number>();
  for (const l of snapshot.locks) byHolder.set(l.heldByName, (byHolder.get(l.heldByName) ?? 0) + 1);
  const holders = [...byHolder.entries()].sort((a, b) => b[1] - a[1]);

  // Tasks
  const live = snapshot.tasks.filter((t) => t.status !== "cancelled");
  const done = live.filter((t) => t.status === "done").length;
  const blocked = live.filter((t) => t.status === "open" && t.blocked).length;
  const doing = live.filter((t) => t.status === "in_progress").length;

  // Changes ready for review
  const ready = branches.filter((b) => b.status === "ready");
  const adds = ready.reduce((n, b) => n + (b.hunks ?? []).reduce((s, h) => s + h.additions, 0), 0);
  const dels = ready.reduce((n, b) => n + (b.hunks ?? []).reduce((s, h) => s + h.deletions, 0), 0);
  const editing = branches.filter((b) => b.status === "tracking").length;

  const waiting = approvals.length;

  return (
    <div className="dash" role="group" aria-label="Room at a glance">
      <button className="dcell" onClick={() => onView("map")} title="See who is where on the room map (G M)">
        <span className="dlabel">Agents</span>
        <span className="dmain">
          <span className="dval">{agents.length}</span>
          <span className="dstack" aria-hidden="true">
            {agents.slice(0, 5).map((a) => (
              <Avatar key={a.id} name={a.name} brand={a.brand} size={24} ring={presence(a)} />
            ))}
            {agents.length > 5 && <span className="dmore">+{agents.length - 5}</span>}
          </span>
        </span>
        <span className="dsub">{agents.length === 0 ? "Nobody here yet" : listening ? `${listening} listening now` : "All working"}</span>
      </button>

      <button className="dcell" onClick={() => onView("timeline")} title="Open the timeline (G L)">
        <span className="dlabel">Messages</span>
        <span className="dmain">
          <span className="dval">{talk.length}</span>
          <Sparkline values={perMin} width={92} height={30} color="var(--copper)" label={`Messages per minute, last ${minutes} minutes`} />
        </span>
        <span className="dsub">{recent ? `${recent} in the last 10 min` : "Quiet for 10 min"}</span>
      </button>

      <button className="dcell" onClick={() => onOpenTab("claims")} title="Open claims (1)">
        <span className="dlabel">Files claimed</span>
        <span className="dmain">
          <span className="dval">{snapshot.locks.length}</span>
          <span className="dbars">
            <SegBar
              height={8}
              segments={holders.map(([name, n]) => ({ key: name, value: n, color: brandColor(brandByName.get(name)), label: name }))}
            />
            <span className="dlegend">
              {holders.slice(0, 3).map(([name, n]) => (
                <span key={name} className="dkey">
                  <i style={{ background: brandColor(brandByName.get(name)) }} />
                  {name.split(" ")[0]} {n}
                </span>
              ))}
              {holders.length === 0 && <span className="dkey dim">Nothing held</span>}
            </span>
          </span>
        </span>
        <span className="dsub">{holders.length ? `Held by ${holders.length} agent${holders.length === 1 ? "" : "s"}` : "No one is editing"}</span>
      </button>

      <button className="dcell" onClick={() => onOpenTab("tasks")} title="Open the task board (2)">
        <span className="dlabel">Tasks</span>
        <span className="dmain">
          <Ring value={done} total={live.length} size={34} stroke={4} label={`${done} of ${live.length} tasks done`} />
          <span className="dval">
            {done}
            <small>/{live.length}</small>
          </span>
        </span>
        <span className="dsub">
          {live.length === 0 ? "No tasks yet" : `${doing} in progress`}
          {blocked > 0 && (
            <span className="dwarn">
              <Icon name="lock" size={10} /> {blocked} blocked
            </span>
          )}
        </span>
      </button>

      <button className={`dcell${ready.length ? " is-hot" : ""}`} onClick={() => onOpenTab("changes")} title="Review changes (3)">
        <span className="dlabel">Changes ready</span>
        <span className="dmain">
          <span className="dval">{ready.length}</span>
          <span className="ddiff">
            {adds + dels > 0 ? (
              <span className="dnums">
                <span className="add">+{adds}</span>
                <span className="del">−{dels}</span>
              </span>
            ) : (
              <span className="dnums dim">No diff yet</span>
            )}
            <DiffBar adds={adds} dels={dels} width={84} height={6} />
          </span>
        </span>
        <span className="dsub">{editing ? `${editing} being edited` : ready.length ? "Waiting for your review" : "Nothing to review"}</span>
      </button>

      <button className={`dcell d-approvals${waiting ? " is-waiting" : ""}`} onClick={onApprovals} title={waiting ? "Jump to the approval (Shift A approves)" : "No approvals waiting"}>
        <span className="dlabel">Approvals</span>
        <span className="dmain">
          <span className="dval">{waiting}</span>
          <span className="dhand" aria-hidden="true">
            <Icon name="hand" size={18} />
          </span>
        </span>
        <span className="dsub">{waiting ? `${approvals[0]!.requestedByName} is waiting on you` : "Nothing needs your OK"}</span>
      </button>
    </div>
  );
}
