import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Tone = "info" | "success" | "warn" | "danger";
interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: Tone;
  action?: { label: string; run: () => void };
  leaving?: boolean;
}
interface ToastApi {
  show: (t: { title: string; body?: string; tone?: Tone; action?: Toast["action"]; ttl?: number }) => void;
  error: (err: unknown, fallback?: string) => void;
}

const Ctx = createContext<ToastApi>({ show: () => {}, error: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 180);
  }, []);

  const show = useCallback<ToastApi["show"]>(
    ({ title, body, tone = "info", action, ttl }) => {
      const id = nextId.current++;
      setToasts((ts) => [...ts.slice(-3), { id, title, body, tone, action }]);
      setTimeout(() => dismiss(id), ttl ?? (tone === "danger" || action ? 7000 : 4200));
    },
    [dismiss]
  );

  const error = useCallback<ToastApi["error"]>(
    (err, fallback = "Something went wrong") => {
      const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
      const offline = msg === "Failed to fetch" || msg.includes("NetworkError");
      show({
        tone: "danger",
        title: offline ? "Can't reach the hub" : fallback,
        body: offline ? "Is `bothread start` still running?" : msg || undefined,
      });
    },
    [show]
  );

  return (
    <Ctx.Provider value={{ show, error }}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastCard({ toast: t, onClose }: { toast: Toast; onClose: () => void }) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, []);
  return (
    <div className={`toast ${t.tone}${entered && !t.leaving ? " in" : ""}`} role={t.tone === "danger" ? "alert" : "status"}>
      <span className="toast-mark" aria-hidden="true" />
      <div className="toast-body">
        <div className="toast-title">{t.title}</div>
        {t.body && <div className="toast-text">{t.body}</div>}
      </div>
      {t.action && (
        <button
          className="btn sm"
          onClick={() => {
            t.action!.run();
            onClose();
          }}
        >
          {t.action.label}
        </button>
      )}
      <button className="toast-x" onClick={onClose} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
