import { useEffect, useState } from "react";
import type { Room } from "@bothread/shared";
import { createRoom, listRooms } from "./api";

export default function Landing({ onOpen }: { onOpen: (id: string) => void }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () => listRooms().then(setRooms).catch(() => {});
  useEffect(() => {
    refresh();
  }, []);

  const create = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const { room } = await createRoom(n);
      setName("");
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

      <div className="section-label">Your rooms</div>
      {rooms.length === 0 ? (
        <p className="empty">No rooms yet — create one above.</p>
      ) : (
        <div className="rooms-list">
          {rooms.map((r) => (
            <button key={r.id} className="room-card" onClick={() => onOpen(r.id)}>
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
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
