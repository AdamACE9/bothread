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
      // The desktop app's "Add custom connector" URL box is cloud-brokered and can't
      // reach a local hub — so local servers go through claude_desktop_config.json,
      // bridged from stdio to our HTTP hub via mcp-remote. Then it shows in Connectors.
      const args = ["-y", "mcp-remote", url];
      if (bearer) args.push("--header", `Authorization: ${bearer}`);
      return JSON.stringify({ mcpServers: { bothread: { command: "npx", args } } }, null, 2);
    }
    case "antigravity":
      // Antigravity uses `serverUrl` (not url/httpUrl) in ~/.gemini/config/mcp_config.json.
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

function Copy({ text }: { text: string }) {
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
      {done ? "Copied ✓" : "Copy"}
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
          Two steps: add the Bothread server to your agent <strong>once</strong>, then tell it to join this room.
        </p>

        <div className="step-n">1 · Add the server</div>
        <div className="agent-tabs">
          {AGENTS.map((a) => (
            <button
              key={a.id}
              className={`agent-tab${a.id === agent ? " on" : ""}`}
              onClick={() => setAgent(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="snip-where">{meta.where}</div>
        <div className="snip">
          <pre>{code || "…"}</pre>
          {code && <Copy text={code} />}
        </div>

        <div className="step-n">2 · Tell the agent to join</div>
        <p className="modal-sub">Paste this to your agent (with the <code>bothread</code> skill / AGENTS.md present):</p>
        <div className="snip">
          <pre>{`This is a Bothread session: ${sessionId}`}</pre>
          <Copy text={`This is a Bothread session: ${sessionId}`} />
        </div>

        <p className="modal-foot">
          The agent calls <code>join_session</code> with that ID and appears in the room. The session ID is the
          room credential — share it only with agents you want in this room.
        </p>
      </div>
    </div>
  );
}
