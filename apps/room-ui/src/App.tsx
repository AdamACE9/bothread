import { useEffect, useState } from "react";
import Landing from "./Landing";
import RoomView from "./RoomView";

const roomFromHash = () => {
  const m = location.hash.match(/^#\/room\/(.+)$/);
  return m ? decodeURIComponent(m[1]!) : null;
};

export default function App() {
  const [roomId, setRoomId] = useState<string | null>(roomFromHash());

  useEffect(() => {
    const onHash = () => setRoomId(roomFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const open = (id: string) => {
    location.hash = `#/room/${encodeURIComponent(id)}`;
    setRoomId(id);
  };
  const back = () => {
    location.hash = "";
    setRoomId(null);
  };

  return roomId ? <RoomView roomId={roomId} onBack={back} /> : <Landing onOpen={open} />;
}
