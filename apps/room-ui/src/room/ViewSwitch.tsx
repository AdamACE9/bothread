import type { IconName } from "../icons";
import { Icon } from "../icons";
import type { StageView } from "./Dashboard";

export const VIEWS: { id: StageView; label: string; icon: IconName; key: string }[] = [
  { id: "thread", label: "Thread", icon: "thread", key: "T" },
  { id: "map", label: "Map", icon: "map", key: "M" },
  { id: "timeline", label: "Timeline", icon: "timeline", key: "L" },
];

/** Thread / Map / Timeline: one segmented control, a sliding thread under the active view. */
export default function ViewSwitch({ view, onChange }: { view: StageView; onChange: (v: StageView) => void }) {
  const idx = Math.max(0, VIEWS.findIndex((v) => v.id === view));
  return (
    <div className="vswitch" role="tablist" aria-label="Room view" style={{ ["--vi" as string]: idx }}>
      <span className="vs-glide" aria-hidden="true" />
      {VIEWS.map((v) => (
        <button
          key={v.id}
          role="tab"
          aria-selected={view === v.id}
          className={`vs-btn${view === v.id ? " on" : ""}`}
          onClick={() => onChange(v.id)}
          title={`${v.label} view (G then ${v.key})`}
        >
          <Icon name={v.icon} size={15} />
          <span className="vs-label">{v.label}</span>
        </button>
      ))}
    </div>
  );
}
