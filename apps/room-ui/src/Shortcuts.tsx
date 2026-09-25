import { useEffect } from "react";
import { modKey } from "./hooks";
import { Icon } from "./icons";
import { Kbd } from "./ui";

const ROWS: [string[], string][] = [
  [[modKey, "K"], "Command palette"],
  [["/"], "Write to the room"],
  [["@"], "Mention an agent while writing"],
  [["Enter"], "Send  (Shift + Enter for a new line)"],
  [["1", "…", "5"], "Switch side panel tab"],
  [["C"], "Connect an agent"],
  [["Shift", "P"], "Pause or resume the room"],
  [["Shift", "A"], "Approve the pending request"],
  [["Shift", "D"], "Deny the pending request"],
  [["J"], "Jump to the latest message"],
  [["?"], "This list"],
  [["Esc"], "Close dialogs, cancel reply"],
];

export default function Shortcuts({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal shortcuts" role="dialog" aria-label="Keyboard shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            <Icon name="keyboard" size={18} /> Keyboard shortcuts
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <dl className="shortcut-list">
          {ROWS.map(([keys, label]) => (
            <div key={label}>
              <dt>
                {keys.map((k, i) => (k === "…" ? <span key={i}>to</span> : <Kbd key={i}>{k}</Kbd>))}
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
