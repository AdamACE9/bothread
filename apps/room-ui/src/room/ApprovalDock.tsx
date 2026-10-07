import { useRef, useState } from "react";
import type { Approval } from "@bothread/shared";
import { decideApproval } from "../api";
import { relTime } from "../hooks";
import { Icon } from "../icons";
import { useHotkeys } from "../palette";
import { useToast } from "../toast";
import { Kbd, richText } from "../ui";
import { useMentionPicker, type MentionAgent } from "./mentions";

export const ACTION_LABEL: Record<string, string> = {
  delete: "delete files",
  deploy: "deploy",
  shell: "run a shell command",
  git_push: "git push",
  install: "install packages",
  migration: "run a database migration",
  network: "make network calls",
  other: "do something risky",
};

export default function ApprovalDock({
  roomId,
  approvals,
  now,
  afterDecide,
  agents = [],
  names,
  compact = false,
}: {
  /** One-line bar for the Map and Timeline views, so the visual keeps its room. */
  compact?: boolean;
  roomId: string;
  approvals: Approval[];
  now: number;
  afterDecide: () => void;
  agents?: MentionAgent[];
  names?: string[];
}) {
  const toast = useToast();
  const approval = approvals[0]!;
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const mp = useMentionPicker({ value: instruction, setValue: setInstruction, fieldRef: field, agents });

  const decide = async (decision: "approved" | "rejected" | "edited", note?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await decideApproval(roomId, approval.id, decision, note);
      setEditing(false);
      setInstruction("");
      toast.show({
        tone: decision === "approved" ? "success" : decision === "rejected" ? "warn" : "info",
        title: decision === "approved" ? `Approved ${approval.requestedByName}` : decision === "rejected" ? `Denied ${approval.requestedByName}` : `Redirected ${approval.requestedByName}`,
      });
      afterDecide();
    } catch (err) {
      toast.error(err, "Couldn't send your decision");
    } finally {
      setBusy(false);
    }
  };

  useHotkeys({
    "shift+a": () => !editing && decide("approved"),
    "shift+d": () => !editing && decide("rejected"),
    "shift+e": () => setEditing(true),
  });

  if (compact && !expanded && !editing) {
    return (
      <section className="approval compact" role="alertdialog" aria-label="Approval needed" aria-describedby="approval-what">
        <span className="approval-badge">
          <Icon name="hand" size={14} />
        </span>
        <p className="approval-what" id="approval-what">
          <strong>{approval.requestedByName}</strong> wants to <strong className="act">{ACTION_LABEL[approval.action] ?? approval.action}</strong>
          <span className="approval-snippet">{approval.details}</span>
        </p>
        {approvals.length > 1 && <span className="dim">1 of {approvals.length}</span>}
        <button className="btn sm ghost" onClick={() => setExpanded(true)}>
          Details
        </button>
        <button className="btn sm danger" onClick={() => decide("rejected")} disabled={busy}>
          Deny
        </button>
        <button className="btn sm" onClick={() => setEditing(true)} disabled={busy}>
          Redirect
        </button>
        <button className="btn sm primary" onClick={() => decide("approved")} disabled={busy}>
          <Icon name="check" size={13} /> Approve
        </button>
      </section>
    );
  }

  return (
    <section className="approval" role="alertdialog" aria-label="Approval needed" aria-describedby="approval-what">
      <div className="approval-top">
        <span className="approval-badge">
          <Icon name="hand" size={14} /> Needs your OK
        </span>
        {approvals.length > 1 && <span className="dim">1 of {approvals.length}</span>}
        <span className="spacer" />
        <span className="dim">asked {relTime(approval.createdAt, now)}</span>
      </div>
      <p className="approval-what" id="approval-what">
        <strong>{approval.requestedByName}</strong> wants to <strong className="act">{ACTION_LABEL[approval.action] ?? approval.action}</strong>
      </p>
      <div className="approval-details">{richText(approval.details, roomId, { names })}</div>
      {approval.files && approval.files.length > 0 && (
        <div className="approval-files">
          {approval.files.map((f) => (
            <code key={f}>{f}</code>
          ))}
        </div>
      )}
      {editing ? (
        <form
          className="approval-acts"
          onSubmit={(e) => {
            e.preventDefault();
            if (instruction.trim()) decide("edited", instruction.trim());
          }}
        >
          <div className="approval-field">
            {mp.picker}
            <input
              ref={field}
              className="field"
              autoFocus
              placeholder={`Tell ${approval.requestedByName} what to do instead. Type @ to loop in another agent.`}
              value={instruction}
              {...mp.fieldProps}
              aria-label="Instruction instead"
              onChange={(e) => {
                setInstruction(e.target.value);
                mp.sync(e.target.value, e.target.selectionStart);
              }}
              onBlur={() => mp.close()}
              onKeyDown={(e) => {
                if (mp.onKeyDown(e)) return;
                if (e.key === "Escape") setEditing(false);
              }}
            />
          </div>
          <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button className="btn primary" disabled={!instruction.trim() || busy}>
            Send instead
          </button>
        </form>
      ) : (
        <div className="approval-acts">
          <button className="btn danger" onClick={() => decide("rejected")} disabled={busy}>
            Deny <Kbd>⇧D</Kbd>
          </button>
          <button className="btn" onClick={() => setEditing(true)} disabled={busy}>
            Redirect <Kbd>⇧E</Kbd>
          </button>
          <span className="spacer" />
          <button className="btn primary" onClick={() => decide("approved")} disabled={busy}>
            <Icon name="check" size={14} /> Approve <Kbd>⇧A</Kbd>
          </button>
        </div>
      )}
    </section>
  );
}
