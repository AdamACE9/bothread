import { EventEmitter } from "node:events";
import type { ServerEvent } from "@bothread/shared";

/**
 * In-process event bus for the hub. The engine publishes every state change
 * here; the WebSocket layer fans events out to the room UI, and `wait_for_update`
 * parks a pending promise on it (Coral-style waiters) so agents long-poll
 * instead of busy-polling.
 */
export class RoomBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(ev: ServerEvent): void {
    this.emitter.emit(ev.roomId, ev);
    this.emitter.emit("*", ev);
  }

  /** Subscribe to one room. Returns an unsubscribe fn. */
  on(roomId: string, fn: (ev: ServerEvent) => void): () => void {
    this.emitter.on(roomId, fn);
    return () => this.emitter.off(roomId, fn);
  }

  /** Subscribe to every room (the WS hub uses this). Returns unsubscribe. */
  onAny(fn: (ev: ServerEvent) => void): () => void {
    this.emitter.on("*", fn);
    return () => this.emitter.off("*", fn);
  }

  /**
   * Resolve when the next matching event arrives in a room, or null on timeout.
   * One-shot; always cleans up its listener and timer.
   */
  waitFor(
    roomId: string,
    match: (ev: ServerEvent) => boolean,
    timeoutMs: number
  ): Promise<ServerEvent | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (val: ServerEvent | null) => {
        if (settled) return;
        settled = true;
        off();
        clearTimeout(timer);
        resolve(val);
      };
      const off = this.on(roomId, (ev) => {
        if (match(ev)) finish(ev);
      });
      const timer = setTimeout(() => finish(null), Math.max(0, timeoutMs));
    });
  }
}
