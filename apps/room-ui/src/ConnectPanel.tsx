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
const SELF_SETUP: Partial<Record<AgentId, { name: string; brand: string; skillUrl: string; skillPath: string }>> = {
  claude: { name: "Claude Code", brand: "claude", skillUrl: "https://bothread.vercel.app/SKILL.md", skillPath: ".claude/skills/bothread/SKILL.md" },
  cursor: { name: "Cursor", brand: "cursor", skillUrl: "https://bothread.vercel.app/AGENTS.md", skillPath: "AGENTS.md in this project's root" },
  antigravity: { name: "Antigravity", brand: "antigravity", skillUrl: "https://bothread.vercel.app/AGENTS.md", skillPath: "AGENTS.md in this project's root" },
  gemini: { name: "Gemini", brand: "gemini", skillUrl: "https://bothread.vercel.app/AGENTS.md", skillPath: "AGENTS.md in this project's root" },
  codex: { name: "Codex", brand: "codex", skillUrl: "https://bothread.vercel.app/AGENTS.md", skillPath: "AGENTS.md in this project's root" },
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

/** The full copy-paste prompt that makes the agent set itself up and join. */
function agentPrompt(agent: AgentId, info: ConnectInfo, sessionId: string): string | null {
  const s = SELF_SETUP[agent];
  if (!s) return null;
  return `You're joining Bothread — a local room where you team up with other AI coding agents on this codebase while a human watches. Set yourself up:

1. Add the Bothread MCP server: ${configInstruction(agent, info)}.
2. Save the room etiquette: fetch ${s.skillUrl} and save it to ${s.skillPath}.
3. The Bothread tools only load after a restart/reload — do that (or ask me to), then continue.

Once the bothread tools are available, call the join_session tool with { "sessionId": "${sessionId}", "agentName": "${s.name}", "brand": "${s.brand}" }, then call get_room_state.

After that, act as a teammate: ALWAYS call claim_files before editing any file; NEVER edit a file another participant holds; use send_message to talk to the others (they can't see your private reasoning); call request_approval before anything risky (delete, deploy, shell, git push); and use wait_for_update to wait for the others instead of stopping. Work toward whatever task I give the room.`;
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
  const prompt = info ? agentPrompt(agent, info, sessionId) : null;
  const joinLine = `This is a Bothread session: ${sessionId}`;

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
          Pick your agent, then <strong>paste the prompt into it</strong> — it adds Bothread to itself, learns
          the etiquette, and joins. You just approve its steps and reload when it asks.
        </p>

        <div className="agent-tabs">
          {AGENTS.map((a) => (
            <button key={a.id} className={`agent-tab${a.id === agent ? " on" : ""}`} onClick={() => setAgent(a.id)}>
              {a.label}
            </button>
          ))}
        </div>

        {prompt ? (
          <>
            <div className="step-n">🪄 Paste this to {meta.label}</div>
            <div className="snip tall">
              <pre>{prompt}</pre>
              <Copy text={prompt} label="Copy prompt" />
            </div>
            <details className="manual">
              <summary>Prefer to set it up by hand?</summary>
              <div className="snip-where">{meta.where}</div>
              <div className="snip">
                <pre>{code || "…"}</pre>
                {code && <Copy text={code} />}
              </div>
              <p className="modal-sub" style={{ marginTop: "0.6rem" }}>
                Then, after reloading, tell {meta.label}: “<span className="mono">{joinLine}</span>”.
              </p>
            </details>
          </>
        ) : (
          <>
            <div className="step-n">1 · Add the server</div>
            <div className="snip-where">{meta.where}</div>
            <div className="snip">
              <pre>{code || "…"}</pre>
              {code && <Copy text={code} />}
            </div>
            <div className="step-n">2 · Tell it to join</div>
            <p className="modal-sub">After reloading, paste this into the agent:</p>
            <div className="snip">
              <pre>{joinLine}</pre>
              <Copy text={joinLine} />
            </div>
          </>
        )}

        <p className="modal-foot">
          The session ID is the room credential — share it only with agents you want in this room. New here?
          See the full guide at <span className="mono">bothread.vercel.app/start</span>.
        </p>
      </div>
    </div>
  );
}
