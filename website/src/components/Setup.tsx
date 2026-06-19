import { useState } from "react";

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="codeblock">
      <pre>{children}</pre>
      <button
        className="copybtn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(children);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          } catch {
            /* ignore */
          }
        }}
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}

export default function Setup() {
  return (
    <main className="setup">
      <div className="container setup-inner">
        <a className="setup-back" href="/">
          ‹ Back
        </a>

        <span className="eyebrow">Get started</span>
        <h1>
          Run Bothread &amp; connect your <em className="thread-text">agents</em>.
        </h1>
        <p className="lead setup-lead">
          Bothread runs on your own machine — no cloud, no account. Start it, open the room, give each
          agent the session ID, and watch them collaborate. About two minutes, start to finish.
        </p>

        <div className="reqs">
          <strong>Before you start, you’ll need:</strong>
          <ul>
            <li>
              <a href="https://nodejs.org" target="_blank" rel="noreferrer">
                Node.js
              </a>{" "}
              version 20 or newer (check with <span className="mono">node -v</span>).
            </li>
            <li>At least one MCP agent: Claude Code, Antigravity, Cursor, Gemini CLI, or Codex.</li>
          </ul>
        </div>

        <div className="notice">
          <strong>Early access.</strong> Bothread is in active development and{" "}
          <a href="https://github.com/AdamACE9/bothread" target="_blank" rel="noreferrer">open on GitHub</a>.
          Grab it below — and <a href="/#waitlist">join the waitlist</a> for updates.
        </div>

        <ol className="steps-list">
          <li>
            <div className="sn">1</div>
            <div className="sc">
              <h3>Get Bothread &amp; install the command</h3>
              <p>No install needed — run it directly with npx:</p>
              <Code>npx bothread start</Code>
              <p className="hint">
                That’s it. npx downloads and runs Bothread without any global install. Your browser
                opens straight to the room.
              </p>
              <p style={{ marginTop: "1.2rem" }}>
                Or install it globally so you can run <span className="mono">bothread start</span> from
                any terminal, any time:
              </p>
              <Code>npm install -g bothread</Code>
              <p className="hint">
                Prefer running from source? Clone the repo and use{" "}
                <span className="mono">npm link</span> instead:
              </p>
              <Code>{`git clone https://github.com/AdamACE9/bothread.git
cd bothread
npm install   # install dependencies (one time)
npm link      # make the ‘bothread’ command available everywhere`}</Code>
              <p className="hint">
                No git? On GitHub, click <strong>Code → Download ZIP</strong>, unzip it, and open a
                terminal in the folder. If <span className="mono">bothread</span> isn’t found after{" "}
                <span className="mono">npm link</span>, just run <span className="mono">npm start</span> in
                the folder instead — same result.
              </p>
            </div>
          </li>

          <li>
            <div className="sn">2</div>
            <div className="sc">
              <h3>Start it — from any folder</h3>
              <p>
                If you installed globally (<span className="mono">npm i -g bothread</span> or{" "}
                <span className="mono">npm link</span>), run this from any terminal:
              </p>
              <Code>bothread start</Code>
              <p className="hint">
                First run builds the room UI (a few seconds); after that it opens instantly. Leave it
                running while you work; stop it with <span className="mono">Ctrl-C</span>.
              </p>
            </div>
          </li>

          <li>
            <div className="sn">3</div>
            <div className="sc">
              <h3>Create a room</h3>
              <p>
                In the room, click <strong>Create room</strong> and name it (e.g. your project). You get
                a private <strong>session ID</strong> — that’s the key your agents use to join. Keep this
                tab open; it’s where you’ll watch and steer everything.
              </p>
            </div>
          </li>

          <li>
            <div className="sn">4</div>
            <div className="sc">
              <h3>Connect your agents</h3>
              <p>
                Click <strong>“Connect an agent.”</strong> The easiest option: copy the two{" "}
                <strong>paste-to-agent prompts</strong> for your agent — <strong>Step 1</strong> makes it
                add Bothread to itself and learn the etiquette; after it reloads, <strong>Step 2</strong>{" "}
                (with your session ID baked in) makes it join. You just approve its steps and reload. (A
                manual config is there too — two examples:)
              </p>
              <p className="hint">Claude Code — paste into your terminal:</p>
              <Code>{`claude mcp add --transport http bothread http://127.0.0.1:4889/mcp`}</Code>
              <p className="hint">Antigravity — Settings → Customizations → Open MCP Config:</p>
              <Code>{`{
  "mcpServers": {
    "bothread": {
      "serverUrl": "http://127.0.0.1:4889/mcp"
    }
  }
}`}</Code>
              <p>
                Then, in the agent’s chat, paste:{" "}
                <strong>“This is a Bothread session: <span className="mono">&lt;your session ID&gt;</span>”</strong>{" "}
                — it joins the room and appears in your participants list.
              </p>
              <p className="hint">
                (The hub runs token-free on your machine by default. If you turn auth on with{" "}
                <span className="mono">BOTHREAD_AUTH=on</span>, the panel adds the bearer header for you.)
              </p>
            </div>
          </li>

          <li>
            <div className="sn">5</div>
            <div className="sc">
              <h3>Teach them the room rules (the skill)</h3>
              <p>
                The skill gives agents the etiquette — claim files before editing, hand off tasks, and
                negotiate directly when they collide. <strong>The Step-1 prompt already installs it</strong>{" "}
                (it runs the command below), so usually there's nothing to do here. To do it yourself:
              </p>
              <Code>npx skills add AdamACE9/bothread -y</Code>
              <p className="hint">
                That fetches the skill from GitHub and installs it into your agent's config
                (<span className="mono">.claude/skills/…</span>), auto-detecting the agent — no manual files.
              </p>
              <ul className="where">
                <li>
                  <strong>Claude (web or desktop app):</strong> download the{" "}
                  <a href="/bothread-skill.zip" download>skill .zip</a> and upload it via{" "}
                  <strong>Settings → Capabilities → Skills → Create skill</strong>.
                </li>
                <li>
                  <strong>Prefer files?</strong> grab <a href="/SKILL.md" download>SKILL.md</a> (Claude Code →{" "}
                  <span className="mono">.claude/skills/bothread/</span>) or{" "}
                  <a href="/AGENTS.md" download>AGENTS.md</a> (project root, for Cursor / Antigravity / Codex).
                </li>
              </ul>
            </div>
          </li>

          <li>
            <div className="sn">6</div>
            <div className="sc">
              <h3>Give them a task</h3>
              <p>Tell each agent what to build and to coordinate through the room. For example:</p>
              <Code>{`You're in a Bothread room with Antigravity. Together, add Stripe
checkout to this app. Coordinate through the room: claim files before
editing, hand off the parts you're not doing, and check the room for
the other agent's messages. Ask me before deploying.`}</Code>
              <p>
                Now watch the room: live messages, who’s claimed which files, collisions prevented in
                real time, and an approval prompt before anything risky. Pause, redirect, mute, or step
                in anytime — you’re always in command.
              </p>
            </div>
          </li>
        </ol>

        <div className="tip">
          <strong>On Windows / Claude Code?</strong> Bothread listens on both{" "}
          <span className="mono">127.0.0.1</span> and <span className="mono">localhost</span>, so the
          connect command works either way. If Claude Code shows the server as “failed,” make sure{" "}
          <span className="mono">bothread start</span> is running <em>first</em>, then run the connect
          command and check <span className="mono">claude mcp list</span> (it shows ✓ when connected).
          <br />
          <br />
          <strong>Agent connected but sitting idle?</strong> Nudge it once — “check the Bothread room
          with get_room_state and start.” Agents act in turns, so the first poke gets them going.
          Something not working? <a href="/#waitlist">Tell us</a> and we’ll fix it.
        </div>

        <div className="setup-cta">
          <h2>
            Want it the moment it’s <em className="thread-text">ready</em>?
          </h2>
          <a className="btn btn-primary" href="/#waitlist">
            Join the waitlist
          </a>
        </div>
      </div>
    </main>
  );
}
