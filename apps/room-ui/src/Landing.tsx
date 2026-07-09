import { useEffect, useState, type MouseEvent } from "react";
import type { Room } from "@bothread/shared";
import { createRoom, deleteRoom, listRooms } from "./api";

export default function Landing({ onOpen }: { onOpen: (id: string) => void }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = () => listRooms().then(setRooms).catch(() => {});
  useEffect(() => {
    refresh();
  }, []);

  const remove = async (r: Room, e: MouseEvent) => {
    e.stopPropagation();
    if (deletingId) return;
    if (!window.confirm(`Delete "${r.name}" permanently? This removes its messages, tasks, notes, and history — there's no undo.`)) {
      return;
    }
    setDeletingId(r.id);
    try {
      await deleteRoom(r.id);
      setRooms((prev) => prev.filter((x) => x.id !== r.id));
    } catch {
      /* leave the card in place — user can retry */
    } finally {
      setDeletingId(null);
    }
  };

  const create = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const { room } = await createRoom(n, projectPath.trim() || undefined);
      setName("");
      setProjectPath("");
      onOpen(room.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="landing">
      <h1>
        The room where your agents <em>work together</em>.
      </h1>
      <p className="sub">
        Start a room, share its session ID with your agents, and watch them collaborate — claiming files,
        avoiding collisions, asking before anything risky. You stay in command.
      </p>

      <div className="create-row">
        <input
          className="field"
          placeholder="New room name — e.g. payments-refactor"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <button className="btn primary" onClick={create} disabled={busy}>
          Create room
        </button>
      </div>
      <div className="create-row project">
        <input
          className="field"
          placeholder="Project folder (optional) — e.g. C:\\code\\my-app — enables per-agent git diffs"
          value={projectPath}
          onChange={(e) => setProjectPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
      </div>
      <p className="create-hint">
        Point Bothread at your project's git repo and each agent's changes show up as a reviewable
        diff you can merge or discard — no silent overwrites.
      </p>

      <div className="section-label">Your rooms</div>
      {rooms.length === 0 ? (
        <p className="empty">No rooms yet — create one above.</p>
      ) : (
        <div className="rooms-list">
          {rooms.map((r) => (
            <div
              key={r.id}
              className="room-card"
              role="button"
              tabIndex={0}
              onClick={() => onOpen(r.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(r.id)}
            >
              <div>
                <div className="nm">{r.name}</div>
                <div className="meta mono" style={{ fontSize: ".7rem", color: "var(--muted-1)" }}>
                  {new Date(r.createdAt).toLocaleString()}
                </div>
              </div>
              <span className={`pill ${r.status}`}>
                <span className="dot" />
                {r.status}
              </span>
              <button
                className="room-delete"
                title="Delete room"
                aria-label={`Delete room ${r.name}`}
                disabled={deletingId === r.id}
                onClick={(e) => remove(r, e)}
              >
                {deletingId === r.id ? "…" : "✕"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
