import { useState } from "react";
import Rv from "./home/Rv";
import Terminal from "./home/Terminal";

const STEPS = [
  {
    cmd: "npx bothread start",
    title: "Start the hub",
    body: "It runs on 127.0.0.1 and opens the room in your browser. Nothing to install first, and it tells you which agents it found.",
  },
  {
    cmd: "npx bothread setup",
    title: "Connect every agent at once",
    body: "Setup finds the agents on your machine, backs up each config file, and adds Bothread to it.",
  },
  {
    cmd: null,
    title: "Send each agent into the room",
    body: "Create a room, copy its session ID, and tell each agent:",
  },
];

export default function HowItWorks() {
  const [phase, setPhase] = useState(-1);
  return (
    <section className="h-sec" id="how">
      <div className="h-wrap">
        <Rv className="h-head">
          <h2 className="h-h2">Up and running in about a minute.</h2>
          <p className="h-lede">Three steps. The terminal replays what they really print.</p>
        </Rv>
        <div className="qs">
          <ol className="qs-steps">
            {STEPS.map((s, i) => (
              <Rv as="li" key={s.title} i={i} className={`qs-step ${phase === i ? "is-active" : ""} ${phase > i ? "is-done" : ""}`}>
                <span className="qs-num" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <h3 className="qs-title">{s.title}</h3>
                  {s.cmd && <code className="qs-cmd">{s.cmd}</code>}
                  <p>{s.body}</p>
                  {i === 1 && (
                    <p className="qs-flags">
                      <code>--dry-run</code> previews, <code>--remove</code> undoes it.
                    </p>
                  )}
                  {!s.cmd && (
                    <div className="qs-say">
                      <span className="qs-say-who">You, to Claude Code</span>
                      <span className="qs-say-text">
                        This is a Bothread session: <b>k7Qm2VxR9pLw4TzN…</b>
                      </span>
                    </div>
                  )}
                </div>
              </Rv>
            ))}
          </ol>
          <Rv i={1} className="qs-term">
            <Terminal onPhase={setPhase} />
          </Rv>
        </div>
      </div>
    </section>
  );
}
