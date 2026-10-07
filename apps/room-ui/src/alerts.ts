/* ---------------------------------------------------------------------------
 * Overseer alerts: a soft generated chime (no audio asset), a desktop
 * notification while the tab is hidden, and a flashing tab title.
 * ------------------------------------------------------------------------- */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    return ctx;
  } catch {
    return null;
  }
}

// Browsers only let audio start after a user gesture: unlock on the first one.
if (typeof window !== "undefined") {
  const unlock = () => {
    const c = audio();
    if (c && c.state === "suspended") c.resume().catch(() => null);
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

let lastChime = 0;

/** Two soft sine notes, a fifth apart. Rate limited so a burst of messages is one chime. */
export function chime(): void {
  const now = Date.now();
  if (now - lastChime < 1500) return;
  lastChime = now;
  const c = audio();
  if (!c) return;
  try {
    if (c.state === "suspended") c.resume().catch(() => null);
    const t0 = c.currentTime + 0.01;
    const master = c.createGain();
    master.gain.value = 0.16;
    master.connect(c.destination);
    [
      [659.25, 0],
      [987.77, 0.12],
    ].forEach(([freq, delay]) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.value = freq!;
      const s = t0 + delay!;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(1, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.55);
      o.connect(g).connect(master);
      o.start(s);
      o.stop(s + 0.6);
    });
  } catch {
    /* audio unavailable */
  }
}

export function desktopNotify(title: string, body: string, enabled: boolean): void {
  if (!enabled || !document.hidden || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, icon: "/favicon.svg", tag: title });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

/* ----- Title flashing: alternates the tab title until the tab is visible again ----- */

let flashTimer: ReturnType<typeof setInterval> | null = null;
let flashBase = "";

export function stopTitleFlash(): void {
  if (flashTimer) clearInterval(flashTimer);
  flashTimer = null;
  if (flashBase) document.title = flashBase;
  flashBase = "";
}

export function flashTitle(alert: string): void {
  if (!document.hidden) return;
  stopTitleFlash();
  flashBase = document.title;
  let on = false;
  flashTimer = setInterval(() => {
    on = !on;
    document.title = on ? `● ${alert}` : flashBase;
  }, 1100);
  const stop = () => {
    if (document.hidden) return;
    document.removeEventListener("visibilitychange", stop);
    stopTitleFlash();
  };
  document.addEventListener("visibilitychange", stop);
}

/** Lets other title writers (the room's badge) update the base the flasher restores. */
export function setBaseTitle(title: string): void {
  if (flashTimer) flashBase = title;
  else document.title = title;
}
