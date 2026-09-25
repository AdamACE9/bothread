import { useState } from "react";
import type { Approval } from "@bothread/shared";
import { decideApproval } from "../api";
import { relTime } from "../hooks";
import { Icon } from "../icons";
import { useHotkeys } from "../palette";
import { useToast } from "../toast";
import { Kbd, richText } from "../ui";

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
}: {
  roomId: string;
  approvals: Approval[];
  now: number;
  afterDecide: () => void;
}) {
  const toast = useToast();
  const approval = approvals[0]!;
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);

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
      <div className="approval-details">{richText(approval.details, roomId)}</div>
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
          <input
            className="field"
            autoFocus
            placeholder={`Tell ${approval.requestedByName} what to do instead`}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          />
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
