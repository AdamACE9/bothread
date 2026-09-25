import { useEffect, useState } from "react";
import type { RiskAction } from "@bothread/shared";
import { deleteRoom, updateRoomSettings } from "../api";
import { Icon } from "../icons";
import { useToast } from "../toast";

const RISK_ACTIONS: { id: RiskAction; label: string; hint: string }[] = [
  { id: "deploy", label: "Deploy", hint: "Ship to any environment" },
  { id: "git_push", label: "git push", hint: "Push to a remote" },
  { id: "delete", label: "Delete files", hint: "Remove files or folders" },
  { id: "migration", label: "DB migrations", hint: "Change a database schema" },
  { id: "install", label: "Install packages", hint: "Add dependencies" },
  { id: "shell", label: "Shell commands", hint: "Run arbitrary commands" },
  { id: "network", label: "Network calls", hint: "Reach external services" },
  { id: "other", label: "Anything else risky", hint: "The agent's judgement" },
];

const TTL_OPTIONS = [5, 15, 30, 60, 120];

export default function SettingsModal({
  roomId,
  roomName,
  requireApprovalFor,
  leaseTtlMs,
  notify,
  onNotifyChange,
  onClose,
  afterSave,
  onDeleted,
}: {
  roomId: string;
  roomName: string;
  requireApprovalFor: RiskAction[];
  leaseTtlMs?: number;
  notify: "on" | "off";
  onNotifyChange: (v: "on" | "off") => void;
  onClose: () => void;
  afterSave: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [sel, setSel] = useState<Set<RiskAction>>(new Set(requireApprovalFor));
  const [ttl, setTtl] = useState(Math.round((leaseTtlMs ?? 15 * 60_000) / 60_000));
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [showDanger, setShowDanger] = useState(false);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const toggle = (a: RiskAction) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });

  const save = async () => {
    setBusy(true);
    try {
      await updateRoomSettings(roomId, { requireApprovalFor: [...sel], defaultLeaseTtlMs: ttl * 60_000 });
      toast.show({ tone: "success", title: "Settings saved", body: "Agents see the new rules on their next call." });
      afterSave();
      onClose();
    } catch (err) {
      toast.error(err, "Couldn't save settings");
    } finally {
      setBusy(false);
    }
  };

  const enableNotify = async () => {
    if (notify === "on") return onNotifyChange("off");
    if (!("Notification" in window)) {
      toast.show({ tone: "warn", title: "This browser can't show notifications" });
      return;
    }
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm === "granted") onNotifyChange("on");
    else toast.show({ tone: "warn", title: "Notifications are blocked", body: "Allow them for this page in your browser settings." });
  };

  const remove = async () => {
    try {
      await deleteRoom(roomId);
      toast.show({ title: `Deleted "${roomName}"` });
      onDeleted();
    } catch (err) {
      toast.error(err, "Couldn't delete the room");
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal settings" role="dialog" aria-label="Room settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Room settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>

        <section className="set-block">
          <h3>Ask me first before agents</h3>
          <p className="set-hint">
            Checked actions make agents call <code>request_approval</code> and wait for you. Each agent's own app already
            guards risky actions, so this is off unless you want a second checkpoint here.
          </p>
          <div className="risk-grid">
            {RISK_ACTIONS.map((a) => (
              <label key={a.id} className={`risk${sel.has(a.id) ? " on" : ""}`}>
                <input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} />
                <span className="risk-text">
                  <strong>{a.label}</strong>
                  <small>{a.hint}</small>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="set-block">
          <h3>File claims expire after</h3>
          <p className="set-hint">A claim an agent forgets to release frees itself after this long. Agents can renew.</p>
          <div className="seg">
            {TTL_OPTIONS.map((m) => (
              <button key={m} type="button" className={`seg-btn${ttl === m ? " on" : ""}`} onClick={() => setTtl(m)}>
                {m < 60 ? `${m} min` : `${m / 60} h`}
              </button>
            ))}
          </div>
        </section>

        <section className="set-block">
          <h3>On this device</h3>
          <label className="switch-row">
            <span>
              <strong>Desktop notifications</strong>
              <small>When an agent needs your OK or a decision and this tab is in the background.</small>
            </span>
            <button type="button" role="switch" aria-checked={notify === "on"} className={`switch${notify === "on" ? " on" : ""}`} onClick={enableNotify}>
              <span />
            </button>
          </label>
        </section>

        <div className="modal-actions">
          <button className="linkish danger" onClick={() => setShowDanger((s) => !s)}>
            Delete this room
          </button>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? "Saving" : "Save"}
          </button>
        </div>

        {showDanger && (
          <section className="danger-zone">
            <p>
              Deleting removes every message, task, note and claim in <strong>{roomName}</strong>. There is no undo. Type
              the room name to confirm.
            </p>
            <div className="row">
              <input className="field sm" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={roomName} />
              <button className="btn sm danger solid" disabled={confirmName !== roomName} onClick={remove}>
                Delete forever
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
