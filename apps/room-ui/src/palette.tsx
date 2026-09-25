import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isTyping, modKey } from "./hooks";
import { Icon, type IconName } from "./icons";
import { Kbd } from "./ui";

export interface PaletteAction {
  id: string;
  label: string;
  group: string;
  icon?: IconName;
  hint?: string;
  keywords?: string;
  run: () => void;
}

interface PaletteApi {
  open: () => void;
  register: (scope: string, actions: PaletteAction[]) => void;
  unregister: (scope: string) => void;
}
const Ctx = createContext<PaletteApi>({ open: () => {}, register: () => {}, unregister: () => {} });
export const usePalette = () => useContext(Ctx);

/** Contribute actions to the palette while a component is mounted. */
export function usePaletteActions(scope: string, actions: PaletteAction[]) {
  const { register, unregister } = usePalette();
  useEffect(() => {
    register(scope, actions);
  });
  useEffect(() => () => unregister(scope), [scope, unregister]);
}

/** Subsequence fuzzy match; lower score is better, -1 means no match. */
function score(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const direct = t.indexOf(q);
  if (direct !== -1) return direct === 0 ? 0 : 1 + direct / 100;
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return -1;
    gaps += found - ti;
    ti = found + 1;
  }
  return 10 + gaps;
}

export function PaletteProvider({ children }: { children: ReactNode }) {
  const [scopes, setScopes] = useState<Record<string, PaletteAction[]>>({});
  const [open, setOpen] = useState(false);

  const api = useMemo<PaletteApi>(
    () => ({
      open: () => setOpen(true),
      register: (scope, actions) =>
        setScopes((s) => {
          const prev = s[scope];
          if (prev && prev.length === actions.length && prev.every((a, i) => a.id === actions[i]!.id && a.label === actions[i]!.label)) {
            // Same actions: just refresh closures without a re-render cascade.
            s[scope] = actions;
            return s;
          }
          return { ...s, [scope]: actions };
        }),
      unregister: (scope) =>
        setScopes((s) => {
          if (!(scope in s)) return s;
          const n = { ...s };
          delete n[scope];
          return n;
        }),
    }),
    []
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const all = Object.values(scopes).flat();

  return (
    <Ctx.Provider value={api}>
      {children}
      {open && <Palette actions={all} onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  );
}

function Palette({ actions, onClose }: { actions: PaletteAction[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    return actions
      .map((a) => ({ a, s: score(q, `${a.label} ${a.group} ${a.keywords ?? ""}`) }))
      .filter((r) => r.s >= 0)
      .sort((x, y) => x.s - y.s)
      .map((r) => r.a);
  }, [actions, q]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (a?: PaletteAction) => {
    if (!a) return;
    onClose();
    // Let the palette unmount before the action opens its own dialog/focus.
    setTimeout(a.run, 0);
  };

  let lastGroup = "";
  return (
    <div className="overlay palette-overlay" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" size={17} />
          <input
            autoFocus
            placeholder="Type a command or search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(results.length - 1, s + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(results[sel]);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            aria-activedescendant={results[sel] ? `pal-${results[sel]!.id}` : undefined}
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {results.length === 0 && <div className="palette-empty">No matching command.</div>}
          {results.map((a, i) => {
            const header = a.group !== lastGroup && !q ? a.group : null;
            lastGroup = a.group;
            return (
              <div key={a.id}>
                {header && <div className="palette-group">{header}</div>}
                <div
                  id={`pal-${a.id}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === sel}
                  className={`palette-item${i === sel ? " sel" : ""}`}
                  onMouseMove={() => setSel(i)}
                  onClick={() => run(a)}
                >
                  <span className="palette-icon">{a.icon && <Icon name={a.icon} size={15} />}</span>
                  <span className="palette-label">{a.label}</span>
                  {a.hint && <span className="palette-hint">{a.hint}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>↵</Kbd> run
          </span>
          <span>
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd> toggle
          </span>
        </div>
      </div>
    </div>
  );
}

/** Global single-key shortcuts, ignored while typing. */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e)) return;
      if (document.querySelector(".overlay")) return;
      const key = e.shiftKey && e.key.length === 1 ? `shift+${e.key.toLowerCase()}` : e.key;
      const fn = ref.current[key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
