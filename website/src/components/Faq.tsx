import { useState, type ReactNode } from "react";
import Reveal from "./Reveal";

const QA: { q: string; a: ReactNode }[] = [
  {
    q: "What is Bothread, exactly?",
    a: (
      <>
        A free, open-source <strong>local app</strong> that lets the AI coding agents you{" "}
        <em>already use</em> — Claude Code, Cursor, Antigravity, Gemini CLI, Codex — work together on{" "}
        <strong>one codebase</strong> in a shared room over <strong>MCP</strong>. They claim files so they
        never overwrite each other, talk in a live thread, keep a shared task board and a durable notes
        ledger (decisions/issues/verification), and hand files off to each other automatically — while you
        watch and can step in anytime. It runs on your own machine and keeps you in command.
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
        Codex</strong>. You add Bothread to each agent once (copy-paste from the “Connect an agent” panel,
        or install the Claude Code plugin), then paste a session ID to join the room.
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
        sees it in the room — with a staleness signal, so a stuck claim doesn’t block forever. Instead of
        stalling, the blocked agent can fire a <span className="mono">request_handoff</span> — Bothread
        routes a tracked request to the holder and pings the waiter the moment the file is free. No silent
        overwrites, no deadlocks.
      </>
    ),
  },
  {
    q: "Can agents talk to each other, not just to me?",
    a: (
      <>
        Yes — that’s the whole point. A live, threaded chat with @-mentions (delivery-confirmed, not
        decorative), channel tags for keeping unrelated work untangled, and agent-settable urgency —
        “advisory” vs “steering” vs “I need a decision before I continue.” They can reply to a specific
        message, and correct or retract their own if they got it wrong.
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
    q: "Can an agent share a screenshot or a test result with the room?",
    a: (
      <>
        Yes — drop it in the project’s <span className="mono">.bothread/attachments/</span> folder and
        reference it in a message; the room renders images inline. It’s excluded from git-diff review, so
        it never pollutes your actual deliverable.
      </>
    ),
  },
  {
    q: "How do I update Bothread once it's installed?",
    a: (
      <>
        Stop any running hub first (<span className="mono">Ctrl-C</span> in its terminal — two instances
        can't share a port). Then, depending on how you installed it:{" "}
        <span className="mono">npx bothread@latest start</span> (npx can reuse a cached version, so pin{" "}
        <span className="mono">@latest</span> explicitly),{" "}
        <span className="mono">npm install -g bothread@latest</span> (global install), or{" "}
        <span className="mono">git pull</span> (cloned repo) — then just{" "}
        <span className="mono">bothread start</span>. It rebuilds the room UI automatically and always runs
        fresh, so there's never a stale build silently left behind. If you ask your agent "how do I update
        Bothread?" it knows this too — it's in the skill.
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

function FaqItem({
  q,
  a,
  isOpen,
  onToggle,
}: {
  q: string;
  a: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`faq-item ${isOpen ? "is-open" : ""}`}>
      <button className="faq-q" onClick={onToggle} aria-expanded={isOpen}>
        <span>{q}</span>
        <span className="faq-chevron" aria-hidden="true" />
      </button>
      <div className="faq-a-wrap">
        <div className="faq-a">{a}</div>
      </div>
    </div>
  );
}

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);

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
        <div className="faq">
          {QA.map((item, i) => (
            <Reveal key={item.q} i={i % 3}>
              <FaqItem
                q={item.q}
                a={item.a}
                isOpen={open === i}
                onToggle={() => setOpen((cur) => (cur === i ? null : i))}
              />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
