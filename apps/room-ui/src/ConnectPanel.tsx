import { useEffect, useState } from "react";
import { getConnectInfo, type ConnectInfo } from "./api";

const AGENTS = [
  { id: "claude", label: "Claude Code", where: "Run once in your terminal:" },
  { id: "claude-desktop", label: "Claude (desktop app)", where: "Settings → Developer → Edit Config, paste this, then fully quit & reopen Claude:" },
  { id: "antigravity", label: "Antigravity", where: "Settings → Customizations → Open MCP Config (~/.gemini/config/mcp_config.json):" },
  { id: "cursor", label: "Cursor", where: "Add to .cursor/mcp.json:" },
  { id: "gemini", label: "Gemini CLI", where: "Add to ~/.gemini/settings.json:" },
  { id: "codex", label: "Codex", where: "Add to ~/.codex/config.toml:" },
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
interface SelfSetup {
  name: string;
  brand: string;
  skillFile: string;
  skillUrl: string;
  skillPath: string;
}
const SELF_SETUP: Partial<Record<AgentId, SelfSetup>> = {
  claude: { name: "Claude Code", brand: "claude", skillFile: "SKILL.md", skillUrl: "https://bothread.vercel.app/SKILL.md", skillPath: ".claude/skills/bothread/SKILL.md" },
  cursor: { name: "Cursor", brand: "cursor", skillFile: "AGENTS.md", skillUrl: "https://bothread.vercel.app/AGENTS.md", skillPath: "AGENTS.md in this project's root" },
  antigravity: { name: "Antigravity", brand: "antigravity", skillFile: "AGENTS.md", skillUrl: "https://bothread.vercel.app/AGENTS.md", skillPath: "AGENTS.md in this project's root" },
  gemini: { name: "Gemini", brand: "gemini", skillFile: "AGENTS.md", skillUrl: "https://bothread.vercel.app/AGENTS.md", skillPath: "AGENTS.md in this project's root" },
  codex: { name: "Codex", brand: "codex", skillFile: "AGENTS.md", skillUrl: "https://bothread.vercel.app/AGENTS.md", skillPath: "AGENTS.md in this project's root" },
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
2. Save the room etiquette: use the ${s.skillFile} I attached — or fetch ${s.skillUrl} — and save it to ${s.skillPath}.
3. Confirm both are done, then tell me to restart/reload you so the "bothread" tools load. Then stop and wait for my next message.`;
}

/** STEP 2 — paste after the agent reloads. Carries the live session ID and makes it join + behave. */
function joinPrompt(agent: AgentId, sessionId: string): string {
  const s = SELF_SETUP[agent];
  const name = s?.name ?? (agent === "claude-desktop" ? "Claude" : "Agent");
  const brand = s?.brand ?? (agent === "claude-desktop" ? "claude" : "agent");
  return `This is a Bothread session: ${sessionId}

You should now have the "bothread" tools. Call join_session with { "sessionId": "${sessionId}", "agentName": "${name}", "brand": "${brand}" }, then call get_room_state to see who's there and which files are claimed.

Then act as a teammate: ALWAYS call claim_files before editing any file; NEVER edit a file another participant holds; use send_message to talk to the others (they can't see your private reasoning); and — important — whenever you finish a step but the shared task isn't done, call wait_for_update INSTEAD of stopping (it returns within ~25s with any new activity; loop it) so you stay listening to the others rather than going dormant. (Your own app handles approvals for risky actions — only call request_approval if I ask for a room-level sign-off.) Work toward whatever task I give the room.`;
}

function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* ignore */
        }
      }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

export default function ConnectPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [agent, setAgent] = useState<AgentId>("claude");

  useEffect(() => {
    getConnectInfo().then(setInfo).catch(() => {});
  }, []);

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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Connect an agent">
        <div className="modal-head">
          <h2>Connect an agent</h2>
          <button className="btn sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="modal-sub">
          Pick your agent, then paste <strong>two prompts</strong>: one to set it up, then — after it
          reloads — one to join. The agent does the config itself; you just approve &amp; reload.
        </p>

        <div className="agent-tabs">
          {AGENTS.map((a) => (
            <button key={a.id} className={`agent-tab${a.id === agent ? " on" : ""}`} onClick={() => setAgent(a.id)}>
              {a.label}
            </button>
          ))}
        </div>

        {setup ? (
          <>
            <div className="step-n">Step 1 · Paste to set up {meta.label}</div>
            <p className="modal-sub">
              Paste this in, approve its steps (and attach the {SELF_SETUP[agent]!.skillFile} if it asks),
              then reload {meta.label} when it’s done.
            </p>
            <div className="snip tall">
              <pre>{setup}</pre>
              <Copy text={setup} label="Copy setup prompt" />
            </div>

            <details className="manual">
              <summary>Prefer to add the server by hand?</summary>
              <div className="snip-where">{meta.where}</div>
              <div className="snip">
                <pre>{code || "…"}</pre>
                {code && <Copy text={code} />}
              </div>
            </details>
          </>
        ) : (
          <>
            <div className="step-n">Step 1 · Add the server</div>
            <div className="snip-where">{meta.where}</div>
            <div className="snip">
              <pre>{code || "…"}</pre>
              {code && <Copy text={code} />}
            </div>
          </>
        )}

        <div className="step-n">Step 2 · After it reloads, paste to join</div>
        <p className="modal-sub">This carries your room’s live session ID — it joins and starts collaborating.</p>
        <div className="snip tall">
          <pre>{join}</pre>
          <Copy text={join} label="Copy join prompt" />
        </div>

        <p className="modal-foot">
          The session ID is the room credential — share it only with agents you want in this room. New here?
          See the full guide at <span className="mono">bothread.vercel.app/start</span>.
        </p>
      </div>
    </div>
  );
}
