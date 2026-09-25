import { useEffect, useRef, useState, type ReactNode } from "react";

/* Real output of `npx bothread start` and `npx bothread setup --dry-run`,
 * colored the way the CLI colors it. Replayed line by line when scrolled into view. */

type Seg = [string, string?];
type Item =
  | { kind: "cmd"; text: string; phase: number }
  | { kind: "line"; segs: Seg[]; phase: number }
  | { kind: "banner"; phase: number };

const L = (phase: number, ...segs: Seg[]): Item => ({ kind: "line", segs, phase });
const B = (phase: number): Item => L(phase, [""]);

const SCRIPT: Item[] = [
  { kind: "cmd", text: "npx bothread start", phase: 0 },
  B(0),
  L(0, ["┌───────────────────────┐", "t-copper"]),
  L(0, ["│ ", "t-copper"], ["★", "t-saffron"], [" "], ["Welcome to Bothread", "t-bold"], [" │", "t-copper"]),
  L(0, ["└───────────────────────┘", "t-copper"]),
  B(0),
  { kind: "banner", phase: 0 },
  B(0),
  L(0, ["  A local, human-governed room where your AI agents work together."]),
  B(0),
  L(0, ["  ╭──────────────────────────────────────╮", "t-dim"]),
  L(0, ["  │  ", "t-dim"], ["✦ Bothread", "t-copper t-bold"], [" v0.3.0", "t-copper"], ["  ready in ", "t-dim"], ["638", "t-bold"], [" ms", "t-dim"], ["  │", "t-dim"]),
  L(0, ["  ╰──────────────────────────────────────╯", "t-dim"]),
  B(0),
  L(0, ["  "], ["➜", "t-green"], ["  Room:  "], ["http://127.0.0.1:4889/", "t-cyan"]),
  L(0, ["  "], ["➜", "t-green"], ["  MCP:   "], ["http://127.0.0.1:4889/mcp", "t-cyan"]),
  B(0),
  L(0, ["  Agents", "t-bold"]),
  L(0, ["    "], ["!", "t-yellow"], [" Claude Code  "], ["found, not connected", "t-dim"]),
  B(0),
  L(0, ["  Next", "t-bold"]),
  L(0, ["    1. Run "], ["npx bothread setup", "t-cyan"], [" in a new terminal (or press s)"]),
  L(0, ["    2. Open the room (press o) and create a room"]),
  L(0, ["    3. In each agent, say: This is a Bothread session: <id>"]),
  B(0),
  L(0, ["  press ", "t-dim"], ["o", "t-cyan"], [" to open the room · ", "t-dim"], ["s", "t-cyan"], [" to set up agents · ", "t-dim"], ["c", "t-cyan"], [" to copy the MCP URL · ", "t-dim"], ["q", "t-cyan"], [" to quit", "t-dim"]),
  B(1),
  { kind: "cmd", text: "npx bothread setup --dry-run", phase: 1 },
  B(1),
  L(1, ["┌  ", "t-dim"], ["Connect your AI agents to Bothread", "t-bold"], ["  (dry run — nothing is written)", "t-dim"]),
  L(1, ["│", "t-dim"]),
  L(1, ["◇", "t-green"], ["  Found 1 AI coding agent on this computer"]),
  L(1, ["│  ", "t-dim"], ["●", "t-cyan"], [" Claude Code           "], ["~/.claude.json", "t-dim"]),
  ...["Claude (desktop app)", "Antigravity", "Cursor", "Gemini CLI", "Codex", "OpenCode", "Windsurf", "VS Code", "Zed"].map((n) =>
    L(1, ["│  ", "t-dim"], [`· ${n.padEnd(21)} not found`, "t-dim"])
  ),
  L(1, ["│", "t-dim"]),
  L(1, ["◇", "t-green"], ["  Claude Code "], ["— would change", "t-dim"], [" → ~/.claude.json"]),
  L(1, ["│  ", "t-dim"], ["Would run: claude mcp add --transport http --scope user bothread http://127.0.0.1:4889/mcp", "t-dim"]),
  L(1, ["│", "t-dim"]),
  L(1, ["└  ", "t-dim"], ["Dry run — nothing was written."]),
];

/* The CLI's block wordmark and its copper → saffron → teal gradient. */
const FONT: Record<string, string[]> = {
  B: ["####.", "#..#.", "####.", "#..#.", "####."],
  O: [".###.", "#...#", "#...#", "#...#", ".###."],
  T: ["#####", "..#..", "..#..", "..#..", "..#.."],
  H: ["#...#", "#...#", "#####", "#...#", "#...#"],
  R: ["####.", "#...#", "####.", "#..#.", "#...#"],
  E: ["#####", "#....", "####.", "#....", "#####"],
  A: [".###.", "#...#", "#####", "#...#", "#...#"],
  D: ["####.", "#...#", "#...#", "#...#", "####."],
};
const STOPS = [
  [0xcf, 0x7a, 0x3c],
  [0xe2, 0xa9, 0x4c],
  [0x63, 0xad, 0x8f],
];
function colorAt(t: number) {
  const seg = t * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(seg));
  const k = seg - i;
  const [a, b] = [STOPS[i], STOPS[i + 1]];
  return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * k)).join(",")})`;
}
function Banner() {
  const letters = "BOTHREAD".split("");
  return (
    <span className="t-banner">
      {[0, 1, 2, 3, 4].map((row) => (
        <span key={row} className="t-row">
          {letters.map((ch, i) => (
            <span key={i} style={{ color: colorAt(i / (letters.length - 1)) }}>
              {FONT[ch][row].replace(/#/g, "█").replace(/\./g, " ") + (i < letters.length - 1 ? " " : "")}
            </span>
          ))}
        </span>
      ))}
      <span className="t-row t-bar">{"─".repeat(47)}</span>
    </span>
  );
}

function Prompt({ children, cursor }: { children: ReactNode; cursor?: boolean }) {
  return (
    <span className="t-line">
      <span className="t-dim">~/my-app</span> <span className="t-copper">$</span> <span className="t-bold">{children}</span>
      {cursor && <span className="t-cursor" aria-hidden="true" />}
    </span>
  );
}

export default function Terminal({ onPhase }: { onPhase?: (phase: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [shown, setShown] = useState(0); // items fully shown
  const [typed, setTyped] = useState(0); // chars typed into the current command
  const [run, setRun] = useState(0);
  const done = shown >= SCRIPT.length;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(SCRIPT.length);
      onPhase?.(2);
      return;
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setStarted(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!started) return;
    let i = 0;
    let c = 0;
    let t: number;
    setShown(0);
    setTyped(0);
    const step = () => {
      if (i >= SCRIPT.length) {
        onPhase?.(2);
        return;
      }
      const item = SCRIPT[i];
      onPhase?.(item.phase);
      if (item.kind === "cmd") {
        if (c < item.text.length) {
          c++;
          setTyped(c);
          t = window.setTimeout(step, c === 1 ? 500 : 38 + Math.random() * 40);
          return;
        }
        c = 0;
        i++;
        setShown(i);
        setTyped(0);
        t = window.setTimeout(step, 420);
        return;
      }
      i++;
      setShown(i);
      const blank = item.kind === "line" && item.segs.length === 1 && item.segs[0][0] === "";
      t = window.setTimeout(step, item.kind === "banner" ? 160 : blank ? 30 : 70);
    };
    t = window.setTimeout(step, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, run]);

  // Keep the newest line in view while it plays, without moving the page.
  useEffect(() => {
    const b = bodyRef.current;
    if (b && !done) b.scrollTop = b.scrollHeight;
  }, [shown, typed, done]);

  const current = SCRIPT[shown];
  return (
    <div className="term" ref={ref}>
      <div className="term-bar">
        <span className="term-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="term-title">Terminal</span>
        <button
          type="button"
          className="term-replay"
          onClick={() => {
            setStarted(true);
            setRun((r) => r + 1);
          }}
          disabled={!done}
        >
          Replay
        </button>
      </div>
      <div className="term-body" ref={bodyRef} role="img" aria-label="Terminal output of npx bothread start, then npx bothread setup finding Claude Code and showing the change it would make.">
        <pre aria-hidden="true">
          {SCRIPT.slice(0, shown).map((item, i) =>
            item.kind === "cmd" ? (
              <Prompt key={i}>{item.text}</Prompt>
            ) : item.kind === "banner" ? (
              <Banner key={i} />
            ) : (
              <span key={i} className="t-line">
                {item.segs.map(([text, cls], j) => (
                  <span key={j} className={cls}>
                    {text}
                  </span>
                ))}
              </span>
            )
          )}
          {current?.kind === "cmd" ? (
            <Prompt cursor>{current.text.slice(0, typed)}</Prompt>
          ) : done ? (
            <Prompt cursor>{""}</Prompt>
          ) : null}
        </pre>
      </div>
    </div>
  );
}
