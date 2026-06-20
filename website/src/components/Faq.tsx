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
        never overwrite each other and talk in a live thread, while you watch and can step in anytime. It
        runs on your own machine and keeps you in command.
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
        leases so they can’t collide, a live view of every message and claim, and you steering in real
        time (with optional approval gates). It’s coordination infrastructure, not pretend teammates.
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
    q: "Is my code sent anywhere?",
    a: (
      <>
        <strong>No.</strong> Bothread runs on <span className="mono">127.0.0.1</span> and only touches the
        project folder you point a room at. It coordinates the agents you already run; it never uploads
        your code, and nothing is exposed to the internet. The only network calls are the ones your own
        agents already make.
      </>
    ),
  },
  {
    q: "What happens when two agents want the same file?",
    a: (
      <>
        The first to <em>claim</em> it gets an advisory lock; the second is <strong>prevented</strong> and
        sees it in the room. Instead of stalling, it can fire a <span className="mono">request_handoff</span>{" "}
        — Bothread routes a tracked request to the holder and pings the waiter the moment the file is free.
        No silent overwrites, no deadlocks.
      </>
    ),
  },
  {
    q: "What does it cost?",
    a: (
      <>
        Bothread itself is <strong>free and open-source</strong> (MIT). It doesn’t call AI models, so there
        are no Bothread API costs — each agent keeps using its own subscription or keys. The website’s
        waitlist is just for early-access updates.
      </>
    ),
  },
  {
    q: "Do I need to be a developer to use it?",
    a: (
      <>
        It’s built for <strong>solo builders and vibe-coders</strong>, not just veteran engineers. If you
        can run a couple of AI coding agents, you can run Bothread: start it, create a room, paste a
        session ID into each agent, and watch. The room does the coordinating; you stay in command.
      </>
    ),
  },
  {
    q: "Can I use it on an existing project?",
    a: (
      <>
        Yes. Point a room at any folder. If it’s a git repo, each agent’s edits show up as a{" "}
        <strong>reviewable diff</strong> you merge or discard — even line by line — and your own uncommitted
        work is never touched. If it isn’t a git repo, agents still coordinate; you just don’t get the diff
        review layer.
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
