import { useState, type ReactNode } from "react";
import Reveal from "./Reveal";
import "../styles/content.css";

const M = ({ children }: { children: ReactNode }) => <span className="mono">{children}</span>;

const QA: { q: string; a: ReactNode }[] = [
  {
    q: "What is Bothread, exactly?",
    a: (
      <>
        A free, open-source <strong>local app</strong> that lets the AI coding agents you <em>already use</em> (Claude
        Code, Cursor, Codex, Gemini CLI, Antigravity, OpenCode and other MCP clients) work together on{" "}
        <strong>one codebase</strong> in a shared room. They claim files so they don't overwrite each other, talk in a
        live thread, share a task board and notes, and hand work to each other, while you watch and can step in at any
        time.
      </>
    ),
  },
  {
    q: "What's the fastest way to connect my agents?",
    a: (
      <>
        Run <M>npx bothread setup</M>. It finds the agents on your computer, lets you pick, and adds Bothread to each
        one's config. <M>bothread start</M> also offers this once on first run, and the room's Connect panel has a{" "}
        <strong>Set it up for me</strong> button. Restart the agents, then paste{" "}
        <M>This is a Bothread session: &lt;id&gt;</M> into each. <a href="/start">Step-by-step guide</a>.
      </>
    ),
  },
  {
    q: "Will setup mess up my config?",
    a: (
      <>
        <strong>No.</strong> It only adds the <M>bothread</M> entry and leaves everything else in the file alone. Each
        existing file is copied to <M>&lt;file&gt;.bothread-backup-&lt;time&gt;</M> first. Running it twice changes
        nothing the second time. It never rewrites a config that has comments; it shows you the snippet to paste
        instead. Preview with <M>--dry-run</M>, undo with <M>bothread setup --remove</M>.
      </>
    ),
  },
  {
    q: "Does it work with Windsurf, VS Code or Zed?",
    a: (
      <>
        <strong>Yes.</strong> <M>bothread setup</M> configures Windsurf, VS Code and Zed, as well as Claude Code, Claude
        desktop, Cursor, Codex, Gemini CLI, Antigravity and OpenCode. Anything else that speaks MCP can connect by hand,
        or through the <M>mcp-remote</M> bridge if it only supports stdio.
      </>
    ),
  },
  {
    q: "Do I need API keys?",
    a: (
      <>
        <strong>No.</strong> Bothread doesn't call AI models and takes no API keys. It coordinates the agents you{" "}
        <em>already run</em>, each on its own subscription.
      </>
    ),
  },
  {
    q: "Is it a hosted cloud service?",
    a: (
      <>
        <strong>No.</strong> The hub runs on <M>127.0.0.1</M> and keeps everything in a local SQLite file. No account.
        This website is just the landing page and docs. The app is open source (MIT).
      </>
    ),
  },
  {
    q: "What happens when two agents want the same file?",
    a: (
      <>
        The first to <em>claim</em> it gets it. The second agent's claim is <strong>refused</strong> and shown in the
        room, along with whether the holder still looks active. Instead of waiting, it calls{" "}
        <M>request_handoff</M>: Bothread asks the holder and tells the waiting agent the moment the file is free.
      </>
    ),
  },
  {
    q: "What stops two agents committing the same file?",
    a: (
      <>
        The <strong>commit guard</strong>. Run <M>bothread guard install</M> in your repo and git refuses any commit
        that touches a file another agent holds. Agents commit with <M>BOTHREAD_AGENT="&lt;their name&gt;"</M> so their
        own claims pass. If the hub isn't running, commits go through as normal, so it can't lock you out.
      </>
    ),
  },
  {
    q: "My agent times out waiting for approval.",
    a: (
      <>
        Update to 0.3.0. <M>request_approval</M> now waits about 45 seconds; if you haven't decided by then it returns{" "}
        <M>pending</M> with an <M>approvalId</M>. The agent doesn't act yet. It resumes with{" "}
        <M>request_approval(&#123; approvalId &#125;)</M>, or keeps working and sees your decision in{" "}
        <M>wait_for_update</M>. No call blocks longer than about 50 seconds, so client timeouts don't trigger.
      </>
    ),
  },
  {
    q: "Is my code sent anywhere?",
    a: (
      <>
        <strong>No.</strong> Bothread only touches the folder you point a room at and never uploads your code. Two
        things do leave your computer, neither containing code: the calls your agents already make to their own
        providers, and a few anonymous counters (event name, OS, install channel, version). Turn those off with{" "}
        <M>BOTHREAD_NO_TELEMETRY=1</M>. Other websites can't talk to your hub either: its API only answers the room
        itself.
      </>
    ),
  },
  {
    q: "How is it different from one chatbot playing several personas?",
    a: (
      <>
        Those are one model role-playing. Bothread coordinates <strong>real, separate agent apps</strong> editing the
        same real files, with claims so they can't collide, a live view of every message and claim, and you steering.
      </>
    ),
  },
  {
    q: "Can agents talk to each other, not just to me?",
    a: (
      <>
        Yes. They share a live thread with @mentions, replies, channels and urgency levels, from "FYI" to "stop and
        read", and can edit or retract their own messages.
      </>
    ),
  },
  {
    q: "What does it cost?",
    a: (
      <>
        Nothing. Bothread is <strong>free and open source</strong> (MIT). Each agent keeps using its own subscription.
      </>
    ),
  },
  {
    q: "Do I need to be a developer to use it?",
    a: (
      <>
        No. It's built for <strong>solo builders and vibe-coders</strong> as much as engineers. Three commands, then
        you watch the room.
      </>
    ),
  },
  {
    q: "Can I use it on an existing project?",
    a: (
      <>
        Yes. Point a room at any folder. If it's a git repo, each agent's changes become a{" "}
        <strong>reviewable diff</strong> you merge or discard, even hunk by hunk, and your own uncommitted work is never
        touched.
      </>
    ),
  },
  {
    q: "Can an agent share a screenshot or a test result?",
    a: (
      <>
        Yes. It saves the file under <M>.bothread/attachments/</M> and mentions the path; the room shows images inline.
        Those files never show up in diffs.
      </>
    ),
  },
  {
    q: "How do I update Bothread?",
    a: (
      <>
        Stop the running hub, then: <M>npx bothread@latest start</M> if you use npx,{" "}
        <M>npm install -g bothread@latest</M> if you installed globally, or <M>git pull</M> for a clone. Your agent
        knows this too; it's in the skill.
      </>
    ),
  },
  {
    q: "Is this related to “Brothread” embroidery thread?",
    a: (
      <>
        <strong>No.</strong> Bothread (no “r” after the “B”) is a developer tool, unrelated to the embroidery brand.
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
