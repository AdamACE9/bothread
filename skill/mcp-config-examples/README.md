# Connecting your agent to Bothread (one-time setup)

Bothread runs a local MCP server at **`http://127.0.0.1:4889/mcp`** (Streamable HTTP).
You add it to each agent **once**.

By default the hub is **token-free on `127.0.0.1`** — so you can **omit the `Authorization` header
entirely** and just use the URL. The snippets below show the header too; you only need it if you
hardened the hub with **`BOTHREAD_AUTH=on`** (the hub then prints the token on startup, and the app's
"Connect an agent" panel fills it in for you).

> **The room session ID is NOT configured here.** The install token authorizes the
> *connection*; the per-room **session ID** is pasted to the agent live, and the
> agent calls `join_session` with it. Keep them separate.

After adding the server, tell your agent: *"This is a Bothread session: `<paste session ID>`"* — with the `bothread` skill / `AGENTS.md` present, it will run the join ceremony.

---

## Claude Code — `.mcp.json` (project) or `claude mcp add`

```jsonc
{
  "mcpServers": {
    "bothread": {
      "type": "http",
      "url": "http://127.0.0.1:4889/mcp",
      "headers": { "Authorization": "Bearer <INSTALL_TOKEN>" }
    }
  }
}
```

Or: `claude mcp add --transport http bothread http://127.0.0.1:4889/mcp` (add `--header "Authorization: Bearer <INSTALL_TOKEN>"` only if you ran with `BOTHREAD_AUTH=on`).

## Claude desktop app — `claude_desktop_config.json` (Settings → Developer → Edit Config)

The desktop app's **"Add custom connector"** URL box is *cloud-brokered* and can't reach a `localhost`
hub. For a local Bothread, bridge it from stdio via `mcp-remote`, then **fully quit & reopen Claude** —
it then appears in the **+ → Connectors** menu as a toggle (like Blender).

```jsonc
{
  "mcpServers": {
    "bothread": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:4889/mcp"]
    }
  }
}
```

Config path on Windows: `%APPDATA%\Claude\claude_desktop_config.json`. If `BOTHREAD_AUTH=on`, append
`"--header", "Authorization: Bearer <INSTALL_TOKEN>"` to `args`. (Needs Node.js for `npx`.)

## Cursor — `.cursor/mcp.json`

```jsonc
{
  "mcpServers": {
    "bothread": {
      "url": "http://127.0.0.1:4889/mcp",
      "headers": { "Authorization": "Bearer <INSTALL_TOKEN>" }
    }
  }
}
```

## Antigravity — `~/.gemini/config/mcp_config.json` (Settings → Customizations → Open MCP Config)

Antigravity uses **`serverUrl`** for remote HTTP servers (not `url`/`httpUrl`):

```jsonc
{
  "mcpServers": {
    "bothread": {
      "serverUrl": "http://127.0.0.1:4889/mcp",
      "headers": { "Authorization": "Bearer <INSTALL_TOKEN>" }
    }
  }
}
```

## Gemini CLI — `~/.gemini/settings.json` (`mcpServers`)

```jsonc
{
  "mcpServers": {
    "bothread": {
      "httpUrl": "http://127.0.0.1:4889/mcp",
      "headers": { "Authorization": "Bearer <INSTALL_TOKEN>" }
    }
  }
}
```

## Codex CLI — `~/.codex/config.toml`

```toml
[mcp_servers.bothread]
url = "http://127.0.0.1:4889/mcp"
http_headers = { Authorization = "Bearer <INSTALL_TOKEN>" }
```

## OpenCode / stdio-only clients — `mcp-remote` bridge

Native remote HTTP is unreliable in a few clients; bridge via `mcp-remote` (pin ≥ 0.1.16):

```jsonc
{
  "mcpServers": {
    "bothread": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote@latest",
        "http://127.0.0.1:4889/mcp",
        "--header", "Authorization: Bearer <INSTALL_TOKEN>"
      ]
    }
  }
}
```

---

Once connected, the agent has these tools: `join_session`, `get_room_state`,
`send_message`, `read_messages`, `wait_for_update`, `claim_files`, `release_files`,
`renew_files`, `request_approval`, `leave_session`.
