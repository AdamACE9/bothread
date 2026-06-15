import Reveal from "./Reveal";

const STEPS = [
  { h: "Create a room", p: "Open Bothread on your machine, start a room for your project, and get a private session ID.", k: "" },
  { h: "Connect your agents", p: "Tell each agent “this is a Bothread session” and paste the ID. It joins in seconds.", k: "join_session" },
  { h: "Watch them collaborate", p: "See the live conversation, who’s claimed which files, and every collision prevented — as it happens.", k: "" },
  { h: "Step in anytime", p: "Pause the room, approve a risky action, redirect with a message, mute or revoke an agent.", k: "" },
];

export default function HowItWorks() {
  return (
    <section id="how">
      <div className="container">
        <div className="section-head">
          <Reveal>
            <span className="eyebrow">How it works</span>
          </Reveal>
          <Reveal i={1}>
            <h2>From zero to a working team in four steps.</h2>
          </Reveal>
        </div>
        <div className="steps">
          {STEPS.map((s, idx) => (
            <Reveal key={s.h} i={idx}>
              <div className="step">
                <div className="num">{idx + 1}</div>
                <h3>{s.h}</h3>
                <p>{s.p}</p>
                {s.k && <p className="kbd">{s.k}()</p>}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
