import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerEvent } from "@bothread/shared";
import { getRoom, roomSocketUrl, type RoomDetail } from "./api";

/**
 * Live room state. Fetches the full detail, then re-fetches whenever the hub
 * pushes a WebSocket event — simple and always-consistent for a local single
 * overseer (volume is tiny). Auto-reconnects the socket if it drops, with a
 * gentle backoff so a stopped hub doesn't get hammered.
 *
 * `onEvent` sees every raw push, so the room can react to specific moments
 * (a join, a collision, an approval) instead of diffing whole snapshots.
 */
export function useRoom(roomId: string | null, onEvent?: (ev: ServerEvent) => void) {
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      setDetail(await getRoom(roomId));
      setError(null);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 400 || status === 404) setError("This room doesn't exist anymore. It may have been deleted.");
      /* anything else is transient: the next event or reconnect will refresh */
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
    let attempts = 0;

    setDetail(null);
    setError(null);
    refresh();

    const connect = () => {
      if (!alive) return;
      ws = new WebSocket(roomSocketUrl(roomId));
      ws.onopen = () => {
        if (!alive) return;
        attempts = 0;
        setConnected(true);
        refresh();
      };
      ws.onmessage = (msg) => {
        scheduleRefresh();
        try {
          const ev = JSON.parse(String(msg.data)) as ServerEvent;
          if (ev.type !== "snapshot") eventRef.current?.(ev);
        } catch {
          /* not JSON: ignore */
        }
      };
      ws.onclose = () => {
        if (!alive) return;
        setConnected(false);
        attempts++;
        reconnect = setTimeout(connect, Math.min(8000, 800 * attempts));
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

  return { detail, connected, refresh, error };
}
