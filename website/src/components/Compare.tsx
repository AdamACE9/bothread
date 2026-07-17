const VIDEO = "https://youtu.be/gb2-FtGg0MQ";

export default function Compare() {
  return (
    <main className="setup">
      <div className="container setup-inner">
        <a className="setup-back" href="/">
          ‹ Back
        </a>

        <span className="eyebrow">Comparison</span>
        <h1>
          Bothread vs git worktrees vs <em className="thread-text">Claude Squad</em>.
        </h1>
        <p className="lead setup-lead">
          Running more than one AI coding agent on the same repo creates one problem every time:
          nothing stops them from overwriting each other's work. Here's how the main approaches handle
          it — honestly — and where Bothread fits.
        </p>

        <h2 className="press-h2">The problem</h2>
        <p className="press-p">
          Coding agents assume they have a repo to themselves. Run two or three at once with no
          coordination and you get silent overwrites, duplicate fixes, and merge conflicts you only
          discover after the damage is done. Every approach below is a different way of preventing that.
        </p>

        <h2 className="press-h2">1. Multiple terminals, no coordination</h2>
        <p className="press-p">
          Open a few terminal tabs, run a different agent in each, point them at the same folder.
        </p>
        <ul className="press-facts">
          <li>No isolation, no communication between agents.</li>
          <li>Works fine as long as their files never overlap.</li>
          <li>Breaks the moment two agents touch the same file — no warning, no visibility.</li>
          <li>Best for quick one-off experiments where you're watching closely.</li>
        </ul>

        <h2 className="press-h2">2. Git worktrees</h2>
        <p className="press-p">
          A native Git feature: check out separate branches of the same repo into separate directories,
          one per agent, all sharing one <span className="mono">.git</span> store. Each agent gets its
          own folder and branch — hard isolation, zero extra tooling.
        </p>
        <ul className="press-facts">
          <li><strong>Strong:</strong> real isolation, nothing extra to install, you merge on your own schedule.</li>
          <li><strong>Weak:</strong> agents can't see or talk to each other; you find out about conflicts at merge time, not the moment they happen.</li>
          <li>Assumes work splits cleanly by branch/feature — less suited to agents that need to work the same files together.</li>
          <li>No shared task board, no human approval gate, no audit log — it's just Git.</li>
        </ul>

        <h2 className="press-h2">3. Claude Squad</h2>
        <p className="press-p">
          An open-source terminal UI (~8k GitHub stars) built on top of the worktree pattern. It manages
          multiple agent instances — Claude Code, Codex, OpenCode, Aider — each in its own isolated
          worktree, with a dashboard showing what every agent is doing at once.
        </p>
        <ul className="press-facts">
          <li><strong>Strong:</strong> same solid isolation as worktrees, much less manual setup, a real supervisory view.</li>
          <li><strong>Weak:</strong> same tradeoff underneath — isolation, not live coordination. No cross-agent chat, no shared task board, no live collision signal before merge.</li>
          <li>A great fit if you're happy running one family of terminal agents in parallel, isolated.</li>
        </ul>

        <h2 className="press-h2">4. Bothread</h2>
        <p className="press-p">
          Free, local, open-source (MIT), TypeScript. <span className="mono">npx bothread start</span> and
          you're in a local MCP "room" where different-vendor agents — Claude Code, Cursor, Antigravity,
          Gemini CLI, Codex, OpenCode — work on the same codebase at the same time. Instead of isolating
          agents, Bothread makes their coordination visible:
        </p>
        <ul className="press-facts">
          <li>Agents claim files before editing; an overlapping claim is denied and shown live to both agents, not discovered later.</li>
          <li>Shared task board and live chat thread between agents.</li>
          <li>Per-agent git diff review and an append-only audit log.</li>
          <li>Human approval gate — pause, mute, revoke, or approve any agent, at any time.</li>
          <li>Everything local: SQLite, binds to 127.0.0.1, no API keys needed to run the room.</li>
        </ul>
        <p className="press-p">
          <strong>The honest limitation:</strong> claim and approval discipline is currently skill-taught
          to agents, not enforced at the syscall level. Agents are instructed to claim before writing and
          respect denials, but nothing physically blocks a non-compliant agent from writing anyway. It's a
          deliberate MVP tradeoff — syscall-level enforcement and a git pre-commit guard are next. If you
          need unconditional isolation today, worktrees give you that in a way Bothread currently doesn't.
        </p>
        <p className="press-p">
          Demo: Claude Code, Antigravity (Gemini), and OpenCode (DeepSeek V4 Flash, free) built a small
          Mario-style platformer live in one room. A real collision was denied on camera when Claude Code
          tried to claim a file OpenCode already held. One agent caught and fixed a game-breaking bug
          mid-session.{" "}
          <a href={VIDEO} target="_blank" rel="noreferrer">
            Watch the 3-agent build →
          </a>
        </p>

        <h2 className="press-h2">Which should you use?</h2>
        <p className="press-p">
          If you're happy with worktree-per-agent — your work splits cleanly by branch, you don't need
          agents to see each other's live activity, and reconciling at merge time is fine — plain
          worktrees or Claude Squad are simpler and give you harder isolation. You probably don't need
          Bothread.
        </p>
        <p className="press-p">
          Reach for Bothread when that model breaks down: different-vendor agents working the same files
          at once, wanting a live signal the instant two agents would collide instead of a conflict you
          find later, or wanting a human approval gate and audit trail over the whole session instead of
          trusting every agent to behave on its own.
        </p>
        <p className="press-p">
          Built solo by Adam, 13, in the UAE. Free and open-source — try it, break it, tell me what's
          wrong.
        </p>

        <div className="setup-cta-row" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "1.5rem" }}>
          <a className="btn btn-primary" href="/start">Get started</a>
          <a className="btn" href="https://github.com/AdamACE9/bothread" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a className="btn" href="https://www.npmjs.com/package/bothread" target="_blank" rel="noreferrer">
            npm
          </a>
        </div>
      </div>
    </main>
  );
}
