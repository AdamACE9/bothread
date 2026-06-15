import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * A live, self-playing preview of a Bothread room.
 * It streams a real session — agents claim files, a collision is prevented,
 * and a human-approval prompt appears that YOU can answer (the demo branches
 * on your choice). Pause/resume any time. Falls back to a static transcript
 * under prefers-reduced-motion.
 */

type Who = "claude" | "cursor" | "gemini";

const AGENTS: Record<Who, { name: string; mono: string }> = {
  claude: { name: "Claude Code", mono: "CC" },
  cursor: { name: "Cursor", mono: "Cu" },
  gemini: { name: "Gemini", mono: "Ge" },
};
const ROSTER: Who[] = ["claude", "cursor", "gemini"];

type Branch = "approve" | "deny";

interface Entry {
  kind:
    | "open"
    | "typing"
    | "msg"
    | "claim"
    | "release"
    | "prevented"
    | "approval"
    | "ok"
    | "no";
  who?: Who;
  text?: ReactNode;
  path?: string;
  holder?: Who;
  cmd?: string;
  t: string;
  dwell?: number;
  branch?: Branch;
}

const code = (s: string) => <code>{s}</code>;

const SCRIPT: Entry[] = [
  { kind: "open", t: "09:41", dwell: 1100 },
  { kind: "typing", who: "claude", t: "09:41", dwell: 850 },
  {
    kind: "msg",
    who: "claude",
    t: "09:41",
    dwell: 2100,
    text: <>Taking the Stripe webhook handler. Claiming {code("src/payments/*")}.</>,
  },
  { kind: "claim", who: "claude", path: "src/payments/*", t: "09:41", dwell: 950 },
  { kind: "typing", who: "cursor", t: "09:42", dwell: 800 },
  {
    kind: "msg",
    who: "cursor",
    t: "09:42",
    dwell: 1700,
    text: <>On the checkout UI in parallel — claiming {code("src/checkout/*")}.</>,
  },
  { kind: "claim", who: "cursor", path: "src/checkout/*", t: "09:42", dwell: 1100 },
  {
    kind: "prevented",
    who: "cursor",
    path: "src/payments/webhook.ts",
    holder: "claude",
    t: "09:42",
    dwell: 2600,
  },
  { kind: "typing", who: "cursor", t: "09:42", dwell: 700 },
  {
    kind: "msg",
    who: "cursor",
    t: "09:42",
    dwell: 1700,
    text: <>Got it — staying out of payments.</>,
  },
  { kind: "typing", who: "gemini", t: "09:43", dwell: 800 },
  {
    kind: "msg",
    who: "gemini",
    t: "09:43",
    dwell: 1800,
    text: <>I'll write tests the moment the handler lands.</>,
  },
  { kind: "typing", who: "claude", t: "09:43", dwell: 850 },
  {
    kind: "msg",
    who: "claude",
    t: "09:43",
    dwell: 1500,
    text: <>Handler done — releasing the lock.</>,
  },
  { kind: "release", who: "claude", path: "src/payments/*", t: "09:43", dwell: 1000 },
  { kind: "approval", who: "claude", cmd: "npm run deploy:staging", t: "09:44" },
  {
    kind: "ok",
    t: "09:44",
    dwell: 1300,
    branch: "approve",
    text: <>You approved {code("deploy:staging")}</>,
  },
  { kind: "typing", who: "gemini", t: "09:44", dwell: 800, branch: "approve" },
  {
    kind: "msg",
    who: "gemini",
    t: "09:44",
    dwell: 2800,
    branch: "approve",
    text: <>Tests green. Deploying to staging now.</>,
  },
  {
    kind: "no",
    t: "09:44",
    dwell: 1300,
    branch: "deny",
    text: <>You held {code("deploy:staging")}</>,
  },
  { kind: "typing", who: "claude", t: "09:44", dwell: 800, branch: "deny" },
  {
    kind: "msg",
    who: "claude",
    t: "09:44",
    dwell: 2800,
    branch: "deny",
    text: <>Understood — holding the deploy. Back to you.</>,
  },
];

const prefersReduced =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const pad = (n: number) => String(n).padStart(2, "0");

function Avatar({ who, small }: { who: Who; small?: boolean }) {
  return (
    <span className={`av ${who}${small ? " small" : ""}`} aria-hidden="true">
      {AGENTS[who].mono}
    </span>
  );
}

const LockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

export default function RoomMock() {
  const [step, setStep] = useState(prefersReduced ? SCRIPT.length : 0);
  const [choice, setChoice] = useState<Branch | null>(prefersReduced ? "approve" : null);
  const [playing, setPlaying] = useState(!prefersReduced);
  const [hover, setHover] = useState<Who | null>(null);
  const [elapsed, setElapsed] = useState(11);

  const choiceRef = useRef(choice);
  choiceRef.current = choice;

  const nextFrom = useCallback((from: number, c: Branch | null) => {
    let i = from;
    while (i < SCRIPT.length) {
      const e = SCRIPT[i];
      if (e.branch && e.branch !== c) {
        i++;
        continue;
      }
      return i;
    }
    return SCRIPT.length;
  }, []);

  const resolve = useCallback(
    (c: Branch) => {
      setChoice(c);
      setStep((s) => nextFrom(s + 1, c));
    },
    [nextFrom]
  );

  // Timeline driver — advances after each entry's dwell; approval blocks for you.
  useEffect(() => {
    if (!playing || prefersReduced) return;
    if (step >= SCRIPT.length) {
      const r = setTimeout(() => {
        setChoice(null);
        setElapsed(11);
        setStep(0);
      }, 2800);
      return () => clearTimeout(r);
    }
    const cur = SCRIPT[step];
    if (cur.kind === "approval") {
      if (choice) return;
      const fallback = setTimeout(() => resolve("approve"), 7000);
      return () => clearTimeout(fallback);
    }
    const t = setTimeout(
      () => setStep((s) => nextFrom(s + 1, choiceRef.current)),
      cur.dwell ?? 1500
    );
    return () => clearTimeout(t);
  }, [step, playing, choice, nextFrom, resolve]);

  // Live session clock.
  useEffect(() => {
    if (!playing || prefersReduced) return;
    const iv = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(iv);
  }, [playing]);

  const c = prefersReduced ? "approve" : choice;
  const upTo = prefersReduced ? SCRIPT.length - 1 : step;

  const played = useMemo(() => {
    const out: { e: Entry; i: number }[] = [];
    for (let i = 0; i <= upTo && i < SCRIPT.length; i++) {
      const e = SCRIPT[i];
      if (e.branch && e.branch !== c) continue;
      if (e.kind === "typing" || e.kind === "approval") continue;
      out.push({ e, i });
    }
    return out;
  }, [upTo, c]);

  const leases = useMemo(() => {
    const map = new Map<string, Who>();
    for (let i = 0; i <= upTo && i < SCRIPT.length; i++) {
      const e = SCRIPT[i];
      if (e.branch && e.branch !== c) continue;
      if (e.kind === "claim" && e.path && e.who) map.set(e.path, e.who);
      if (e.kind === "release" && e.path) map.delete(e.path);
    }
    return [...map.entries()].map(([path, who]) => ({ path, who }));
  }, [upTo, c]);

  const cur = !prefersReduced && step < SCRIPT.length ? SCRIPT[step] : undefined;
  const typingWho = cur?.kind === "typing" ? cur.who ?? null : null;
  const showApproval = cur?.kind === "approval" && !choice;
  const mins = Math.floor((11 + (prefersReduced ? 26 : elapsed - 11)) / 60);
  const secs = (11 + (prefersReduced ? 26 : elapsed - 11)) % 60;

  function renderEntry(e: Entry, i: number) {
    switch (e.kind) {
      case "open":
        return (
          <div className="row open" key={i}>
            <span className="open-dot" /> Room opened · you're watching
          </div>
        );
      case "msg":
        return (
          <div
            className={`row msg${hover && e.who !== hover ? " dim" : ""}`}
            key={i}
          >
            <Avatar who={e.who!} small />
            <div className="msg-main">
              <div className="meta">
                <span className={`name ${e.who}`}>{AGENTS[e.who!].name}</span>
                <span className="time">{e.t}</span>
              </div>
              <div className="bubble">{e.text}</div>
            </div>
          </div>
        );
      case "claim":
        return (
          <div className={`row note${hover && e.who !== hover ? " dim" : ""}`} key={i}>
            <LockIcon />
            <span>
              <b className={e.who}>{AGENTS[e.who!].name}</b> claimed <code>{e.path}</code>
            </span>
          </div>
        );
      case "release":
        return (
          <div className={`row note${hover && e.who !== hover ? " dim" : ""}`} key={i}>
            <span className="unlock" aria-hidden="true">⊘</span>
            <span>
              <b className={e.who}>{AGENTS[e.who!].name}</b> released <code>{e.path}</code>
            </span>
          </div>
        );
      case "prevented":
        return (
          <div className="row prevented" key={i}>
            <LockIcon />
            <span>
              <b>Prevented.</b> {AGENTS[e.who!].name} tried to edit <code>{e.path}</code> —
              held by {AGENTS[e.holder!].name}.
            </span>
          </div>
        );
      case "ok":
        return (
          <div className="row ok" key={i}>
            <span aria-hidden="true">✓</span>
            <span>{e.text}</span>
          </div>
        );
      case "no":
        return (
          <div className="row no" key={i}>
            <span aria-hidden="true">⊘</span>
            <span>{e.text}</span>
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <div
      className="room"
      role="group"
      aria-label="Live preview of a Bothread room: agents collaborate, a file collision is prevented, and you approve a deploy."
    >
      <div className="room-head">
        <span className={`live${playing ? "" : " paused"}`}>
          <span className="live-dot" />
          {playing ? "live" : "paused"}
        </span>
        <span className="room-id">payments-refactor</span>
        <span className="clock" aria-hidden="true">
          {mins}:{pad(secs)}
        </span>
        <div className="avatars" role="group" aria-label="Agents in the room">
          {ROSTER.map((w) => (
            <button
              type="button"
              key={w}
              className={`av-btn${typingWho === w ? " active" : ""}`}
              onMouseEnter={() => setHover(w)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(w)}
              onBlur={() => setHover(null)}
              aria-label={AGENTS[w].name}
            >
              <Avatar who={w} />
            </button>
          ))}
        </div>
      </div>

      {leases.length > 0 && (
        <div className="leasestrip">
          <span className="leasestrip-label">
            <LockIcon /> locks
          </span>
          {leases.map((l) => (
            <span className={`lease ${l.who}`} key={l.path}>
              <span className="lease-dot" />
              <code>{l.path}</code>
            </span>
          ))}
        </div>
      )}

      <div className={`room-body${prefersReduced ? " static" : ""}`}>
        {played.map(({ e, i }) => renderEntry(e, i))}

        {typingWho && (
          <div className="row msg typing-row" aria-hidden="true">
            <Avatar who={typingWho} small />
            <div className="typing">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          </div>
        )}

        {showApproval && cur && (
          <div className="approval" role="group" aria-label="Approval required">
            <div className="approval-head">
              <LockIcon /> Your approval needed
            </div>
            <p className="approval-body">
              <span className={`name ${cur.who}`}>{AGENTS[cur.who!].name}</span> wants to run{" "}
              <code>{cur.cmd}</code>
            </p>
            <div className="approval-actions">
              <button type="button" className="ap-deny" onClick={() => resolve("deny")}>
                Deny
              </button>
              <button type="button" className="ap-ok" onClick={() => resolve("approve")}>
                Approve
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="room-foot">
        <button
          type="button"
          className="play"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause preview" : "Play preview"}
          aria-pressed={!playing}
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M7 5l12 7-12 7V5z" />
            </svg>
          )}
          {playing ? "Pause" : "Play"}
        </button>
        <span className="foot-note">
          {leases.length} {leases.length === 1 ? "lock" : "locks"} · you're in command
        </span>
        <span className="foot-controls" aria-hidden="true">
          pause · approve · revoke
        </span>
      </div>
    </div>
  );
}
