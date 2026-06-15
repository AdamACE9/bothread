import { useCallback, useEffect, useRef, useState } from "react";
import { getRoom, type RoomDetail } from "./api";

/**
 * Live room state. Fetches the full detail, then re-fetches whenever the hub
 * pushes a WebSocket event — simple and always-consistent for a local single
 * overseer (volume is tiny). Auto-reconnects the socket if it drops.
 */
export function useRoom(roomId: string | null) {
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [connected, setConnected] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      setDetail(await getRoom(roomId));
    } catch {
      /* transient — the next event or reconnect will refresh */
    }
  }, [roomId]);

  // Coalesce bursts of events into one refresh.
  const scheduleRefresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(refresh, 60);
  }, [refresh]);

  useEffect(() => {
    if (!roomId) {
      setDetail(null);
      return;
    }
    let alive = true;
    let ws: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;

    refresh();

    const connect = () => {
      if (!alive) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws?room=${roomId}`);
      ws.onopen = () => alive && setConnected(true);
      ws.onmessage = () => scheduleRefresh();
      ws.onclose = () => {
        if (!alive) return;
        setConnected(false);
        reconnect = setTimeout(connect, 1200);
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    return () => {
      alive = false;
      if (reconnect) clearTimeout(reconnect);
      if (timer.current) clearTimeout(timer.current);
      ws?.close();
    };
  }, [roomId, refresh, scheduleRefresh]);

  return { detail, connected, refresh };
}
