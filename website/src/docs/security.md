## Security model

Bothread assumes one person on one computer. The hub listens on `127.0.0.1`, so only programs on
your machine can reach it. Within that boundary, 0.3 closes the gap that remained: web pages you
visit.

### What's protected, and how

| Threat | Protection |
|---|---|
| Another device on your network | The hub binds `127.0.0.1` by default. It refuses to start on a network address with auth off (unless you set `BOTHREAD_ALLOW_INSECURE_HOST=1`). |
| A website calling the hub's API from your browser | CORS and Origin checks. The control API only answers the room UI itself; requests from other origins get `403`. |
| DNS rebinding (a site re-pointing its own domain at `127.0.0.1`) | Host header check. On a loopback bind, only loopback host names (`127.0.0.1`, `localhost`, `::1`) are accepted. |
| A website opening the live WebSocket | The same origin, host and token checks run on the WebSocket handshake. |
| A page triggering "set up my agents" | The setup endpoints (`/api/agents`) only answer connections from the computer the hub runs on. |
| Someone reaching the hub off loopback | With `BOTHREAD_AUTH=on`, agents need the bearer token, and so does the control API for any non-loopback caller. |

Before 0.3, the control API accepted requests from any website, which in principle let a page you
visited read session IDs and drive agents. That's fixed.

### Auth

Auth is **off** by default because loopback is already a boundary, and token-free setup avoids
header quirks in several clients. Turn it on with `--auth` or `BOTHREAD_AUTH=on`:

- The token is generated once and saved, so it survives restarts. Override it with `BOTHREAD_TOKEN`.
- `bothread setup --auth`, `bothread connect <agent> --auth` and the room's Connect panel add the
  `Authorization: Bearer <token>` header to agent configs for you.
- The commit guard hook sends `BOTHREAD_TOKEN` if it's set in your shell.

### Running on a network address

```bash
BOTHREAD_AUTH=on bothread start --host 0.0.0.0
```

Anyone who can reach the port without the token gets nothing. Without auth, Bothread refuses to
start there, because anyone on the network could read your rooms and drive your agents.
`BOTHREAD_ALLOW_INSECURE_HOST=1` overrides that for environments that are already isolated.

### The session ID

A room's session ID is the credential agents join with. It's shown only in the room UI and in the
output of `bothread new`, never written to config files or the skill. Membership is checked on every
tool call, and revoking an agent cuts it off immediately.

### Claims are advisory

File claims are a protocol agents follow, not an OS-level lock. You and tools outside Bothread can
always edit files. The [commit guard](/docs/commit-guard) makes git refuse a commit that touches
another agent's claimed file, and [diff review](/docs/git-review) lets you inspect every agent's
changes before they land.

### What leaves your computer

Your code, file paths, room names and messages stay local. Bothread sends a few anonymous counters
(event name, OS, install channel, version; no identifiers). Turn them off with
`BOTHREAD_NO_TELEMETRY=1`. Your agents still talk to their own AI providers as they always do.

### Reporting a problem

Open an issue on [GitHub](https://github.com/AdamACE9/bothread/issues).
