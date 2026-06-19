<div align="center">

# 🧵 Bothread

### Run the AI coding agents you already use — together, on one codebase. Local, MCP-native, you in command.

<sub>A free, open-source local app. **No API keys, no cloud.** &nbsp;·&nbsp; Not affiliated with the embroidery brand "Brothread".</sub>

[![License: MIT](https://img.shields.io/badge/License-MIT-e2a94c.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-end--to--end-3178c6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-cf7a3c.svg)](https://modelcontextprotocol.io)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-63ad8f.svg)](#contributing)

**[Website](https://bothread.vercel.app) · [Get started](https://bothread.vercel.app/start) · [The skill](skill/)**

![The Bothread room](docs/room.png)

</div>

---

Run more than one coding agent and it gets painful fast: they can't talk to each other, they open the
same file and silently overwrite each other's work, and the little coordination that exists happens
invisibly in terminals. **Bothread** is the missing piece — a small local hub that runs an
[MCP](https://modelcontextprotocol.io) server so any MCP-compatible agent (Claude Code, Cursor,
Antigravity, Gemini CLI, Codex) can **join one room**, **collaborate on the same codebase**, and
**stay out of each other's way**, while you watch every move and step in whenever you want.

- 🧵 **One live thread** — agents talk to each other and to you, in real time.
- 🔒 **Collisions prevented** — agents claim files before editing; an overlapping exclusive claim is
  *denied and shown*, so two agents never silently clobber each other.
- 🌿 **Per-agent git diffs** — point a room at a git repo and each agent's changes between claiming and
  releasing files are captured as a reviewable diff. **Merge** it, **discard** it, or **keep only the
  hunks you want** — and your own uncommitted edits are never reverted. Automatic and opt-in (off unless
  the room has a git project folder).
- ✋ **You're in command** — pause the room, approve / reject / redirect risky actions, mute or revoke
  an agent, message as the overseer. Everything is audited.
- 🏠 **Local-first** — binds `127.0.0.1`, stores state in SQLite, no cloud, no account.

---

## Quick start

Clone it and make the `bothread` command available everywhere:

```bash
git clone https://github.com/AdamACE9/bothread.git
cd bothread
npm install   # install dependencies (one time)
npm link      # make 'bothread' runnable from anywhere
```

Then, from **any** directory:

```bash
bothread start
```

It builds the room UI on first run and **opens the room in your browser**. Stop with `Ctrl-C`.

> **Coming soon:** a zero-install `npx bothread start` (and `npm install -g bothread`) once the package
> is published to npm. Until then, use the clone + `npm link` steps above.

> **No git?** On GitHub click **Code → Download ZIP**, unzip it, and open a terminal in the folder.
> **`bothread` not found after `npm link`?** Just run **`npm start`** in the folder — same result, no global command needed.
>
> Requirements: [Node.js](https://nodejs.org) 20+ (`node -v` to check) and an MCP agent (Claude Code, Antigravity, Cursor, …).

| Env var | Default | Meaning |
|---|---|---|
| `BOTHREAD_PORT` | `4889` | Hub port (bound to `127.0.0.1`). |
| `BOTHREAD_AUTH` | `off` | Token-free on `127.0.0.1` by default. Set `on` to require a bearer token. |
| `BOTHREAD_TOKEN` | _persisted_ | When auth is on, the bearer token (auto-generated + saved, stable across restarts). |
| `BOTHREAD_DB` | _per-user data dir_ | SQLite path; `:memory:` for ephemeral. |
| `BOTHREAD_NO_OPEN` | — | Set to skip auto-opening the browser. |

## Connect your agents

In the room, click **“Connect an agent.”** The panel gives you copy-paste setup for each agent with
the MCP URL **already filled in**. You add Bothread to each agent once; then tell it
*“This is a Bothread session: `<session ID>`”* and it joins. (The hub is token-free on `127.0.0.1`
by default; with `BOTHREAD_AUTH=on` the panel also fills in the `Authorization` header.)

| Agent | Add-server config | Native remote HTTP |
|---|---|---|
| **Claude Code** (CLI) | `claude mcp add --transport http bothread <url>` | ✅ |
| **Claude desktop app** | `claude_desktop_config.json` → `npx mcp-remote <url>` bridge (Settings → Developer → Edit Config) | bridge |
| **Antigravity** | `~/.gemini/config/mcp_config.json` → `serverUrl` | ✅ |
| **Cursor** | `.cursor/mcp.json` → `url` | ✅ |
| **Gemini CLI** | `~/.gemini/settings.json` → `httpUrl` | ✅ |
| **Codex** | `~/.codex/config.toml` → `url` | ✅ |
| Others / stdio-only | bridge via `npx mcp-remote <url>` | ⚠️ via bridge |

> **Claude desktop app note:** the **"Add custom connector"** URL box is *cloud-brokered* — it can't
> reach a `localhost` hub. So a local Bothread goes in `claude_desktop_config.json` via the `mcp-remote`
> bridge; after a restart it shows up in the **+ → Connectors** menu as a toggle (like Blender does).
> The "Connect an agent" panel gives you the exact JSON. *(Claude Code's CLI is the simpler local path —
> one `claude mcp add` line, no bridge.)*

Raw snippets: [`skill/mcp-config-examples`](skill/mcp-config-examples/README.md).

> **Windows / Claude Code:** the hub listens on **both `127.0.0.1` and `localhost`** (IPv4 + IPv6
> loopback) and is **token-free by default**, so `claude mcp add --transport http bothread http://127.0.0.1:4889/mcp`
> works without header quirks. If a server shows as *failed*, make sure `bothread start` is running
> first, then add it and verify with `claude mcp list`. HTTP transport is native — no `mcp-remote` bridge needed.

## Install the skill (teach agents the etiquette)

The MCP server gives agents the *tools*; the **skill** gives them the *manners* — claim before
editing, hand off tasks, coordinate on collisions.

**Easiest — one command (the agent can run it itself):**

```bash
npx skills add AdamACE9/bothread -y
```

That uses the [`skills`](https://github.com/vercel-labs/skills) CLI to fetch this repo's skill and install
it into your agent's config (`.claude/skills/…`), auto-detecting the agent. No manual download.

**Other ways:**
- **Claude (web / desktop app):** download **[`bothread-skill.zip`](https://bothread.vercel.app/bothread-skill.zip)**
  → **Settings → Capabilities → Skills → Create skill → upload it**.
- **Manual:** copy [`skill/bothread`](skill/bothread) into `.claude/skills/`, or put
  [`skill/AGENTS.md`](skill/AGENTS.md) in your project root (Cursor / Antigravity / Codex).

Full details: [`skill/README.md`](skill/README.md).

## The agent tool surface

`join_session` · `get_room_state` · `send_message` · `read_messages` · `wait_for_update` ·
`claim_files` · `release_files` · `renew_files` · `request_approval` · `leave_session`

Every call returns a clean structured result plus a readable summary, so an agent instantly understands
the room.

## How it works

```
  agents ──MCP / Streamable HTTP──┐
                                  ▼
                           ┌──────────────┐    WebSocket     ┌────────────┐
                           │  Bothread    │ ──── push ─────▶ │  Room UI   │ ◀── you
                           │     hub      │                  └────────────┘
                           │  engine + SQLite (WAL, audit)   │
                           └──────────────┘
```

- **`packages/shared`** — zod schemas + types shared by the hub and the UIs (one source of truth).
- **`packages/server`** — the hub: a per-connection MCP server, the coordination **engine** (durable
  message thread, advisory file leases with atomic grant + TTL, blocking approvals, append-only audit),
  a REST control plane, and WebSocket push. State in `better-sqlite3` (WAL).
- **`apps/room-ui`** — the human room: live thread, participants rail, lock map, command bar, approval
  dock, and the pause / mute / revoke / approve controls.
- **`skill/`** — the `bothread` Agent Skill, `AGENTS.md`, and per-agent connect snippets.
- **`website/`** — the marketing site + Get Started guide ([bothread.vercel.app](https://bothread.vercel.app)).

### Coordination & safety

- **File leases** are advisory glob claims (exclusive or shared). The grant runs inside one synchronous
  SQLite transaction, so two agents can never both win the same exclusive path. Overlap is detected
  with `picomatch`; conflicting exclusive claims are **denied and surfaced** to you.
- **Per-agent git diffs** add a review checkpoint over the advisory-lease "ghost overwrite" gap. When a room is pointed at a
  git repo (set its project folder when you create the room), the hub snapshots the claimed paths'
  working-tree state at claim time (a git tree built through a temporary index — **not** worktrees, so
  your working tree is untouched), then diffs against it at release. Because the baseline is the
  claim-time snapshot, **your own pre-existing uncommitted edits are never reverted** — only the agent's
  changes are. The room UI's **Changes** tab shows each agent's diff hunk-by-hunk: **Merge all**,
  **Discard all**, or tick the hunks you want and **Apply N selected** (it reverts to the baseline and
  re-applies just those via `git apply`). Fully automatic — agents call no extra tools — and entirely
  optional: if the room has no project folder or it isn't a git repo, the feature is simply inactive.
- **Approvals are opt-in** — off by default (each agent's own app already gates risky actions). Enable
  per room (`requireApprovalFor`) for one in-room checkpoint; then `request_approval` blocks the agent's
  call until you decide (approve / reject / edit-and-redirect). Works with every MCP client.
- **Membership** binds to the MCP session on `join_session` and is re-validated on every call;
  **revoke** invalidates it immediately and releases its locks.

## Develop

```bash
npm run dev:hub      # hub with reload (tsx watch)
npm run dev:ui       # room UI on :5174, proxied to the hub
npm test             # engine unit tests + MCP-over-HTTP integration tests
npm run typecheck    # all packages
```

Tests spin the real hub and connect multiple `@modelcontextprotocol/sdk` clients as stand-in agents,
proving join / messaging / collision-prevention / approvals deterministically (no paid subscriptions
needed).

## Project structure

```
bothread/
├─ packages/shared      # zod data model (Room, Participant, Message, Lease, Approval, …)
├─ packages/server      # the local MCP hub (engine, MCP transport, REST, WebSocket)
├─ apps/room-ui         # the human-in-command room (React + Vite)
├─ skill/               # the bothread skill + AGENTS.md + connect snippets
├─ website/             # marketing site + Get Started guide
└─ bin/bothread.mjs     # the `bothread` CLI
```

## Contributing

Issues and PRs are welcome. Bothread is TypeScript end-to-end; run `npm test` and `npm run typecheck`
before opening a PR. If your agent doesn't connect or behaves oddly, please open an issue with the
agent name and what happened — broad client coverage is a core goal.

## License

[MIT](LICENSE) © Adam Ahmed
