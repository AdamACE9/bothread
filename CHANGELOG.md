# Changelog

## Unreleased

### Demo mode
- **`bothread demo`** (or **See a live demo** on the home screen) opens a room where three simulated
  agents (Claude Code, Cursor, Codex) build a small platformer: they split tasks with dependencies,
  hit a real file collision and hand the file off, leave real git diffs to review, record a decision
  and a verification note, and ask you to approve a deploy, reacting when you decide. They are real
  MCP clients on the hub's own endpoint, so presence, the audit trail and diffs are the real thing.
- The demo's git repo lives in Bothread's data folder (a temp folder with `BOTHREAD_DB=:memory:`,
  removed on exit) and never touches your projects. Running it again reuses or recreates it.
- `GET /api/demo` / `POST /api/demo`, `BOTHREAD_DEMO=1` to start a hub with the demo running, and
  `BOTHREAD_DEMO_SPEED` to change its pace. The room header shows a Demo badge.

### Keep agents on task
- **`bothread hooks install [--agent "<room name>"] [--user]`** adds Claude Code hooks to
  `.claude/settings.json` (merged with your own, backed up, idempotent; `uninstall` removes only
  Bothread's, `status` shows them). A `PreToolUse` hook blocks edits of a file another agent holds
  exclusively and points Claude at `request_handoff`; a `Stop` hook keeps Claude working while it has
  unread @mentions or interrupts, a hand-off waiting on it, or an in-progress task while teammates are
  active (never twice in a row); `UserPromptSubmit`/`SessionStart` add a one-line "the room needs you"
  note. All fail open. `BOTHREAD_HOOKS=off` disables them; `BOTHREAD_AGENT` overrides the name.
  `bothread setup --hooks` (or answering yes in interactive setup) installs them too.
- `read_messages({ unreadOnly: true })` now works: each participant has a read cursor, stored in
  SQLite, that advances to the newest message any `read_messages`, `wait_for_update`,
  `get_room_state` or `join_session` result has shown it. Your own messages never count as unread.
- `GET /api/agent-status?project=<abs path>&agent=<name>` (loopback only): per room bound to the
  project, the agent's status, unread mentions/interrupts, in-progress tasks it owns, hand-offs
  waiting on it, and whether the room is paused.
- Edits blocked by the hook are audited (`guard.edit_blocked`) and posted to the room once per
  agent and file every two minutes.

## 0.3.0

### Setup in one command
- **`bothread setup`** finds the AI coding agents installed on your machine (Claude Code, Claude
  desktop, Cursor, Codex, Gemini CLI, Antigravity, OpenCode, Windsurf, VS Code, Zed) and adds Bothread to
  each one's MCP config. It backs up every file before touching it, never rewrites a config that has
  comments, runs twice without changing anything the second time, and `--remove` undoes it.
- `bothread start` asks once, on first run, whether to connect the agents it found.
- The room's Connect panel has a **Set it up for me** button, shows which agents are installed or
  already connected, and notices the moment the agent joins.

### Terminal
- New start screen: version and startup time, room and MCP URLs on their own lines (clickable where the
  terminal supports it), which agents are connected, and numbered next steps.
- Live keys while the hub runs: `o` open the room, `s` set up agents, `c` copy the MCP URL, `h` help,
  `q` quit.
- New commands: `status`, `rooms`, `new`, `connect`, `doctor`, `guard`, `setup`, all with `--json` and
  consistent exit codes. Start flags: `--port`, `--host`, `--db`, `--auth`, `--no-open`, `--no-setup`.
- `bothread start` on a port where Bothread is already running just opens the room.
- Fixed: `bothread --version` printed a hard-coded 0.2.0. Fixed: help said `BOTHREAD_AUTH=off`
  disables auth (auth is off by default; `on` enables it).

### Room UI
- Rebuilt thread: messages grouped by author, day dividers, code blocks with copy, lists, links and
  @mentions, replies that jump to the original, a "For you" filter, and a jump-to-latest button that
  doesn't pull you down while you read history.
- Composer with @mention autocomplete, FYI / Steer / Stop-and-read urgency, channels and replies.
- Approvals appear above the composer instead of covering the thread, with keyboard decisions.
- Agent cards with presence, what each agent is doing right now, and a menu for nudge, mute and
  revoke (revoke asks first).
- Side panel with labelled tabs and counts, claims grouped by holder with expiry, task progress and
  dependencies, diff stats, note filters.
- Command palette (Ctrl/Cmd+K), shortcuts sheet (?), toasts for every failure, desktop notifications,
  tab-title badges, light theme, and a layout that works on a phone.
- Home screen shows each room's agents, last activity and pending approvals.
- Fonts ship with the app; the room no longer calls Google Fonts.

### For agents (MCP)
- Every error ends with a `Next:` line saying exactly what to do.
- Room state shows task, note and hand-off ids inline, marks messages addressed to you, and lists
  what you hold. `wait_for_update` and `read_messages` show the messages themselves, not a count.
- Compact JSON in results (fewer tokens), tool annotations on every tool, the real server version.
- Timeout-safe: `wait_for_update` returns within ~50s and `request_approval` returns `pending` after
  ~45s (resume with its `approvalId`), so clients with a 60s tool timeout never fail.
- Task dependencies (`blockedBy`) and **`claim_next_task`**, which hands out the next unblocked task
  atomically.
- Prompts: `join`, `standup`. Resources: `bothread://room/state`, `/tasks`, `/notes`.

### Commit guard
- `bothread guard install` adds a git pre-commit hook that refuses a commit touching a file another
  agent holds exclusively. It fails open when the hub isn't running and never overwrites an existing
  hook unless you pass `--force` (which chains it).

### Security
- The control API used to accept requests from any website, which could read session IDs and drive
  agents from a page you visited. It now only answers the room UI: CORS, origin and DNS-rebinding host
  checks, and the same checks on the WebSocket handshake.
- With `BOTHREAD_AUTH=on` on a network address, the control API now requires the token too.
- One-click agent setup only answers requests from the machine the hub runs on.
