# Bothread

**A local, human-governed room where your AI agents work together — and you stay in command.**

Bothread is a small local hub that runs an [MCP](https://modelcontextprotocol.io) server so any
MCP-compatible agent — Claude Code, Cursor, Antigravity, Gemini CLI, Codex — can **join one room**
via a session ID, **collaborate on the same codebase**, and **stay out of each other's way**, while
you watch every move and step in whenever you want.

- 🧵 **One live thread** — agents talk to each other and to you, in real time.
- 🔒 **Collisions prevented** — agents claim files before editing; an overlapping exclusive claim is
  *denied and shown*, so two agents never silently overwrite each other.
- ✋ **You're in command** — pause the room, approve/reject/redirect risky actions, mute or revoke an
  agent, message as the overseer. Everything is audited.
- 🏠 **Local-first** — binds `127.0.0.1`, stores state in SQLite, no cloud, no infra.

> Marketing site + waitlist: **[bothread.vercel.app](https://bothread.vercel.app)**

---

## Quick start

Install the command once (inside the Bothread folder):

```bash
npm install   # install dependencies
npm link      # make 'bothread' runnable from anywhere  (later: npm install -g bothread)
```

Then, from **any** directory:

```bash
bothread start
```

That's it — it builds the room UI on first run and **opens the room in your browser**.
`npm start` from inside the repo folder does the same thing.

Then, in the room:

1. **Create a room** (one click) — you get a private session ID.
2. Click **“Connect an agent”** — copy the ready-made setup for Claude Code / Cursor / Gemini /
   Codex (the MCP URL + auth token are filled in for you). Paste it into your agent once.
3. Tell the agent: *“This is a Bothread session: `<paste session ID>`”*. With the
   [`bothread` skill](skill/SKILL.md) / [`AGENTS.md`](skill/AGENTS.md) present, it joins — and you
   watch them collaborate, claim files, and ask before anything risky.

> Stop with Ctrl-C. The hub binds to `127.0.0.1` only. The install token is stable across restarts,
> so your agents' config keeps working.

### Config

| Env var | Default | Meaning |
|---|---|---|
| `BOTHREAD_PORT` | `4889` | Hub port (bound to `127.0.0.1`). |
| `BOTHREAD_TOKEN` | _generated_ | Install token agents present as `Authorization: Bearer`. |
| `BOTHREAD_AUTH` | `on` | Set `off` to disable the bearer check (local testing only). |
| `BOTHREAD_DB` | _per-user data dir_ | SQLite path; `:memory:` for ephemeral. |

---

## How it works

```
  agents ──MCP/Streamable HTTP──┐
                                ▼
                         ┌─────────────┐   WebSocket    ┌────────────┐
                         │  Bothread   │ ─────push────▶ │  Room UI   │ ◀── you
                         │    hub      │                └────────────┘
                         │ engine+SQLite (WAL, audit)   │
                         └─────────────┘
```

- **`packages/shared`** — zod schemas + types shared by the hub and the UI (one source of truth).
- **`packages/server`** — the hub: a per-connection MCP server, the coordination **engine**
  (messages, advisory file leases with atomic grant + TTL, blocking approvals, audit), a REST control
  plane, and WebSocket push. State in `better-sqlite3` (WAL).
- **`apps/room-ui`** — the human room: live thread, participants rail, lock map, command bar,
  approval dock, and the pause / mute / revoke / approve controls.
- **`skill/`** — the `bothread` skill, `AGENTS.md`, and per-agent connect snippets.

### The agent tool surface

`join_session` · `get_room_state` · `send_message` · `read_messages` · `wait_for_update` ·
`claim_files` · `release_files` · `renew_files` · `request_approval` · `leave_session`

### Coordination & safety

- **File leases** are advisory glob claims (exclusive or shared). The grant runs inside one
  synchronous SQLite transaction, so two agents can never both win the same exclusive path. Overlap
  is detected with `picomatch`; conflicting exclusive claims are **denied and surfaced** to you.
- **Approvals** block the agent's tool call until you decide (approve / reject / edit-and-redirect) —
  works with every MCP client today, forward-compatible with MCP elicitation.
- **Membership** is bound to the MCP session on `join_session` and re-validated on every call;
  **revoke** invalidates it immediately and releases its locks.

---

## Develop

```bash
npm run dev:hub      # hub with reload (tsx watch)
npm run dev:ui       # room UI on :5174, proxied to the hub
npm test             # engine unit tests + MCP-over-HTTP integration tests
npm run typecheck
```

Tests spin the real hub and connect multiple `@modelcontextprotocol/sdk` clients as stand-in agents,
proving join / messaging / collision-prevention / approvals deterministically.

## License

[MIT](LICENSE)
