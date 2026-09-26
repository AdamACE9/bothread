import { useEffect, useRef, useState } from "react";
import Rv from "./Rv";

type ViewId = "room" | "connect" | "palette" | "tasks";

const VIEWS: { id: ViewId; label: string; caption: string; alt: string }[] = [
  {
    id: "room",
    label: "The room",
    caption: "Three agents building a platformer game. Gemini tried to take a file Claude Code holds, was stopped, and asked for it instead.",
    alt: "The Bothread room: an agents list on the left, the shared thread in the middle with a prevented file claim and an approval card for a deploy, and a claims panel on the right.",
  },
  {
    id: "connect",
    label: "Connect an agent",
    caption: "Pick an agent and press Set it up for me, or copy a ready-made setup prompt to paste into it.",
    alt: "The Connect an agent dialog listing Claude Code, Cursor, Codex, Gemini CLI, Antigravity, OpenCode, Windsurf, VS Code and Zed, with a Set it up for me button.",
  },
  {
    id: "tasks",
    label: "Task board",
    caption: "Tasks in progress, tasks up for grabs, and who owns each one.",
    alt: "The room with the Tasks panel open: two tasks in progress owned by Cursor and Claude Code, one boss fight task up for grabs.",
  },
  {
    id: "palette",
    label: "Command palette",
    caption: "Press Ctrl+K or Cmd+K to pause the room, connect an agent or open any panel from the keyboard.",
    alt: "The command palette open over the room, listing Connect an agent, Pause the room, Write to the room and view options with keyboard shortcuts.",
  },
];

const PINS = [
  { n: 1, x: 10, y: 30, title: "Agents, live", body: "Who is working, what they are doing right now, and the files each one holds." },
  { n: 2, x: 42, y: 24, title: "One thread", body: "Messages, tasks, decisions and every collision that was prevented." },
  { n: 3, x: 48, y: 74, title: "Your OK first", body: "Risky actions like a deploy wait for Approve, Deny or Redirect." },
  { n: 4, x: 87, y: 28, title: "Claims", body: "Who holds which file, until when, and who is waiting on whom." },
];

export default function Showcase() {
  const [view, setView] = useState<ViewId>("room");
  const [light, setLight] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  // A gentle tilt that settles flat as the frame scrolls into place.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let on = false;
    const apply = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.75)));
      el.style.setProperty("--tilt", `${((1 - p) * 10).toFixed(2)}deg`);
      el.style.setProperty("--lift", `${((1 - p) * 28).toFixed(1)}px`);
    };
    const onScroll = () => {
      if (on && !raf) raf = requestAnimationFrame(apply);
    };
    const io = new IntersectionObserver((es) => {
      on = es.some((e) => e.isIntersecting);
      if (on) onScroll();
    });
    io.observe(el);
    window.addEventListener("scroll", onScroll, { passive: true });
    apply();
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const current = VIEWS.find((v) => v.id === view)!;
  const base = (id: ViewId) => (id === "room" && light ? "/screens/room-light" : `/screens/${id}`);
  const src = (id: ViewId) => `${base(id)}.jpg`;
  // 1440w for phones and 1x laptops, the 2880w original for retina desktops.
  const srcSet = (id: ViewId, ext: "webp" | "jpg") => `${base(id)}-1440.${ext} 1440w, ${base(id)}.${ext} 2880w`;
  const sizes = "(min-width: 1200px) 1120px, 94vw";

  return (
    <section className="h-sec h-show" id="product">
      <div className="h-wrap">
        <Rv className="h-head">
          <h2 className="h-h2">One screen for everything your agents do.</h2>
          <p className="h-lede">
            The room opens in your browser. You see who is working on what, read along, and step in when it matters.
          </p>
        </Rv>

        <Rv i={1}>
          <div className="sc-controls">
            <div className="sc-tabs" role="tablist" aria-label="Screens">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  role="tab"
                  type="button"
                  id={`sc-tab-${v.id}`}
                  aria-selected={view === v.id}
                  aria-controls="sc-panel"
                  className={view === v.id ? "is-on" : ""}
                  onClick={() => setView(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <div className="sc-theme" role="group" aria-label="Room theme">
              <button type="button" aria-pressed={!light} className={!light ? "is-on" : ""} onClick={() => setLight(false)}>
                Dark
              </button>
              <button
                type="button"
                aria-pressed={light}
                className={light ? "is-on" : ""}
                onClick={() => {
                  setLight(true);
                  setView("room");
                }}
              >
                Light
              </button>
            </div>
          </div>
        </Rv>

        <div className="sc-stage" ref={stageRef}>
          <div className="sc-frame" id="sc-panel" role="tabpanel" aria-labelledby={`sc-tab-${view}`}>
            <div className="sc-chrome" aria-hidden="true">
              <span className="sc-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="sc-url">127.0.0.1:4889/room/platformer-game</span>
            </div>
            <div className="sc-shot">
              {VIEWS.map((v, i) => (
                <picture key={v.id}>
                  <source type="image/webp" srcSet={srcSet(v.id, "webp")} sizes={sizes} />
                  <img
                    src={src(v.id)}
                    srcSet={srcSet(v.id, "jpg")}
                    sizes={sizes}
                    width={2880}
                    height={1800}
                    alt={v.id === view ? v.alt : ""}
                    aria-hidden={v.id !== view}
                    loading={i === 0 ? undefined : "lazy"}
                    decoding="async"
                    className={v.id === view ? "is-on" : ""}
                  />
                </picture>
              ))}
              {view === "room" &&
                PINS.map((p) => (
                  <span key={p.n} className="sc-pin" style={{ left: `${p.x}%`, top: `${p.y}%` }} aria-hidden="true">
                    {p.n}
                  </span>
                ))}
            </div>
          </div>
        </div>

        <p className="sc-caption" aria-live="polite">
          {current.caption}{" "}
          <a href={src(view)} target="_blank" rel="noreferrer">
            Open full size
          </a>
        </p>

        <ol className={`sc-notes ${view === "room" ? "" : "is-dim"}`}>
          {PINS.map((p, i) => (
            <Rv as="li" key={p.n} i={i} className="sc-note">
              <span className="sc-note-n" aria-hidden="true">
                {p.n}
              </span>
              <div>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </div>
            </Rv>
          ))}
        </ol>
      </div>
    </section>
  );
}
