import type { ReactNode } from "react";
import type { Approval, RoomTask, ThreadEntry } from "@bothread/shared";
import { DiffBar, DiffBlocks } from "../charts";
import { Icon, type IconName } from "../icons";
import { Avatar, fmtTime } from "../ui";
import { ACTION_LABEL } from "./ApprovalDock";

/* ---------------------------------------------------------------------------
 * The engine writes its system lines as plain sentences. The ones that carry a
 * shape (a collision, a hand-off, a task, an approval, a diff) are parsed back
 * into compact visual cards. Anything unrecognised falls back to a text line.
 * ------------------------------------------------------------------------- */

export type ParsedEvent =
  | { kind: "collision"; by: string; path: string; holder: string; verb: "claim" | "edit" }
  | { kind: "handoff"; from: string; to: string; path: string; note?: string; done: boolean }
  | { kind: "task"; actor?: string; title: string; state: "added" | "claimed" | "progress" | "done" | "open" | "cancelled" | "took" | "unblocked"; blockedBy?: string[] }
  | { kind: "approval"; who: string; action: string; details?: string; decision?: "approved" | "rejected" | "edited"; instruction?: string }
  | { kind: "diff"; who: string; files: { path: string; adds: number; dels: number }[] }
  | { kind: "verdict"; who: string; by: string; verb: "merged" | "discarded" | "accepted"; detail: string }
  | { kind: "presence"; who: string; verb: "joined" | "left" }
  | { kind: "note"; who: string; note: string; title: string };

export function parseSystem(text: string): ParsedEvent | null {
  let m: RegExpMatchArray | null;
  const t = text.trim();
  if ((m = t.match(/^Prevented: (.+?) tried to claim (.+?) — already held by (.+?)\.$/s))) return { kind: "collision", by: m[1]!, path: m[2]!, holder: m[3]!, verb: "claim" };
  if ((m = t.match(/^Edit blocked: (.+?) tried to edit (.+?) while (.+?) holds it\.$/s))) return { kind: "collision", by: m[1]!, path: m[2]!, holder: m[3]!, verb: "edit" };
  if ((m = t.match(/^@(.+?) — (.+?) needs `(.+?)` \(which you hold\)(?:: "([\s\S]*?)")?\. Release it/)))
    return { kind: "handoff", from: m[2]!, to: m[1]!, path: m[3]!, note: m[4], done: false };
  if ((m = t.match(/^@(.+?) — `(.+?)` is free now \(released by (.+?)\)\./))) return { kind: "handoff", from: m[3]!, to: m[1]!, path: m[2]!, done: true };
  if ((m = t.match(/^(.+?) added a task: "([\s\S]+?)"( \(claimed it\))?(?: — blocked by (.+?))?\.$/)))
    return { kind: "task", actor: m[1]!, title: m[2]!, state: m[3] ? "claimed" : "added", blockedBy: m[4]?.split(/,\s*/) };
  if ((m = t.match(/^(.+?) marked "([\s\S]+?)" as (in progress|done|open|cancelled)\.$/)))
    return { kind: "task", actor: m[1]!, title: m[2]!, state: m[3] === "in progress" ? "progress" : (m[3] as "done" | "open" | "cancelled") };
  if ((m = t.match(/^(.+?) took "([\s\S]+?)"\.$/))) return { kind: "task", actor: m[1]!, title: m[2]!, state: "took" };
  if ((m = t.match(/^Task \S+ "([\s\S]+?)" is unblocked \(was waiting on (\S+)\)\.$/))) return { kind: "task", title: m[1]!, state: "unblocked", blockedBy: [m[2]!] };
  if ((m = t.match(/^(.+?) requests approval to (\w+): ([\s\S]*)$/))) return { kind: "approval", who: m[1]!, action: m[2]!, details: m[3] };
  if ((m = t.match(/^Overseer (approved|rejected|edited) (.+?)'s request to (\w+)\.(?: Instruction: ([\s\S]*))?$/)))
    return { kind: "approval", who: m[2]!, action: m[3]!, decision: m[1] as "approved" | "rejected" | "edited", instruction: m[4] };
  if ((m = t.match(/^Δ (.+?): (.+)$/s))) {
    const files = [...m[2]!.matchAll(/(\S[^,]*?) \+(\d+) −(\d+)(?:,\s*|$)/g)].map((f) => ({ path: f[1]!, adds: Number(f[2]), dels: Number(f[3]) }));
    if (files.length) return { kind: "diff", who: m[1]!, files };
  }
  if ((m = t.match(/^@(.+?) — (.+?) (merged|discarded|accepted) (?:your changes|\d+ of \d+ changes? from you)([\s\S]*)$/)))
    return { kind: "verdict", who: m[1]!, by: m[2]!, verb: m[3] as "merged" | "discarded" | "accepted", detail: m[4]!.replace(/\s—\s/g, ", ").trim() };
  if ((m = t.match(/^(.+?) (joined|left) the room\.$/))) return { kind: "presence", who: m[1]!, verb: m[2] as "joined" | "left" };
  if ((m = t.match(/^(.+?) recorded an? (decision|issue|verification): ([\s\S]+)$/))) return { kind: "note", who: m[1]!, note: m[2]!, title: m[3]! };
  return null;
}

/** The engine's own wording uses spaced em dashes; the UI never shows them. */
export function softenDashes(text: string): string {
  return text.replace(/\s—\s/g, ", ");
}

function Who({ name, brandByName, size = 22 }: { name: string; brandByName: Map<string, string | undefined>; size?: number }) {
  const human = /^(overseer|you)$/i.test(name);
  return (
    <span className="evc-who">
      <Avatar name={human ? "You" : name} brand={brandByName.get(name)} kind={human ? "human" : "agent"} size={size} />
      <span className="evc-name">{human ? "You" : name}</span>
    </span>
  );
}

function Shell({
  tone,
  icon,
  title,
  at,
  children,
  className = "",
  seq,
  role,
}: {
  tone: string;
  icon: IconName;
  title: ReactNode;
  at: number;
  children?: ReactNode;
  className?: string;
  seq: number;
  role?: string;
}) {
  return (
    <div className={`evc ${tone.split(" ").filter(Boolean).map((t) => `ev-${t}`).join(" ")} ${className}`} data-seq={seq} role={role}>
      <span className="evc-icon" aria-hidden="true">
        <Icon name={icon} size={14} />
      </span>
      <div className="evc-body">
        <div className="evc-title">
          {title}
          <time title={new Date(at).toLocaleString()}>{fmtTime(at)}</time>
        </div>
        {children}
      </div>
    </div>
  );
}

const TASK_STATE: Record<string, { label: string; tone: string }> = {
  added: { label: "New task", tone: "open" },
  claimed: { label: "New task, claimed", tone: "progress" },
  progress: { label: "In progress", tone: "progress" },
  took: { label: "Picked up", tone: "progress" },
  done: { label: "Done", tone: "done" },
  open: { label: "Reopened", tone: "open" },
  cancelled: { label: "Cancelled", tone: "cancelled" },
  unblocked: { label: "Unblocked", tone: "open" },
};

const DECISION: Record<string, { label: string; tone: string }> = {
  approved: { label: "Approved", tone: "ok" },
  rejected: { label: "Denied", tone: "no" },
  edited: { label: "Redirected", tone: "redirect" },
};

export function EventCard({
  ev,
  m,
  brandByName,
  tasks,
  approvals,
  decisionFor,
  className,
}: {
  ev: ParsedEvent;
  m: ThreadEntry;
  brandByName: Map<string, string | undefined>;
  tasks: RoomTask[];
  approvals: Approval[];
  /** The later decision on this request, if any (found in the thread). */
  decisionFor?: "approved" | "rejected" | "edited";
  className?: string;
}): ReactNode {
  const common = { at: m.at, seq: m.seq, className };
  switch (ev.kind) {
    case "collision":
      return (
        <Shell {...common} tone="collision" icon="shield" title={<span>Collision prevented</span>} role="alert">
          <div className="evc-split">
            <div className="evc-side a">
              <Who name={ev.by} brandByName={brandByName} />
              <span className="evc-cap">tried to {ev.verb}</span>
            </div>
            <div className="evc-file">
              <Icon name="split" size={13} />
              <code>{ev.path}</code>
            </div>
            <div className="evc-side b">
              <Who name={ev.holder} brandByName={brandByName} />
              <span className="evc-cap">holds it</span>
            </div>
          </div>
        </Shell>
      );
    case "handoff":
      return (
        <Shell {...common} tone={ev.done ? "handoff done" : "handoff"} icon={ev.done ? "check" : "arrowRight"} title={<span>{ev.done ? "File handed off" : "Hand-off requested"}</span>}>
          <div className="evc-flow">
            <Who name={ev.done ? ev.from : ev.from} brandByName={brandByName} />
            <span className="evc-arrow" aria-label={ev.done ? "released to" : "needs a file from"}>
              <span className="evc-wire" />
              <code>{ev.path}</code>
              <span className="evc-wire" />
              <Icon name="arrowRight" size={13} />
            </span>
            <Who name={ev.to} brandByName={brandByName} />
          </div>
          {ev.note && <p className="evc-quote">"{ev.note}"</p>}
          {!ev.done && <p className="evc-cap">{ev.from} is waiting until {ev.to} releases it.</p>}
        </Shell>
      );
    case "task": {
      const st = TASK_STATE[ev.state]!;
      const deps = (ev.blockedBy ?? []).map((id) => tasks.find((t) => t.id === id)?.title ?? "another task");
      return (
        <Shell
          {...common}
          tone={`task ${st.tone} compact`}
          icon="tasks"
          title={
            <span className="evc-task">
              <span className={`evc-check ${st.tone}`} aria-hidden="true">
                {st.tone === "done" && <Icon name="check" size={11} />}
              </span>
              <span className="evc-task-title">{ev.title}</span>
              <span className={`evc-pill ${st.tone}`}>{st.label}</span>
              {ev.actor && <span className="evc-by">{ev.actor}</span>}
            </span>
          }
        >
          {deps.length > 0 && (
            <div className="evc-deps">
              <span className="evc-cap">{ev.state === "unblocked" ? "Was waiting on" : "Blocked by"}</span>
              {deps.map((d, i) => (
                <span key={i} className="dep-chip">
                  <Icon name="lock" size={10} />
                  {d}
                </span>
              ))}
            </div>
          )}
        </Shell>
      );
    }
    case "approval": {
      const pending = !ev.decision && approvals.some((a) => a.requestedByName === ev.who && a.action === ev.action);
      const outcome = ev.decision ?? decisionFor;
      const d = outcome ? DECISION[outcome]! : null;
      return (
        <Shell
          {...common}
          tone={`approval ${pending ? "pending" : d?.tone ?? ""}`}
          icon="hand"
          title={
            ev.decision ? (
              <span>
                You {d!.label.toLowerCase()} {ev.who}
              </span>
            ) : (
              <span>
                {ev.who} <span className="dim">asks to</span> {ACTION_LABEL[ev.action] ?? ev.action}
              </span>
            )
          }
        >
          {ev.details && <p className="evc-detail">{ev.details}</p>}
          {ev.instruction && <p className="evc-quote">"{ev.instruction}"</p>}
          <span className={`evc-pill ${pending ? "pending" : d?.tone ?? "muted"}`}>{pending ? "Waiting on you" : d ? d.label : "Decided"}</span>
        </Shell>
      );
    }
    case "diff": {
      const adds = ev.files.reduce((n, f) => n + f.adds, 0);
      const dels = ev.files.reduce((n, f) => n + f.dels, 0);
      return (
        <Shell
          {...common}
          tone="diff"
          icon="diff"
          title={
            <span>
              {ev.who} <span className="dim">changed {ev.files.length} file{ev.files.length === 1 ? "" : "s"}</span>
              <span className="evc-stat">
                <span className="add">+{adds}</span> <span className="del">−{dels}</span>
              </span>
            </span>
          }
        >
          <ul className="evc-files">
            {ev.files.slice(0, 5).map((f) => (
              <li key={f.path}>
                <code>{f.path}</code>
                <span className="evc-stat">
                  <span className="add">+{f.adds}</span> <span className="del">−{f.dels}</span>
                </span>
                <DiffBlocks adds={f.adds} dels={f.dels} />
              </li>
            ))}
          </ul>
          <DiffBar adds={adds} dels={dels} width={180} height={4} />
        </Shell>
      );
    }
    case "verdict":
      return (
        <Shell {...common} tone={`diff verdict ${ev.verb}`} icon={ev.verb === "discarded" ? "trash" : "check"} title={<span>{ev.by === "Overseer" ? "You" : ev.by} {ev.verb} {ev.who}'s changes</span>}>
          {ev.detail && <p className="evc-cap">{ev.detail.replace(/^[,.\s]+/, "")}</p>}
        </Shell>
      );
    case "note":
      return (
        <Shell {...common} tone={`note ${ev.note}`} icon="note" title={<span>{ev.who} <span className="dim">recorded a {ev.note}</span></span>}>
          <p className="evc-detail strong">{ev.title}</p>
        </Shell>
      );
    default:
      return null;
  }
}
