import { useEffect, useRef, useState } from "react";
import type { ParticipantView } from "@bothread/shared";
import { getConnectInfo, listAgents, setupAgent, type ConnectInfo, type DetectedAgent } from "./api";
import { useToast } from "./toast";
import { Icon } from "./icons";
import { Avatar, CopyButton, brandClass } from "./ui";

const AGENTS = [
  { id: "claude", label: "Claude Code", where: "Run once in your terminal:" },
  { id: "claude-desktop", label: "Claude (desktop app)", where: "Settings → Developer → Edit Config, paste this, then fully quit & reopen Claude:" },
  { id: "antigravity", label: "Antigravity", where: "Settings → Customizations → Open MCP Config (~/.gemini/config/mcp_config.json):" },
  { id: "cursor", label: "Cursor", where: "Add to .cursor/mcp.json:" },
  { id: "gemini", label: "Gemini CLI", where: "Add to ~/.gemini/settings.json:" },
  { id: "codex", label: "Codex", where: "Add to ~/.codex/config.toml:" },
  { id: "opencode", label: "OpenCode", where: "Run once in your terminal:" },
  { id: "other", label: "Other", where: "Bridge any MCP client via mcp-remote:" },
] as const;
type AgentId = (typeof AGENTS)[number]["id"];

/** The manual config snippet (fallback / reference). */
function snippet(agent: AgentId, info: ConnectInfo): string {
  const url = info.mcpUrl;
  const bearer = info.token ? `Bearer ${info.token}` : null;
  switch (agent) {
    case "claude":
      return bearer
        ? `claude mcp add --transport http bothread ${url} \\\n  --header "Authorization: ${bearer}"`
        : `claude mcp add --transport http bothread ${url}`;
    case "cursor":
      return JSON.stringify(
        { mcpServers: { bothread: { url, ...(bearer ? { headers: { Authorization: bearer } } : {}) } } },
        null,
        2
      );
    case "claude-desktop": {
      const args = ["-y", "mcp-remote", url];
      if (bearer) args.push("--header", `Authorization: ${bearer}`);
      return JSON.stringify({ mcpServers: { bothread: { command: "npx", args } } }, null, 2);
    }
    case "antigravity":
      return JSON.stringify(
        { mcpServers: { bothread: { serverUrl: url, ...(bearer ? { headers: { Authorization: bearer } } : {}) } } },
        null,
        2
      );
    case "gemini":
      return JSON.stringify(
        { mcpServers: { bothread: { httpUrl: url, ...(bearer ? { headers: { Authorization: bearer } } : {}) } } },
        null,
        2
      );
    case "codex":
      return `[mcp_servers.bothread]\nurl = "${url}"` + (bearer ? `\nhttp_headers = { Authorization = "${bearer}" }` : "");
    case "opencode":
      return bearer
        ? `opencode mcp add bothread --url ${url} \\\n  --header "Authorization=${bearer}"`
        : `opencode mcp add bothread --url ${url}`;
    case "other":
      return JSON.stringify(
        {
          mcpServers: {
            bothread: {
              command: "npx",
              args: ["-y", "mcp-remote@latest", url, ...(bearer ? ["--header", `Authorization: ${bearer}`] : [])],
            },
          },
        },
        null,
        2
      );
  }
}

/** Agents that can configure themselves from a pasted prompt (they run commands / edit files). */
const SELF_SETUP: Partial<Record<AgentId, { name: string; brand: string }>> = {
  claude: { name: "Claude Code", brand: "claude" },
  cursor: { name: "Cursor", brand: "cursor" },
  antigravity: { name: "Antigravity", brand: "antigravity" },
  gemini: { name: "Gemini", brand: "gemini" },
  codex: { name: "Codex", brand: "codex" },
  opencode: { name: "OpenCode", brand: "opencode" },
};

/** The exact "add the MCP server" instruction the agent should perform, per agent. */
function configInstruction(agent: AgentId, info: ConnectInfo): string {
  const url = info.mcpUrl;
  const hdrCli = info.token ? ` --header "Authorization: Bearer ${info.token}"` : "";
  const hdrJson = info.token ? `, "headers": { "Authorization": "Bearer ${info.token}" }` : "";
  switch (agent) {
    case "claude":
      return `run this in the terminal: claude mcp add --transport http bothread ${url}${hdrCli}`;
    case "cursor":
      return `create or edit .cursor/mcp.json in this project so it contains {"mcpServers":{"bothread":{"url":"${url}"${hdrJson}}}}`;
    case "antigravity":
      return `edit ~/.gemini/config/mcp_config.json to add {"mcpServers":{"bothread":{"serverUrl":"${url}"${hdrJson}}}}`;
    case "gemini":
      return `edit ~/.gemini/settings.json to add {"mcpServers":{"bothread":{"httpUrl":"${url}"${hdrJson}}}}`;
    case "codex":
      return `add to ~/.codex/config.toml a [mcp_servers.bothread] section with url = "${url}"${info.token ? ` and http_headers = { Authorization = "Bearer ${info.token}" }` : ""}`;
    case "opencode":
      return `run this in the terminal: opencode mcp add bothread --url ${url}${info.token ? ` --header "Authorization=Bearer ${info.token}"` : ""}`;
    default:
      return "";
  }
}

/** STEP 1 — paste before reloading. Makes the agent configure itself (no join yet). */
function setupPrompt(agent: AgentId, info: ConnectInfo): string | null {
  const s = SELF_SETUP[agent];
  if (!s) return null;
  return `You're about to join Bothread — a local room where you'll team up with other AI coding agents on this codebase while a human watches. Set yourself up now, but DON'T join yet (the Bothread tools only appear after you reload):

1. Add the Bothread MCP server: ${configInstruction(agent, info)}.
2. Install the Bothread skill so you know the room etiquette: run \`npx skills add AdamACE9/bothread -y\`.
3. Confirm both are done, then tell me to restart/reload you so the "bothread" tools load. Then stop and wait for my next message.`;
}

/** STEP 2 — paste after the agent reloads. Carries the live session ID and makes it join + behave. */
function joinPrompt(agent: AgentId, sessionId: string): string {
  const s = SELF_SETUP[agent];
  const name = s?.name ?? (agent === "claude-desktop" ? "Claude" : "Agent");
  const brand = s?.brand ?? (agent === "claude-desktop" ? "claude" : "agent");
  return `This is a Bothread session: ${sessionId}

You should now have the "bothread" tools. Call join_session with { "sessionId": "${sessionId}", "agentName": "${name}", "brand": "${brand}" }, then call get_room_state to see who's there and which files are claimed.

Then act as a teammate: ALWAYS call claim_files before editing any file; NEVER edit a file another participant holds; use send_message to talk to the others (they can't see your private reasoning); and — important — whenever you finish a step but the shared task isn't done, call wait_for_update INSTEAD of stopping (it returns within ~45s with any new activity; loop it) so you stay listening to the others rather than going dormant. (Your own app handles approvals for risky actions — only call request_approval if I ask for a room-level sign-off.) Work toward whatever task I give the room.`;
}

export default function ConnectPanel({
  sessionId,
  participants,
  onClose,
}: {
  sessionId: string;
  participants: ParticipantView[];
  onClose: () => void;
}) {
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [agent, setAgent] = useState<AgentId>("claude");
  const [step, setStep] = useState<1 | 2>(1);
  // Everyone already here when the panel opened; anyone new is "the agent you just connected".
  const initial = useRef(new Set(participants.map((p) => p.id)));
  const joined = participants.filter((p) => p.kind === "agent" && p.status === "active" && !initial.current.has(p.id));

  const toast = useToast();
  const [detected, setDetected] = useState<Record<string, DetectedAgent>>({});
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoDone, setAutoDone] = useState<Record<string, string>>({});

  useEffect(() => {
    getConnectInfo().then(setInfo).catch(() => {});
    // Older hubs don't have detection; the panel simply falls back to copy-paste.
    listAgents()
      .then((list) => {
        const map = Object.fromEntries(list.map((a) => [a.id, a]));
        setDetected(map);
        const first = list.find((a) => a.detected && AGENTS.some((x) => x.id === a.id));
        if (first) setAgent(first.id as AgentId);
      })
      .catch(() => {});
  }, []);

  const det = detected[agent];
  const runAutoSetup = async () => {
    setAutoBusy(true);
    try {
      const r = await setupAgent(agent);
      if (!r.ok) throw new Error(r.message);
      setAutoDone((d) => ({ ...d, [agent]: r.message }));
      setDetected((d) => (d[agent] ? { ...d, [agent]: { ...d[agent]!, configured: true } } : d));
    } catch (err) {
      toast.error(err, "Automatic setup didn't work");
    } finally {
      setAutoBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const meta = AGENTS.find((a) => a.id === agent)!;
  const code = info ? snippet(agent, info) : "";
  const setup = info ? setupPrompt(agent, info) : null;
  const join = joinPrompt(agent, sessionId);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal connect" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Connect an agent">
        <div className="modal-head">
          <h2>Connect an agent</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>

        {joined.length > 0 && (
          <div className="joined-banner" role="status">
            {joined.map((p) => (
              <Avatar key={p.id} name={p.name} brand={p.brand} size={26} ring="live" />
            ))}
            <span>
              <strong>{joined.map((p) => p.name).join(", ")}</strong> joined the room.
            </span>
            <span className="spacer" />
            <button className="btn sm" onClick={() => (setStep(1), (initial.current = new Set(participants.map((p) => p.id))))}>
              Connect another
            </button>
            <button className="btn sm primary" onClick={onClose}>
              Done
            </button>
          </div>
        )}

        <div className="agent-grid" role="radiogroup" aria-label="Which agent?">
          {AGENTS.map((a) => (
            <button
              key={a.id}
              role="radio"
              aria-checked={a.id === agent}
              className={`agent-pick ${brandClass(a.id)}${a.id === agent ? " on" : ""}`}
              onClick={() => (setAgent(a.id), setStep(1))}
            >
              <span className="agent-dot" />
              <span className="agent-name">{a.label}</span>
              {detected[a.id]?.configured ? (
                <span className="agent-badge ok" title="Bothread is already in this agent's MCP config">
                  <Icon name="check" size={11} />
                </span>
              ) : detected[a.id]?.detected ? (
                <span className="agent-badge" title="Installed on this machine">
                  found
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <ol className="steps">
          <li className={step === 1 ? "on" : "done"}>
            <button className="step-head" onClick={() => setStep(1)}>
              <span className="step-n">{step === 2 ? <Icon name="check" size={12} /> : 1}</span>
              {setup ? `Let ${meta.label} set itself up` : `Add Bothread to ${meta.label}`}
            </button>
            {step === 1 && (
              <div className="step-body">
                {det?.canAutoSetup && (
                  <div className={`auto-setup${det.configured ? " done" : ""}`}>
                    <div className="auto-text">
                      <strong>
                        {det.configured ? `${meta.label} already has Bothread` : `${meta.label} is installed on this computer`}
                      </strong>
                      <span>
                        {autoDone[agent] ??
                          (det.configured
                            ? "Restart it if it was open while you set this up, then go to step 2."
                            : `Bothread can add itself to ${det.target ?? "its MCP config"} for you. Your current config is backed up first.`)}
                      </span>
                    </div>
                    {det.configured ? (
                      <button className="btn primary" onClick={() => setStep(2)}>
                        Go to step 2
                      </button>
                    ) : (
                      <button className="btn primary" onClick={runAutoSetup} disabled={autoBusy}>
                        <Icon name="zap" size={14} /> {autoBusy ? "Setting up" : "Set it up for me"}
                      </button>
                    )}
                  </div>
                )}
                {setup ? (
                  <>
                    <p className="modal-sub">
                      Paste this into {meta.label} and approve what it runs. It adds the MCP server and installs the room
                      etiquette skill. Then restart {meta.label} so the new tools load.
                    </p>
                    <div className="snip tall">
                      <pre>{setup}</pre>
                      <CopyButton text={setup} label="Copy setup prompt" />
                    </div>
                    <details className="manual">
                      <summary>Rather add the server yourself?</summary>
                      <div className="snip-where">{meta.where}</div>
                      <div className="snip">
                        <pre>{code || "Loading"}</pre>
                        {code && <CopyButton text={code} />}
                      </div>
                    </details>
                  </>
                ) : (
                  <>
                    <div className="snip-where">{meta.where}</div>
                    <div className="snip">
                      <pre>{code || "Loading"}</pre>
                      {code && <CopyButton text={code} />}
                    </div>
                  </>
                )}
                <div className="step-next">
                  <button className="btn primary" onClick={() => setStep(2)}>
                    It's set up, next step
                  </button>
                </div>
              </div>
            )}
          </li>
          <li className={step === 2 ? "on" : ""}>
            <button className="step-head" onClick={() => setStep(2)}>
              <span className="step-n">2</span>
              Send it into this room
            </button>
            {step === 2 && (
              <div className="step-body">
                <p className="modal-sub">This prompt carries the room's session ID. The agent joins and starts working with the others.</p>
                <div className="snip tall">
                  <pre>{join}</pre>
                  <CopyButton text={join} label="Copy join prompt" />
                </div>
                {joined.length === 0 && (
                  <div className="listening-for">
                    <span className="pulse" aria-hidden="true" /> Watching for {meta.label} to join
                  </div>
                )}
              </div>
            )}
          </li>
        </ol>

        <p className="modal-foot">
          The session ID works like a password for this room. Only give it to agents you want inside. In Claude Code you can
          also run <code>/mcp__bothread__join</code> once the server is added.
        </p>
      </div>
    </div>
  );
}
