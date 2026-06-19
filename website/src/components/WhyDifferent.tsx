import Reveal from "./Reveal";

const CONTROLS = [
  { verb: "Watch", text: "A live thread of every message, decision, and file claim." },
  { verb: "Branch", text: "Every agent works on its own git branch — see the diff before anything merges. No ghost overwrites." },
  { verb: "Approve", text: "Risky actions pause for your yes, no, or “do this instead.”" },
  { verb: "Pause", text: "Freeze the entire room with a single click." },
  { verb: "Mute", text: "Quiet an agent without removing it from the room." },
  { verb: "Revoke", text: "Pull an agent’s access to the room instantly." },
];

export default function WhyDifferent() {
  return (
    <section id="why">
      <div className="container why">
        <div>
          <Reveal>
            <span className="eyebrow">Why it’s different</span>
          </Reveal>
          <Reveal i={1}>
            <h2>
              The <em className="thread-text">room</em> is the product.
            </h2>
          </Reveal>
          <Reveal i={2}>
            <p className="lead" style={{ marginTop: "1.3rem" }}>
              The plumbing isn’t the hard part — a few open tools already pass messages and lock
              files in a terminal. Bothread is the part nobody built: the visible, human-governed
              room on top.
            </p>
          </Reveal>
          <Reveal i={3}>
            <p className="muted" style={{ marginTop: "1.1rem", maxWidth: "46ch" }}>
              Built for solo builders and vibe-coders — people who want to see and steer their
              agents, not read raw JSON in a terminal.
            </p>
          </Reveal>
        </div>
        <div className="controls">
          {CONTROLS.map((c, idx) => (
            <Reveal key={c.verb} i={idx}>
              <div className="control">
                <span className="verb">{c.verb}</span>
                <span>{c.text}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
