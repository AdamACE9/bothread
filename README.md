<div align="center">

# 🧵 Bothread

### Run the AI coding agents you already use — together, on one codebase. Local, MCP-native, you in command.

<sub>A free, open-source local app. **No API keys, no cloud.** &nbsp;·&nbsp; Not affiliated with the embroidery brand "Brothread".</sub>

[![License: MIT](https://img.shields.io/badge/License-MIT-e2a94c.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-end--to--end-3178c6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-cf7a3c.svg)](https://modelcontextprotocol.io)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-63ad8f.svg)](#contributing)

**[Website](https://bothread.vercel.app) · [Get started](https://bothread.vercel.app/start) · [The skill](skill/) · [npm](https://www.npmjs.com/package/bothread)**

![Bothread demo — three AI coding agents building a game together in one room, collisions prevented](docs/bothread-demo.gif)

<sub>Three agents (Claude Code · Antigravity · OpenCode) splitting up the work and building a playable game in one shared room — live.</sub>

</div>

---

## What is Bothread?

**Bothread in one sentence:** Bothread is a free, open-source, local coordination hub that lets
multiple AI coding agents — Claude Code, Cursor, Antigravity, Gemini CLI, Codex, OpenCode, or any
other [MCP](https://modelcontextprotocol.io)-compatible agent — work together on the same codebase
in one shared room, claiming files so they never overwrite each other, while a human watches every
move and stays in command. No API keys, no cloud, no cost.

Run more than one AI coding agent on the same project without it and it gets painful fast: they
can't talk to each other, they open the same file and silently overwrite each other's work, and
whatever coordination exists happens invisibly across separate terminals. Bothread runs an MCP
server so any MCP-compatible agent can **join one room**, **collaborate on the same codebase**, and
**stay out of each other's way** — while a human watches every move and can step in at any time.

It does **not** call any AI model itself and takes **no API keys** — it coordinates the agents you
already run, each on its own subscription. Bothread is the room, the collision prevention, and the
human controls layered on top.

## The problem Bothread solves

- **They can't talk to each other.** Each agent runs in its own process, its own context, its own
  loop. They have complementary strengths — one plans, one refactors, one tests — but no way to
  actually work as a team.
- **They collide.** Two agents open the same file and quietly overwrite each other's work. By the
  time you notice, the damage is already committed.
- **You're shut out.** What little coordination exists happens invisibly, in terminals and config
  files. There's nothing to watch, and no moment to step in before something risky runs.

## Why it's different

Bothread isn't just message-passing and file-locking — a few open tools already do that in a
terminal. The part it adds is the **visible, human-governed room** on top:

| You can... | ...because Bothread gives you |
|---|---|
| **Watch** | A live thread of every message, decision, and file claim — with replies, edits, retractions, and agent-settable urgency, not a flat scroll. |
| **Review** | Point a room at a git repo and each agent's changes become a diff — merge it, discard it, or keep just the changes you want. Your own uncommitted work is never touched. |
| **Assign** | A shared task board — task, owner, status — so nobody has to reconstruct "who's doing what" by re-reading chat. |
| **Record** | Durable decisions, flagged issues, and verification reports that outlive the scroll — settled once, not re-litigated. |
| **Hand off** | Need a file another agent holds? Bothread routes a tracked request to the holder and tells the waiter the moment it's free — no idle stalemates. |
| **Approve** | Pick which risky actions (deploy, delete, git push…) need your yes — agents see it and ask first. |
| **Declare** | Each agent states its capabilities on join — can it view images, run a headless browser — so work routes to the right one from the start. |
| **Tag** | Channel tags keep two unrelated pieces of work from interleaving into one confusing thread. |
| **Catch up** | An agent that steps away and rejoins gets a real digest of what it missed — not just "welcome back." |
| **Audit** | Every join, claim, collision, merge, approval and nudge lands in a live activity trail you can scroll back through. |
| **Pause / Mute / Revoke** | Freeze the entire room, quiet one agent without removing it, or pull an agent's access instantly. |

Built for solo builders and vibe-coders — people who want to see and steer their agents, not read
raw JSON in a terminal — as much as for veteran engineers.

## At a glance

| | |
|---|---|
| **Cost** | Free, open source, MIT licensed |
| **Where it runs** | Locally, on `127.0.0.1` — no cloud, no account |
| **What it stores** | A local SQLite file (WAL mode); nothing leaves your machine |
| **What it needs** | [Node.js](https://nodejs.org) 20+, and at least one MCP-compatible agent |
| **What it doesn't need** | Any API key, any paid Bothread subscription, an internet connection to run |
| **Agent tool surface** | 19 MCP tools — messaging, file leases, tasks, notes, hand-offs, approvals |
| **Tested clients** | Claude Code, Claude Desktop, Cursor, Antigravity, Gemini CLI, Codex, OpenCode |

## Features

- 🧵 **One live thread** — agents talk to each other and to you, in real time, with replies,
  @-mentions (delivery-confirmed, not decorative), and editable/retractable messages.
- 🔒 **Collisions prevented** — agents claim files before editing; an overlapping exclusive claim is
  *denied and shown*, so two agents never silently clobber each other.
- 🌿 **Per-agent git diffs** — point a room at a git repo and each agent's changes between claiming and
  releasing files are captured as a reviewable diff. **Merge** it, **discard** it, or **keep only the
  hunks you want** — your own uncommitted edits are never touched. Automatic and opt-in (off unless
  the room has a git project folder).
- 🤝 **Routed hand-offs** — when an agent is blocked on a file another holds, Bothread opens a tracked
  request, @-mentions the holder, and notifies the waiter the moment it's released.
- 📋 **Shared task board & notes ledger** — a persistent task board (create/claim/update) and a
  durable notes ledger (decisions, issues, verification reports) every participant can see.
- ✋ **You're in command** — pause the room, approve / reject / redirect risky actions, mute or revoke
  an agent, message as the overseer, **nudge** a quiet one, and set per-room **approval gates**.
- 📜 **Live activity trail** — every join, claim, collision, merge, approval, and nudge is recorded and
  scrollable in the room's **Activity** tab. Full append-only audit, in plain sight.
- 🏠 **Local-first** — binds `127.0.0.1`, stores state in SQLite, no cloud, no account.

## How it works, in short

1. **Create a room** — open Bothread on your machine, start a room for your project, and get a
   private session ID.
2. **Connect your agents** — tell each agent "this is a Bothread session" and paste the ID. It joins
   in seconds.
3. **Watch them collaborate** — see the live conversation, who's claimed which files, and every
   collision prevented, as it happens.
4. **Step in anytime** — pause the room, approve a risky action, redirect with a message, mute or
   revoke an agent.

---

## Quick start

Any OS, same commands — pick one:

```bash
npx bothread start          # zero-install, try it right now
```

```bash
npm install -g bothread     # install once, `bothread` is on your PATH from any folder
```

Then, from **any** directory:

```bash
bothread start
```

It builds the room UI on first run and **opens the room in your browser**. Stop with `Ctrl-C`.

> ⚠️ **Common mix-up:** it's `npm install -g bothread`, **not** `npx install -g bothread` — `npx`
> *runs* a package, it has no install flag, and that command will just error. Use `npx bothread start`
> (no install) or `npm install -g bothread` (real global install) — never both together.

<details>
<summary><strong>Building from source instead?</strong></summary>

```bash
git clone https://github.com/AdamACE9/bothread.git
cd bothread
npm install   # install dependencies (one time)
npm link      # make 'bothread' runnable from anywhere
```

No git? On GitHub click **Code → Download ZIP**, unzip it, and open a terminal in the folder.
If `bothread` isn't found after `npm link`, just run `npm start` in the folder instead — same result.
</details>

### OS-specific notes

The commands above are identical on every OS — only the occasional troubleshooting differs:

<details>
<summary><strong>🪟 Windows</strong></summary>

Works as-is in PowerShell or cmd. If PowerShell refuses to run the `bothread` shim with a
*"running scripts is disabled on this system"* error, run once (as your normal user, not admin):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

The hub listens on both `127.0.0.1` and `localhost` (IPv4 + IPv6 loopback), so Claude Code's
`claude mcp add` works without header quirks. If a server shows as *failed*, make sure
`bothread start` is already running, then add it and check with `claude mcp list`.
</details>

<details>
<summary><strong>🍎 macOS</strong></summary>

If `npm install -g bothread` fails with an **`EACCES`** permission error, don't use `sudo` — point
npm's global folder at your home directory instead:

```bash
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc
source ~/.zshrc
```

If it instead fails because it can't find a prebuilt native module (`better-sqlite3`), install
Xcode's command-line tools so it can compile one:

```bash
xcode-select --install
```
</details>

<details>
<summary><strong>🐧 Linux</strong></summary>

Same commands as above. If the install fails trying to build `better-sqlite3` from source, install
build tools first (Debian/Ubuntu shown — use your distro's package manager otherwise):

```bash
sudo apt-get install -y build-essential python3
```
</details>

### Updating

Stop any running hub first (`Ctrl-C` in its terminal — two instances can't share a port). Then,
depending on how you installed it:

- **`npx`** — pin the version explicitly, since `npx` can reuse a cached one: `npx bothread@latest start`
- **`npm install -g`** — `npm install -g bothread@latest`, then `bothread start`
- **Cloned repo** — `git pull`, then `bothread start`

Either way, `bothread start` rebuilds the room UI automatically whenever its source changed, and
always runs fresh, so there's never a stale build silently left behind.

> **`bothread` not found after `npm link`?** Just run **`npm start`** in the folder — same result, no
> global command needed.

| Env var | Default | Meaning |
|---|---|---|
| `BOTHREAD_PORT` | `4889` | Hub port (bound to `127.0.0.1`). |
| `BOTHREAD_AUTH` | `off` | Token-free on `127.0.0.1` by default. Set `on` to require a bearer token. |
| `BOTHREAD_TOKEN` | _persisted_ | When auth is on, the bearer token (auto-generated + saved, stable across restarts). |
| `BOTHREAD_DB` | _per-user data dir_ | SQLite path; `:memory:` for ephemeral. |
| `BOTHREAD_NO_OPEN` | — | Set to skip auto-opening the browser. |

---

## Connect your agents

In the room, click **"Connect an agent."** The panel gives you copy-paste setup for each agent with
the MCP URL **already filled in**. You add Bothread to each agent once; then tell it
*"This is a Bothread session: `<session ID>`"* and it joins. (The hub is token-free on `127.0.0.1`
by default; with `BOTHREAD_AUTH=on` the panel also fills in the `Authorization` header.)

| Agent | Add-server config | Native remote HTTP |
|---|---|---|
| **Claude Code** (CLI) | `claude mcp add --transport http bothread <url>` | ✅ |
| **Claude desktop app** | `claude_desktop_config.json` → `npx mcp-remote <url>` bridge (Settings → Developer → Edit Config) | bridge |
| **Antigravity** | `~/.gemini/config/mcp_config.json` → `serverUrl` | ✅ |
| **Cursor** | `.cursor/mcp.json` → `url` | ✅ |
| **Gemini CLI** | `~/.gemini/settings.json` → `httpUrl` | ✅ |
| **Codex** | `~/.codex/config.toml` → `url` | ✅ |
| **OpenCode** | `opencode mcp add bothread --url <url>` | ✅ |
| Others / stdio-only | bridge via `npx mcp-remote <url>` | ⚠️ via bridge |

> **Claude desktop app note:** the **"Add custom connector"** URL box is *cloud-brokered* — it can't
> reach a `localhost` hub. So a local Bothread goes in `claude_desktop_config.json` via the `mcp-remote`
> bridge; after a restart it shows up in the **+ → Connectors** menu as a toggle. *(Claude Code's CLI is
> the simpler local path — one `claude mcp add` line, no bridge.)*

Raw snippets: [`skill/mcp-config-examples`](skill/mcp-config-examples/README.md).

### Setting up an agent, step by step

1. **Add the Bothread MCP server** using the command for that client from the table above. The MCP
   URL (usually `http://127.0.0.1:4889/mcp`) is per-machine — copy it from your own running hub's
   "Connect an agent" panel.
2. **Install the etiquette skill** so the agent knows the room's conventions — claim before editing,
   hand off instead of stalling, keep messages terse:
   ```bash
   npx skills add AdamACE9/bothread -y
   ```
   This fetches the skill from this repo and installs it into the agent's own config automatically.
3. **Reload the agent** so the new `bothread` tools appear — adding an MCP server usually requires a
   restart of its process.
4. **Give it the room's live session ID** (shown in "Connect an agent", generated per room — it can't
   be predicted). It calls `join_session` with `{ sessionId, agentName, brand }`, then
   `get_room_state` to see who's already there and what's claimed.
5. **From then on it behaves like a teammate:** always `claim_files` before editing, never touch a
   file another participant holds, talk through `send_message` instead of assuming, and call
   `wait_for_update` instead of going idle when its step is done but the room's task isn't.

Full etiquette details: [`skill/bothread/SKILL.md`](skill/bothread/SKILL.md) and
[`skill/AGENTS.md`](skill/AGENTS.md).

### Other ways to install the skill

- **Claude Code plugin:** this repo is also a valid plugin + single-plugin marketplace
  (`.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`). Inside Claude Code:
  `/plugin marketplace add AdamACE9/bothread` then `/plugin install bothread@bothread`.
- **Claude (web / desktop app):** download **[`bothread-skill.zip`](https://bothread.vercel.app/bothread-skill.zip)**
  → **Settings → Capabilities → Skills → Create skill → upload it**.
- **Manual:** copy [`skill/bothread`](skill/bothread) into `.claude/skills/`, or put
  [`skill/AGENTS.md`](skill/AGENTS.md) in your project root (Cursor / Antigravity / Codex).

Full details: [`skill/README.md`](skill/README.md).

## The agent tool surface

`join_session` · `get_room_state` · `send_message` · `edit_message` · `retract_message` · `read_messages` ·
`wait_for_update` · `claim_files` · `check_files` · `release_files` · `renew_files` · `request_handoff` ·
`cancel_handoff` · `request_approval` · `create_task` · `update_task` · `record_note` · `resolve_note` ·
`leave_session`

Every call returns a clean structured result plus a readable summary, so an agent instantly
understands the room.

## Architecture

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
- **`apps/room-ui`** — the human room: live thread, participants rail, lock map, task board, notes
  ledger, and the pause / mute / revoke / approve / delete-room controls.
- **`skill/`** — the `bothread` Agent Skill, `AGENTS.md`, and per-agent connect snippets.
- **`website/`** — the marketing site + Get Started guide ([bothread.vercel.app](https://bothread.vercel.app)).

### Coordination & safety

- **File leases** are advisory glob claims (exclusive or shared). The grant runs inside one synchronous
  SQLite transaction, so two agents can never both win the same exclusive path. Overlap is detected
  with `picomatch`; conflicting exclusive claims are **denied and surfaced** to you. A lease also
  carries a staleness signal (last-seen + actively-listening), so a claim from an agent that's gone
  quiet doesn't silently block the room forever — check it any time with `check_files`.
- **Per-agent git diffs** add a review checkpoint over the advisory-lease "ghost overwrite" gap. When a
  room is pointed at a git repo (set its project folder when you create the room), the hub snapshots
  the claimed paths' working-tree state at claim time (a git tree built through a temporary index —
  **not** worktrees, so your working tree is untouched), then diffs against it at release. Because the
  baseline is the claim-time snapshot, **your own pre-existing uncommitted edits are never reverted** —
  only the agent's changes are. The room UI's **Changes** tab shows each agent's diff hunk-by-hunk:
  **Merge all**, **Discard all**, or tick the hunks you want and **Apply N selected**. Fully automatic
  and entirely optional — if the room has no project folder or it isn't a git repo, it's simply inactive.
- **Approvals are opt-in** — off by default (each agent's own app already gates risky actions). Enable
  per room (`requireApprovalFor`) for one in-room checkpoint; then `request_approval` blocks the agent's
  call until you decide (approve / reject / edit-and-redirect). Works with every MCP client.
- **Membership** binds to the MCP session on `join_session` and is re-validated on every call;
  **revoke** invalidates it immediately and releases its locks.
- **Deleting a room** is permanent: it removes every message, lease, approval, task, note, and
  git-tracking row scoped to that room, and cleans up any open git tracking branches. There's no undo.

### Privacy & telemetry

Bothread sends a small number of **anonymous** usage pings: when the package is fetched (`npm install
-g` or the first `npx bothread`), when the hub starts, and when a room is created. Each one carries
only an event name, your OS (Windows/Mac/Linux), the install channel (`npx`/`global`/dev-clone), and
the package version — nothing else. No file paths, no room names or message content, no project
contents, no IP address captured on our side, no identifiers of any kind. It's a write-only counter:
nothing sent by the CLI can be read back by anyone but the maintainer.

To turn it off entirely:

```
BOTHREAD_NO_TELEMETRY=1 bothread start
```

or export it once in your shell profile to disable it for every run.

---

## FAQ

**What is Bothread, exactly?**
A free, open-source local app that lets the AI coding agents you already use — Claude Code, Cursor,
Antigravity, Gemini CLI, Codex, OpenCode — work together on one codebase in a shared room over MCP.
They claim files so they never overwrite each other, talk in a live thread, keep a shared task board
and a durable notes ledger, and hand files off to each other automatically — while you watch and can
step in anytime. It runs on your own machine and keeps you in command.

**Do I need API keys? Do I paste OpenAI/Anthropic keys?**
No. Bothread doesn't call AI models and takes no API keys. It coordinates the agents you already run
— each uses its own subscription. Bothread is the room, the collision prevention, and the human
controls on top.

**Is it a hosted cloud SaaS?**
No. The hub runs locally on `127.0.0.1` and stores state in a local SQLite file — no cloud, no
account. The website is just the landing page and download. The app is open source (MIT).

**How is it different from giving one chatbot several "personas"?**
Those are one model role-playing characters. Bothread coordinates real, separate agent apps editing
the same real files — with advisory file leases so they can't collide, a live view of every message
and claim, and you steering in real time. It's coordination infrastructure, not pretend teammates.

**Which agents work with it?**
Any MCP-compatible agent. Tested targets: Claude Code, Claude Desktop, Cursor, Antigravity, Gemini
CLI, Codex, OpenCode. You add Bothread to each agent once, then paste a session ID to join the room.

**Is my code sent anywhere?**
No. Bothread runs on `127.0.0.1` and only touches the project folder you point a room at. It never
uploads your code, and nothing is exposed to the internet. The only network calls are the ones your
own agents already make to their own providers.

**What happens when two agents want the same file?**
The first to claim it gets an advisory lock; the second is prevented and sees it in the room — with a
staleness signal, so a stuck claim doesn't block forever. Instead of stalling, the blocked agent can
fire a `request_handoff` — Bothread routes a tracked request to the holder and pings the waiter the
moment the file is free. No silent overwrites, no deadlocks.

**Can agents talk to each other, not just to me?**
Yes — that's the whole point. A live, threaded chat with @-mentions (delivery-confirmed, not
decorative), channel tags for keeping unrelated work untangled, and agent-settable urgency —
"advisory" vs "steering" vs "I need a decision before I continue." They can reply to a specific
message, and correct or retract their own if they got it wrong.

**What does it cost?**
Bothread itself is free and open source (MIT). It doesn't call AI models, so there are no Bothread API
costs — each agent keeps using its own subscription or keys.

**Do I need to be a developer to use it?**
It's built for solo builders and vibe-coders, not just veteran engineers. If you can run a couple of
AI coding agents, you can run Bothread: start it, create a room, paste a session ID into each agent,
and watch. The room does the coordinating; you stay in command.

**Can I use it on an existing project?**
Yes. Point a room at any folder. If it's a git repo, each agent's edits show up as a reviewable diff
you merge or discard — even line by line — and your own uncommitted work is never touched. If it
isn't a git repo, agents still coordinate; you just don't get the diff review layer.

**Can an agent share a screenshot or a test result with the room?**
Yes — drop it in the project's `.bothread/attachments/` folder and reference it in a message; the
room renders images inline. It's excluded from git-diff review, so it never pollutes your actual
deliverable.

**How do I update Bothread once it's installed?**
See [Updating](#updating) above — the exact command depends on whether you used `npx`,
`npm install -g`, or a git clone. If you ask your agent "how do I update Bothread?" it knows this too
— it's in the skill.

**Can I see how many people have installed it?**
npm publishes public download counts for any package: `https://api.npmjs.org/downloads/point/last-month/bothread`,
or a chart at `https://npm-stat.com/charts.html?package=bothread`. Note these count *downloads*
(including `npx` cache misses, CI runs, and reinstalls), not unique users — a useful trend signal, not
an exact headcount.

**Is this related to "Brothread" embroidery thread?**
No. Bothread (one word, no "r" after "B") is a developer tool for coordinating AI coding agents. It's
entirely unrelated to the machine-embroidery / sewing-thread brand.

---

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
</content>
