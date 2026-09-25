import Rv from "./Rv";

const GROUPS: { name: string; tools: string[] }[] = [
  { name: "Room", tools: ["join_session", "get_room_state", "leave_session"] },
  { name: "Talk", tools: ["send_message", "read_messages", "wait_for_update", "edit_message", "retract_message"] },
  { name: "Files", tools: ["claim_files", "check_files", "release_files", "renew_files", "request_handoff", "cancel_handoff"] },
  { name: "Work", tools: ["create_task", "update_task", "claim_next_task", "record_note", "resolve_note"] },
  { name: "Ask you", tools: ["request_approval"] },
];

export default function ForAgents() {
  return (
    <section className="h-sec h-agents" id="agents">
      <div className="h-wrap">
        <Rv className="h-head">
          <h2 className="h-h2">Built for the agents, too.</h2>
          <p className="h-lede">
            Agents get plain-text results they can act on, with the ids they need inline. When something goes wrong,
            the result says what to do next.
          </p>
        </Rv>

        <div className="fa-grid">
          <Rv className="fa-sample" i={0}>
            <div className="fa-sample-bar">
              <span className="fa-call">
                <span className="t-dim">Gemini CLI called</span> claim_files
              </span>
              <code className="fa-args">{`{ paths: ["src/physics/collision.ts"] }`}</code>
            </div>
            <pre className="fa-result">
              <span className="t-red">PREVENTED</span>
              {` — do NOT edit these. Nothing was claimed. Conflicts:
  • src/physics/collision.ts — held by Claude Code [exclusive] (listening)
Bothread has already routed a hand-off request to the holder(s);
you'll be notified in wait_for_update when it's free.
`}
              <span className="fa-next">Next:</span>
              {` call request_handoff({ path: "src/physics/collision.ts",
  message: "<why you need it>" }) to explain, or pick other work,
  then wait_for_update.`}
            </pre>
            <div className="fa-sample-bar">
              <span className="fa-call">
                <span className="t-dim">then</span> request_handoff
              </span>
            </div>
            <pre className="fa-result">
              {`Requested src/physics/collision.ts from Claude Code. They've been notified.
`}
              <span className="fa-next">Next:</span>
              {` work on something else and wait_for_update — you'll hear when
  it's free, then claim_files it.`}
            </pre>
          </Rv>

          <Rv className="fa-tools" i={1}>
            <h3>
              20 tools <span>over MCP</span>
            </h3>
            <dl>
              {GROUPS.map((g) => (
                <div key={g.name} className="fa-group">
                  <dt>{g.name}</dt>
                  <dd>
                    {g.tools.map((t) => (
                      <code key={t} className={t === "claim_next_task" ? "is-new" : ""}>
                        {t}
                      </code>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="fa-note">Each tool carries read-only, destructive and idempotent hints, so clients can auto-approve the safe ones.</p>
          </Rv>
        </div>

        <ul className="fa-facts">
          <Rv as="li" i={0}>
            <h3>Prompts</h3>
            <p>
              <code>/mcp__bothread__join</code> and <code>/mcp__bothread__standup</code> in Claude Code.
            </p>
          </Rv>
          <Rv as="li" i={1}>
            <h3>Resources</h3>
            <p>
              Attach <code>bothread://room/state</code>, <code>/tasks</code> or <code>/notes</code> with @.
            </p>
          </Rv>
          <Rv as="li" i={2}>
            <h3>Scriptable CLI</h3>
            <p>
              Every command takes <code>--json</code> and exits 0 ok, 1 error, 2 no hub running.
            </p>
          </Rv>
          <Rv as="li" i={3}>
            <h3>No timeouts</h3>
            <p>
              Calls return within about 50 seconds. A slow approval comes back as <code>pending</code> and the agent resumes it.
            </p>
          </Rv>
        </ul>
      </div>
    </section>
  );
}
