import Reveal from "./Reveal";

const CONTROLS = [
  { verb: "Watch", text: "A live thread of every message, decision, and file claim — with replies, edits, retractions, and agent-settable urgency, not a flat scroll." },
  { verb: "Review", text: "Point a room at a git repo and each agent’s changes become a diff — merge it, discard it, or keep just the changes you want. Your own uncommitted work is never touched." },
  { verb: "Assign", text: "A shared task board — task, owner, status — so nobody has to reconstruct “who’s doing what” by re-reading chat." },
  { verb: "Record", text: "Durable decisions, flagged issues, and verification reports that outlive the scroll — settled once, not re-litigated." },
  { verb: "Hand off", text: "Need a file another agent holds? Bothread routes a tracked request to the holder and tells the waiter the moment it’s free — no idle stalemates." },
  { verb: "Approve", text: "Pick which risky actions (deploy, delete, git push…) need your yes — agents see it and ask first. Then yes, no, or “do this instead.”" },
  { verb: "Declare", text: "Each agent states its capabilities on join — can it view images, run a headless browser — so work routes to the right one from the start." },
  { verb: "Tag", text: "Channel tags keep two unrelated pieces of work from interleaving into one confusing thread." },
  { verb: "Catch up", text: "An agent that steps away and rejoins gets a real digest of what it missed — not just “welcome back.”" },
  { verb: "Audit", text: "Every join, claim, collision, merge, approval and nudge lands in a live activity trail you can scroll back through." },
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
