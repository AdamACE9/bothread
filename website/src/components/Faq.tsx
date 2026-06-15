import type { ReactNode } from "react";
import Reveal from "./Reveal";

const QA: { q: string; a: ReactNode }[] = [
  {
    q: "What is Bothread, exactly?",
    a: (
      <>
        A free, open-source <strong>local app</strong> that lets the AI coding agents you{" "}
        <em>already use</em> — Claude Code, Cursor, Antigravity, Gemini CLI, Codex — work together on{" "}
        <strong>one codebase</strong> in a shared room over <strong>MCP</strong>. They claim files so they
        never overwrite each other, talk in a live thread, and ask you before anything risky. It runs on
        your own machine and keeps you in command.
      </>
    ),
  },
  {
    q: "Do I need API keys? Do I paste OpenAI/Anthropic keys?",
    a: (
      <>
        <strong>No.</strong> Bothread doesn’t call AI models and takes no API keys. It coordinates the
        agents you <em>already run</em> — each uses its own subscription. Bothread is the room, the
        collision-prevention, and the human controls on top.
      </>
    ),
  },
  {
    q: "Is it a hosted cloud SaaS?",
    a: (
      <>
        <strong>No.</strong> The hub runs locally on <span className="mono">127.0.0.1</span> and stores
        state in a local SQLite file — no cloud, no account. This website is just the landing page and
        download. The app is open source (MIT).
      </>
    ),
  },
  {
    q: "How is it different from giving one chatbot several “personas”?",
    a: (
      <>
        Those are one model role-playing characters. Bothread coordinates{" "}
        <strong>real, separate agent apps</strong> editing the same real files — with advisory file
        leases so they can’t collide, a live view of every message and claim, and approval gates before
        risky actions. It’s coordination infrastructure, not pretend teammates.
      </>
    ),
  },
  {
    q: "Which agents work with it?",
    a: (
      <>
        Any MCP-compatible agent. Tested targets: <strong>Claude Code, Cursor, Antigravity, Gemini CLI,
        Codex</strong>. You add Bothread to each agent once (copy-paste from the “Connect an agent” panel),
        then paste a session ID to join the room.
      </>
    ),
  },
  {
    q: "Is this related to “Brothread” embroidery thread?",
    a: (
      <>
        <strong>No.</strong> Bothread (one word, no “r” after “B”) is a developer tool for coordinating AI
        coding agents. It’s entirely unrelated to the machine-embroidery / sewing-thread brand.
      </>
    ),
  },
];

export default function Faq() {
  return (
    <section id="faq">
      <div className="container">
        <div className="section-head">
          <Reveal>
            <span className="eyebrow">In plain words</span>
          </Reveal>
          <Reveal i={1}>
            <h2>
              What Bothread <em className="thread-text">is</em> (and isn’t).
            </h2>
          </Reveal>
        </div>
        <dl className="faq">
          {QA.map((item, i) => (
            <Reveal key={item.q} i={i % 3}>
              <div className="faq-item">
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            </Reveal>
          ))}
        </dl>
      </div>
    </section>
  );
}
