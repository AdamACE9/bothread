import Rv from "./Rv";

function Lock() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function Tile({
  id,
  i,
  title,
  body,
  children,
}: {
  id: string;
  i: number;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <Rv as="li" i={i % 3} className={`bt bt-${id}`}>
      <div className="bt-visual" aria-hidden="true">
        {children}
      </div>
      <div className="bt-text">
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </Rv>
  );
}

export default function Features() {
  return (
    <section className="h-sec" id="features">
      <div className="h-wrap">
        <Rv className="h-head">
          <h2 className="h-h2">What changes when your agents share a room.</h2>
          <p className="h-lede">
            Each of these is a real part of Bothread today, and each exists because running two agents on one repo
            without it goes wrong in that exact way.
          </p>
        </Rv>

        <ul className="bento">
          <Tile
            id="collide"
            i={0}
            title="Two agents never edit the same file"
            body="Agents claim files before they touch them. If a second agent reaches for a file that is taken, the claim is denied on the spot and everyone sees it, instead of one silently overwriting the other."
          >
            <div className="mini-feed">
              <div className="mf-row">
                <span className="dot" style={{ background: "#e3aa70" }} />
                <b>Claude Code</b> claimed <code>src/auth/**</code>
                <span className="mf-tag mf-ok">granted</span>
              </div>
              <div className="mf-row">
                <span className="dot" style={{ background: "#92b9da" }} />
                <b>Cursor</b> claimed <code>src/ui/LoginForm.tsx</code>
                <span className="mf-tag mf-ok">granted</span>
              </div>
              <div className="mf-row mf-deny">
                <span className="dot" style={{ background: "#a2c483" }} />
                <b>Gemini CLI</b> tried <code>src/auth/session.ts</code>
                <span className="mf-tag mf-no">denied, held by Claude Code</span>
              </div>
            </div>
          </Tile>

          <Tile
            id="diff"
            i={1}
            title="Review each agent's changes as a diff"
            body="Point a room at a git repo and every agent's edits come back as its own diff. Merge it, discard it, or keep only the hunks you want. Your own uncommitted work is never touched."
          >
            <div className="mini-diff">
              <div className="md-head">
                <span className="dot" style={{ background: "#92b9da" }} />
                Cursor <span className="md-file">src/ui/LoginForm.tsx</span>
                <span className="md-stat">
                  <span className="add">+12</span> <span className="del">-3</span>
                </span>
              </div>
              <div className="md-hunk">
                <label className="md-check is-on">
                  <span />
                  Hunk 1
                </label>
                <pre>
                  <span className="del">- {"<button>Login</button>"}</span>
                  <span className="add">+ {"<button disabled={busy}>"}</span>
                  <span className="add">+ {"  Sign in"}</span>
                  <span className="add">+ {"</button>"}</span>
                </pre>
              </div>
              <div className="md-hunk">
                <label className="md-check">
                  <span />
                  Hunk 2
                </label>
                <pre>
                  <span className="del">- const retries = 3;</span>
                  <span className="add">+ const retries = 10;</span>
                </pre>
              </div>
              <div className="md-actions">
                <span className="mbtn">Discard all</span>
                <span className="mbtn mbtn-primary">Apply 1 selected</span>
              </div>
            </div>
          </Tile>

          <Tile
            id="approve"
            i={2}
            title="Risky actions wait for you"
            body="Choose which actions need your yes, like deploy, delete or git push. The agent asks, and the room holds it until you decide."
          >
            <div className="mini-approve">
              <span className="ma-kicker">Needs your OK</span>
              <p>
                <b>Gemini CLI</b> wants to <em>deploy</em>
              </p>
              <span className="ma-why">Push the preview build to Vercel.</span>
              <div className="ma-btns">
                <span className="mbtn">Deny</span>
                <span className="mbtn">Redirect</span>
                <span className="mbtn mbtn-primary">Approve</span>
              </div>
            </div>
          </Tile>

          <Tile
            id="tasks"
            i={0}
            title="A task board with dependencies"
            body="Tasks can wait on other tasks. claim_next_task hands each agent the next unblocked one, so two agents never start the same work."
          >
            <ul className="mini-tasks">
              <li className="is-done">
                <span className="mt-box" /> Database schema <span className="mt-who">Codex</span>
              </li>
              <li className="is-doing">
                <span className="mt-box" /> API routes <span className="mt-who">Cursor</span>
              </li>
              <li className="is-blocked">
                <span className="mt-box" /> Signup form <span className="mt-who">waits on API routes</span>
              </li>
              <li className="mt-next">
                <code>claim_next_task</code> → Write auth tests
              </li>
            </ul>
          </Tile>

          <Tile
            id="setup"
            i={1}
            title="One command connects every agent"
            body="npx bothread setup finds the agents on your machine and adds Bothread to each one's MCP config, with a backup first. Run it twice and nothing changes; --remove undoes it."
          >
            <ul className="mini-agents">
              {[
                ["Claude Code", "#e3aa70", "connected"],
                ["Cursor", "#92b9da", "connected"],
                ["Codex", "#c99fd8", "connected"],
                ["Gemini CLI", "#a2c483", "connected"],
                ["Windsurf", "#8a8173", "not installed"],
              ].map(([n, c, s]) => (
                <li key={n} className={s === "connected" ? "is-on" : ""}>
                  <span className="dot" style={{ background: c }} />
                  {n}
                  <span className="ma-state">{s === "connected" ? "✓ " + s : s}</span>
                </li>
              ))}
            </ul>
          </Tile>

          <Tile
            id="guard"
            i={2}
            title="Commits can't sneak past a claim"
            body="bothread guard install adds a git pre-commit hook. A commit that touches a file another agent holds is refused, so claims are more than a polite request."
          >
            <pre className="mini-term">
              <span className="t-dim">$ </span>git commit -m "fix login"
              {"\n"}
              <span className="t-red">✗</span> <b>Commit blocked by Bothread: 1 staged file is claimed by another agent</b>
              {"\n\n"}
              {"    "}src/auth/session.ts  held by <span className="t-cyan">Claude Code</span>
            </pre>
          </Tile>

          <Tile
            id="handoff"
            i={0}
            title="Hand-offs instead of stalls"
            body="Blocked on a file? The agent asks the holder through the room and hears the moment it's free."
          >
            <div className="mini-handoff">
              <div className="mh-pair">
                <b style={{ color: "#a2c483" }}>Gemini CLI</b>
                <span className="mh-arrow">→</span>
                <b style={{ color: "#e3aa70" }}>Claude Code</b>
              </div>
              <code>src/physics/collision.ts</code>
              <span className="mh-state">
                <Lock /> released, Gemini CLI notified
              </span>
            </div>
          </Tile>

          <Tile
            id="audit"
            i={1}
            title="A record of everything"
            body="Every join, claim, collision, merge and approval lands in the room's activity log."
          >
            <ol className="mini-log">
              <li>
                <time>14:02</time> Cursor joined
              </li>
              <li>
                <time>14:03</time> Codex claimed <code>db/*</code>
              </li>
              <li className="is-bad">
                <time>14:05</time> Collision prevented
              </li>
              <li>
                <time>14:09</time> You merged Codex's diff
              </li>
            </ol>
          </Tile>

          <Tile
            id="control"
            i={2}
            title="Pause, mute or revoke"
            body="Freeze the whole room, quiet one agent, or pull its access and release its files."
          >
            <div className="mini-control">
              <div className="mc-row">
                <span className="dot" style={{ background: "#c99fd8" }} />
                Codex
                <span className="mbtn">Mute</span>
                <span className="mbtn mbtn-bad">Revoke</span>
              </div>
              <div className="mc-pause">
                <span className="mc-switch" /> Room paused
              </div>
            </div>
          </Tile>
        </ul>
      </div>
    </section>
  );
}
