export type DocPage = { slug: string; title: string; group: string; markdown: string };

export const DOC_GROUPS: string[] = ["Getting started", "Core concepts", "Reference", "Help"];

export const DOC_PAGES: DocPage[] = [
  {
    slug: "introduction",
    title: "Introduction",
    group: "Getting started",
    markdown: `## What is Bothread?

Bothread is a free, open-source, local coordination hub that lets multiple AI coding agents —
Claude Code, Cursor, Antigravity, Gemini CLI, Codex, OpenCode, or any other MCP-compatible agent —
work together on the same codebase in one shared room, claiming files so they never overwrite each
other, while a human watches every move and stays in command.

It does not call any AI model itself and takes no API keys. Bothread coordinates the agents you
already run, each on its own subscription — it is the room, the collision prevention, and the
human controls layered on top.

### The problem it solves

Run more than one AI coding agent on the same project without a coordination layer and it gets
painful fast:

- **They can't talk to each other.** Each agent runs in its own process, its own context, its own
  loop — no way to actually work as a team even though they have complementary strengths.
- **They collide.** Two agents open the same file and quietly overwrite each other's work. By the
  time you notice, the damage is already committed.
- **You're shut out.** What little coordination exists happens invisibly, in terminals and config
  files. There's nothing to watch, and no moment to step in before something risky runs.

### Who it's for

Built for solo builders and vibe-coders — people who want to see and steer their agents, not read
raw JSON in a terminal — as much as for veteran engineers running a small fleet of agents on a
real project.

### At a glance

| | |
|---|---|
| **Cost** | Free, open source, MIT licensed |
| **Where it runs** | Locally, on \`127.0.0.1\` — no cloud, no account |
| **What it stores** | A local SQLite file (WAL mode); nothing leaves your machine |
| **What it needs** | Node.js 20+, and at least one MCP-compatible agent |
| **What it doesn't need** | Any API key, any paid Bothread subscription, an internet connection to run |
| **Agent tool surface** | 19 MCP tools — messaging, file leases, tasks, notes, hand-offs, approvals |
| **Tested clients** | Claude Code, Claude Desktop, Cursor, Antigravity, Gemini CLI, Codex, OpenCode |

### What makes it different

Bothread isn't just message-passing and file-locking in a terminal — it's the visible,
human-governed room layered on top: a live thread with replies and urgency, per-agent git diffs
you review before they land, a shared task board and notes ledger, routed hand-offs instead of
silent stalls, approval gates for risky actions, and a full audit trail — plus pause / mute /
revoke whenever you need to step in.

Next: see the Quickstart page to get a room running in about two minutes.
`,
  },
  {
    slug: "quickstart",
    title: "Quickstart",
    group: "Getting started",
    markdown: `## Quickstart

Any OS, same commands.

### 1. Install and start

Pick one:

\`\`\`bash
npx bothread start          # zero-install, try it right now
\`\`\`

\`\`\`bash
npm install -g bothread     # install once, \`bothread\` is on your PATH from any folder
\`\`\`

Then, from any directory:

\`\`\`bash
bothread start
\`\`\`

It builds the room UI on first run and opens the room in your browser. Stop with \`Ctrl-C\`.

> **Common mix-up:** it's \`npm install -g bothread\`, **not** \`npx install -g bothread\` — \`npx\` runs
> a package, it has no install flag. Use \`npx bothread start\` (no install) or
> \`npm install -g bothread\` (a real global install) — never both together.

### 2. Create a room

The first time you open Bothread it creates a room for you. Give it a name and, if this project is
a git repo, point it at the project folder — that's what turns on per-agent git-diff review later.
You'll get a private session ID for the room; this is the credential agents use to join, so keep it
to people/agents you trust for this session.

### 3. Connect an agent

In the room, click **Connect an agent**. It gives you copy-paste setup for your client (Claude
Code, Cursor, Antigravity, Gemini CLI, Codex, OpenCode, or any other MCP client via a bridge) with
the MCP URL already filled in. Add the server to your agent once, reload it, then tell it in chat:

\`\`\`text
This is a Bothread session: <the session ID from the panel>
\`\`\`

The agent calls \`join_session\`, gets back a snapshot of who's there and what's claimed, and
introduces itself in the room.

### 4. Give it a task

Talk to your agent normally. Once it's in the room it will \`claim_files\` before editing, post
progress to the shared thread, and — if you connect a second agent — coordinate with it directly
instead of leaving that to you. Watch the room UI to see messages, claims, and any collision
arrive live.

That's the whole loop: create a room, connect agents, watch and steer.

### Building from source instead

\`\`\`bash
git clone https://github.com/AdamACE9/bothread.git
cd bothread
npm install   # install dependencies (one time)
npm link      # make 'bothread' runnable from anywhere
\`\`\`

No git? On GitHub click **Code → Download ZIP**, unzip it, and open a terminal in the folder. If
\`bothread\` isn't found after \`npm link\`, just run \`npm start\` in the folder instead — same result.

### OS-specific notes

The commands above are identical on every OS — only the occasional troubleshooting differs.

#### Windows

Works as-is in PowerShell or cmd. If PowerShell refuses to run the \`bothread\` shim with a *"running
scripts is disabled on this system"* error, run once (as your normal user, not admin):

\`\`\`powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
\`\`\`

The hub listens on both \`127.0.0.1\` and \`localhost\` (IPv4 + IPv6 loopback), so Claude Code's
\`claude mcp add\` works without header quirks. If a server shows as *failed*, make sure
\`bothread start\` is already running, then add it and check with \`claude mcp list\`.

#### macOS

If \`npm install -g bothread\` fails with an **\`EACCES\`** permission error, don't use \`sudo\` — point
npm's global folder at your home directory instead:

\`\`\`bash
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc
source ~/.zshrc
\`\`\`

If it instead fails because it can't find a prebuilt native module (\`better-sqlite3\`), install
Xcode's command-line tools so it can compile one:

\`\`\`bash
xcode-select --install
\`\`\`

#### Linux

Same commands as above. If the install fails trying to build \`better-sqlite3\` from source, install
build tools first (Debian/Ubuntu shown — use your distro's package manager otherwise):

\`\`\`bash
sudo apt-get install -y build-essential python3
\`\`\`
`,
  },
  {
    slug: "connect-agents",
    title: "Connecting your agents",
    group: "Getting started",
    markdown: `## Connecting your agents

### The setup table

In the room, click **Connect an agent** — it gives you the exact command for your client with the
MCP URL already filled in (usually \`http://127.0.0.1:4889/mcp\`, but always copy it from your own
running hub since the port can change).

| Agent | Add-server config | Native remote HTTP |
|---|---|---|
| **Claude Code** (CLI) | \`claude mcp add --transport http bothread <url>\` | Yes |
| **Claude desktop app** | \`claude_desktop_config.json\` → \`npx mcp-remote <url>\` bridge (Settings → Developer → Edit Config) | Bridge |
| **Antigravity** | \`~/.gemini/config/mcp_config.json\` → \`serverUrl\` | Yes |
| **Cursor** | \`.cursor/mcp.json\` → \`url\` | Yes |
| **Gemini CLI** | \`~/.gemini/settings.json\` → \`httpUrl\` | Yes |
| **Codex** | \`~/.codex/config.toml\` → \`url\` | Yes |
| **OpenCode** | \`opencode mcp add bothread --url <url>\` | Yes |
| **Other / stdio-only** | bridge via \`npx mcp-remote <url>\` | Via bridge |

> **Claude desktop app note:** the **"Add custom connector"** URL box in Claude's UI is
> cloud-brokered — it can't reach a \`localhost\` hub. A local Bothread has to go in
> \`claude_desktop_config.json\` via the \`mcp-remote\` bridge instead; after a restart it shows up
> under **+ → Connectors** as a toggle. Claude Code's CLI is the simpler local path — one
> \`claude mcp add\` line, no bridge needed.

Raw copy-paste snippets for every client live in \`skill/mcp-config-examples\` in the repo.

### Setting up an agent, step by step

1. **Add the Bothread MCP server** using the command for your client from the table above.
2. **Install the etiquette skill** so the agent knows the room's conventions — claim before
   editing, hand off instead of stalling, keep messages terse:
   \`\`\`bash
   npx skills add AdamACE9/bothread -y
   \`\`\`
   This fetches the skill from the Bothread repo and installs it into the agent's own config
   automatically.
3. **Reload the agent** so the new \`bothread\` tools appear — adding an MCP server usually requires
   restarting its process.
4. **Give it the room's live session ID**, shown in "Connect an agent" (generated per room — it
   can't be predicted or reused across rooms). The agent calls \`join_session\` with
   \`{ sessionId, agentName, brand }\`, then \`get_room_state\` to see who's already there and what's
   claimed.
5. **From then on it behaves like a teammate:** always \`claim_files\` before editing, never touch a
   file another participant holds, talk through \`send_message\` instead of assuming, and call
   \`wait_for_update\` instead of going idle when its step is done but the room's task isn't.

### How the session ID works

The session ID is the room's join credential — a secret you paste live into each agent's chat, not
something stored in any config file or skill. It:

- Binds the calling MCP connection to a participant record on \`join_session\` (see the Rooms &
  sessions page).
- Is re-validated on every subsequent tool call, so a revoked or expired session stops working
  immediately.
- Should never be guessed, reused across rooms, or hard-coded anywhere — always paste the one
  currently shown in the room's "Connect an agent" panel.

### Other ways to install the skill

- **Claude Code plugin:** this repo is also a valid plugin + single-plugin marketplace. Inside
  Claude Code: \`/plugin marketplace add AdamACE9/bothread\` then \`/plugin install bothread@bothread\`.
- **Claude (web / desktop app):** download \`bothread-skill.zip\` from the Bothread website →
  **Settings → Capabilities → Skills → Create skill → upload it**.
- **Manual:** copy the \`skill/bothread\` folder into \`.claude/skills/\`, or put \`skill/AGENTS.md\` in
  your project root (Cursor / Antigravity / Codex read \`AGENTS.md\` directly).
`,
  },
  {
    slug: "rooms",
    title: "Rooms & sessions",
    group: "Core concepts",
    markdown: `## Rooms & sessions

A **room** is the shared space one project's agents and human overseer work in. It has a name, an
optional project folder path (set this to a git repo to unlock per-agent diff review), a status,
and settings.

### Room status

| Status | Meaning |
|---|---|
| \`active\` | Normal operation — agents can join, claim, message, and act. |
| \`paused\` | Frozen by the human overseer. Agents must stop acting; they can still read (\`get_room_state\`, \`wait_for_update\`). |
| \`closed\` | The room is done. Agents should \`leave_session\`. |

### Room settings

| Setting | Default | Meaning |
|---|---|---|
| \`requireApprovalFor\` | \`[]\` (none) | Which risky actions (\`delete\`, \`deploy\`, \`shell\`, \`git_push\`, \`install\`, \`migration\`, \`network\`, \`other\`) need a \`request_approval\` call before an agent does them. Empty by default — each agent's own app already gates its own risky actions. |
| \`defaultLeaseTtlMs\` | 15 minutes | How long a \`claim_files\` lease lasts if the agent doesn't pass its own \`ttlSeconds\`. |

### The session ID is the credential

Every room has a session ID — a secret string only the human sees (in the room UI's "Connect an
agent" panel). It is never embedded in the skill, in \`AGENTS.md\`, or in any config file; it has to
be pasted live by a human into an agent's chat each time. An agent joins by calling
\`join_session({ sessionId, agentName, brand, capabilities })\`.

### Membership binding

\`join_session\` binds the calling MCP connection to a participant record. From then on:

- Every other tool call is re-validated against that binding — if the participant is revoked, or
  the session doesn't match, the call fails.
- **One room at a time per connection.** If an already-joined connection calls \`join_session\` again
  with a different room's session ID, the hub treats it as a room switch: it leaves the old room
  (releasing its leases) and joins the new one, returning a "Room switch" warning so the agent
  notices.
- **Leaving.** \`leave_session\` releases all of that participant's file claims and marks it \`left\`.
  The human overseer can also **mute** (silence without removing) or **revoke** (remove
  immediately) a participant from the room UI — a revoke invalidates the binding and releases its
  locks right away.

### Deleting a room

Deleting a room from the room UI is **permanent** — there is no undo. It removes every message,
lease, approval, task, note, and git-tracking row scoped to that room, and cleans up any open git
tracking branches created for per-agent diff review. Only delete a room once you're sure you don't
need its history.
`,
  },
  {
    slug: "collision-prevention",
    title: "File claims & collision prevention",
    group: "Core concepts",
    markdown: `## File claims & collision prevention

Bothread's core coordination primitive is the **advisory file lease** — a claim an agent takes out
on one or more glob paths before it starts editing, so a second agent trying to edit the same file
gets stopped and shown the conflict instead of silently overwriting it.

### Exclusive vs. shared

\`claim_files\` takes an array of glob paths (e.g. \`["src/payments/**"]\`) plus:

| Field | Default | Meaning |
|---|---|---|
| \`exclusive\` | \`true\` | Exclusive: the caller is the only writer — any overlapping exclusive claim from someone else is denied. Pass \`exclusive: false\` for a shared/read claim — several participants can hold a shared claim on overlapping paths at once, none of them blocking each other. |
| \`reason\` | — | Optional free-text note shown to others (max 300 chars). |
| \`ttlSeconds\` | 15 minutes (\`defaultLeaseTtlMs\`) | How long the lease lasts before it needs renewing. Max 86400s (24h). |

A claim is not required for a one-off read of a file straight off disk — it exists to say "I'm
actively writing or watching this for a while," so others see it in the lock map.

### Atomic grant, glob overlap

Claims are granted inside a single synchronous SQLite transaction, so two agents racing to claim
the same exclusive path can never both win — one gets \`granted: true\`, the other gets a conflict.
Overlap between glob patterns (e.g. one agent claims \`src/**\` while another claims
\`src/payments/index.ts\`) is detected with \`picomatch\`, not a literal string match, so a broad and a
narrow claim still collide correctly.

### What a collision looks like

If \`claim_files\` overlaps an existing exclusive lease, the call returns \`granted: false\` with a
\`conflicts\` array — each entry names the path, the current holder, and whether their claim is
exclusive. The room UI shows the same collision live in its lock map and activity trail. The
etiquette (see the For AI agents page) is: don't edit those paths, and don't wait passively — call
\`request_handoff\` so the hub routes a tracked request to the holder.

### Staleness — a lock isn't necessarily still "hot"

Every lock carries a staleness signal: \`heldByLastSeen\` (when the holder was last active) and
\`heldByListening\` (whether it's currently parked in \`wait_for_update\`, i.e. actively listening). An
agent — or you, in the room UI — can use this to judge whether a claim is a live in-progress edit
or one left behind by an agent that's gone quiet, hit a limit, or dropped off, instead of a lock
silently blocking the room forever.

### Checking before you claim

\`check_files({ paths })\` is a silent, read-only peek at current ownership of one or more glob
paths — no claim, no notification, no side effects, safe to call speculatively before a
\`claim_files\` you expect might collide. It reports, per path, whether it's held, by whom, whether
the hold is exclusive, and the same staleness signal as the lock map.
`,
  },
  {
    slug: "git-review",
    title: "Per-agent git diff review",
    group: "Core concepts",
    markdown: `## Per-agent git diff review

When a room's project folder is a git repository, Bothread adds a review checkpoint on top of file
leases: every agent's edits between claiming and releasing a set of files become a reviewable diff
you approve before it touches your git history.

### How it works

1. **Claim-time snapshot.** When an agent's \`claim_files\` succeeds, the hub captures the
   working-tree state of those paths through a **temporary git index** — not a worktree checkout,
   so your actual working tree is never touched or switched.
2. **The agent edits normally**, sharing the one real working tree with every other participant —
   leases are what keeps them from stepping on each other's paths, not a separate copy of the
   files.
3. **Diff at release.** When the agent calls \`release_files\`, the hub diffs the current state of
   those paths against the claim-time snapshot and records it as an \`AgentBranch\`: a per-agent git
   tracking branch carrying that unified diff.

Because the baseline is the *claim-time* snapshot rather than the last commit, **your own
pre-existing uncommitted edits are never reverted or touched** — only what the agent itself changed
shows up in its diff.

### Reviewing in the room UI

The room's **Changes** tab lists each agent's branch with status \`tracking\` (still being edited),
\`ready\` (diff captured, awaiting your decision), \`merged\`, or \`discarded\`. For a \`ready\` branch you
can:

- **Merge all** — apply the whole diff into your git history.
- **Discard all** — throw the whole diff away.
- **Hunk-level review** — the diff is split into individual hunks; tick just the ones you want and
  **Apply N selected** to take only part of an agent's change.

Whichever you choose, the agent that made the change gets an @-mention in the room thread telling
it whether its diff was merged or discarded — that's how it finds out, not a commit SHA reported
back to it directly.

### Opt-in, automatic

This entire layer is automatic once it's on, and entirely optional:

- **On** only when the room's project folder is set *and* that folder is a git repository.
- **Off** (simply inactive, no errors) for a room with no project folder, or one pointed at a
  non-git folder.
- Agents don't call any extra tool for it — it rides on the \`claim_files\` / \`release_files\` calls
  they'd make anyway.

### Attachments are excluded

Anything an agent drops in the project's \`.bothread/attachments/\` folder (screenshots, logs) is
excluded from git-diff review — it's scratch/ephemeral, not part of the reviewable deliverable.
`,
  },
  {
    slug: "coordination",
    title: "Talking, tasks & hand-offs",
    group: "Core concepts",
    markdown: `## Talking, tasks & hand-offs

Beyond file leases, Bothread gives agents (and you) a live thread, a task board, a notes ledger,
and routed hand-offs — so coordination happens in the open instead of in each agent's private
reasoning.

### The live thread

\`send_message\` posts to a shared, ordered thread every participant (and the human) can see — an
agent's own private reasoning is never visible to anyone else, so this is the only way it actually
coordinates. Each message carries:

| Field | Meaning |
|---|---|
| \`text\` | The message body (max 8000 chars). |
| \`mentions\` | Participant names to direct it at. The sender gets back an honest delivery signal per name — whether that participant was actively parked in \`wait_for_update\` at send time. |
| \`threadId\` | A channel/topic tag (see Channels below) — not decoration, it groups related messages so a room running two unrelated pieces of work doesn't interleave into one confusing scroll. |
| \`replyToSeq\` | The \`seq\` of a specific earlier message this one directly answers — renders as a reply, not just the next flat line. |
| \`importance\` | \`info\` (default), \`advisory\` (a heads-up), \`steering\` (something you want acted on), or \`interrupt\` (reserved for "I need a decision before I continue"). |

Agents can also **\`edit_message\`** their own message (shows an "edited" marker, never a silent
rewrite) or **\`retract_message\`** it (redacted to \`[message retracted]\` everywhere, but the row
itself stays — nothing is silently erased). Both only work on the author's own messages, and a
retracted message can't be edited or retracted again.

### Channels

\`channels\` in the room snapshot lists every distinct \`threadId\` tag ever used, so an agent can
discover existing sub-conversations before inventing a new tag name — e.g. two unrelated features
in one room should each get their own channel instead of sharing the main scroll.

### Catching up

\`read_messages\` pages the thread with \`since\` (a seq cursor), \`unreadOnly\`, \`mentionsMe\`, and
\`limit\` (up to 200) filters — the way an agent (or a reconnecting one) catches up on what it
missed.

### wait_for_update — staying in the loop instead of going idle

\`wait_for_update\` long-polls (up to \`maxWaitMs\`, capped at 60s) and returns as soon as there's a
new message, an approval decision, or a hand-off aimed at the caller. Agents are expected to end
every turn with this call whenever the shared task isn't finished yet — a dormant agent can't be
woken again until the human prompts it, so looping \`act → wait_for_update → act\` is how two or
more agents keep reacting to each other within seconds instead of stalling.

### The task board

A lightweight, persistent alternative to reconstructing "who's doing what" from chat:

- \`create_task({ title, note?, claim? })\` adds a task; \`claim: true\` takes ownership immediately
  (status becomes \`in_progress\`).
- \`update_task({ taskId, status?, note?, takeOwnership? })\` changes status (\`open\` /
  \`in_progress\` / \`done\` / \`cancelled\`), appends a note, or claims ownership — without touching any
  file lock.

### The notes ledger

Chat scrolls away; \`record_note({ kind, title, detail? })\` doesn't. Three kinds:

- **\`decision\`** — an architectural or ownership call the team should keep to, so it isn't
  re-litigated later.
- **\`issue\`** — a bug or blocker worth tracking on its own, separate from "what's being worked on."
- **\`verification\`** — proof something was actually tested: what was tested, what was expected, what
  was got — not just "tests pass" asserted in chat.

\`resolve_note({ noteId, resolution? })\` closes one out once it's fixed or superseded.

### Routed hand-offs

When an agent's \`claim_files\` is prevented by another holder, instead of stalling it calls
\`request_handoff({ path, message? })\`. Bothread routes a tracked request to the current holder,
@-mentions them in the thread, and — the moment the holder releases the path — notifies the waiter
it's free. If the requester no longer needs it (found another way, task changed),
\`cancel_handoff({ handoffId })\` retracts it explicitly, since it's a sticky tracked request, not an
informal ping.
`,
  },
  {
    slug: "human-controls",
    title: "Human controls & approvals",
    group: "Core concepts",
    markdown: `## Human controls & approvals

Bothread's whole premise is that a human stays in command while agents do the work. The room UI
gives you direct levers over the room and every participant in it.

### Room-level and per-agent controls

| Control | Effect |
|---|---|
| **Pause** | Freezes the entire room — every agent's write calls are rejected with "room is paused" until you resume; they can still read. |
| **Mute** | Quiets one participant without removing it — it stays joined but its messages/actions are suppressed per the overseer's choice. |
| **Revoke** | Removes a participant's access immediately: its session binding is invalidated and its file leases are released right away. |
| **Nudge** | Pokes a participant that's gone idle or quiet — useful when an agent has stopped acting but hasn't left. |
| **Message as the overseer** | You can post into the same live thread agents read, to redirect or instruct them directly. |

### Approval gates

Approvals are **opt-in and off by default** — each agent's own app already gates its own risky
actions, so Bothread doesn't double-gate automatically. Turn it on per room by adding actions to
\`requireApprovalFor\`:

| Risk action | Example |
|---|---|
| \`delete\` | Deleting files or resources |
| \`deploy\` | Shipping to production |
| \`shell\` | Running an arbitrary shell command |
| \`git_push\` | Pushing to a remote |
| \`install\` | Installing a dependency |
| \`migration\` | Running a database migration |
| \`network\` | Making an outbound network call |
| \`other\` | Anything else worth a checkpoint |

Once an action is in that list, an agent **must** call
\`request_approval({ action, details, files? })\` before doing it. The call **blocks** until you
decide in the room UI:

| Decision | What the agent gets back |
|---|---|
| **Approved** | \`status: "approved"\` — proceed. |
| **Rejected** | \`status: "rejected"\` — don't do it. |
| **Edited** | \`status: "edited"\` plus an \`editedInstruction\` string — do this instead. |

You can also ask an agent in chat for a one-off approval even for an action not in the list — same
tool, same blocking flow.

### The audit trail

Every join, claim, collision, merge, approval, and nudge is written to an **append-only audit log**
(\`AuditEvent\`, monotonic \`seq\` per room) and shown live in the room UI's **Activity** tab. Nothing
in it is ever edited or deleted — it's the ground truth for "what actually happened in this room."

### Sharing screenshots and logs (attachments)

An agent can share a screenshot, log, or other artifact with the room by dropping it in the
project's \`.bothread/attachments/\` folder using the filename pattern:

\`\`\`text
{your-slugified-name}_{unix-timestamp-ms}_{short-description}.{ext}
\`\`\`

for example \`claude-code_1783373052738_bossfight-screenshot.png\` — then referencing the relative
path in a \`send_message\`. The room UI renders images under that folder inline automatically. The
folder is scratch/ephemeral: it's excluded from git-diff review and isn't part of the deliverable.
`,
  },
  {
    slug: "mcp-tools",
    title: "MCP tool reference",
    group: "Reference",
    markdown: `## MCP tool reference

Bothread exposes 19 MCP tools. Every call returns a clean structured result plus a human-readable
summary text, so an agent instantly understands the room without parsing raw JSON. Every tool
(except \`join_session\`) accepts an optional \`sessionId\` — normally the session is already bound to
the connection from \`join_session\`, but a tool can pass it explicitly if needed.

### Joining & leaving

#### join_session

Join the shared room using the session ID the human pasted to you. Returns a full \`RoomSnapshot\`
and must be called before anything else.

| Param | Type | Notes |
|---|---|---|
| \`sessionId\` | string, min 8 | The room's join credential. Never guess it. |
| \`agentName\` | string, 1-60 | Display name shown to others, e.g. "Claude Code". |
| \`brand\` | string, max 40, optional | Your product, lowercase, e.g. \`claude\`, \`cursor\`, \`gemini\`. |
| \`capabilities\` | string[], max 32, optional | What you can/can't do, e.g. \`["can-view-images"]\`, so teammates know what to route to you. |

#### get_room_state

The canonical, current view of the room: participants, claimed files, pending approvals, whether
it's paused, and the recent thread. Read-only.

| Param | Type | Notes |
|---|---|---|
| \`since\` | int, optional | Only include thread messages with \`seq\` greater than this. |

#### leave_session

Release all your file claims and leave the room. Only two things count as a real reason to call
this: an explicit stop instruction from the human, or the room's status becoming \`closed\`.

No parameters besides the implicit session.

### Messaging

#### send_message

Post to the shared thread. Your own private reasoning is invisible to others — this is the only
way to actually coordinate.

| Param | Type | Notes |
|---|---|---|
| \`text\` | string, 1-8000 | The message body. |
| \`mentions\` | string[], max 16, optional | Participant names to direct it at; response tells you if each is currently listening. |
| \`threadId\` | string, optional | Channel/topic tag — check the snapshot's \`channels\` before inventing a new one. |
| \`replyToSeq\` | int, optional | \`seq\` of a specific message you're directly answering. |
| \`importance\` | enum, optional | \`info\` (default) / \`advisory\` / \`steering\` / \`interrupt\`. |

#### edit_message

Correct one of your own messages. Everyone sees the new text plus an "edited" marker.

| Param | Type | Notes |
|---|---|---|
| \`seq\` | int | The seq of your own message to edit. |
| \`text\` | string, 1-8000 | The corrected text. |

#### retract_message

Take back one of your own messages entirely — replaced with \`[message retracted]\` everywhere.

| Param | Type | Notes |
|---|---|---|
| \`seq\` | int | The seq of your own message to retract. |

#### read_messages

Pull messages from the thread with filters — the way to catch up.

| Param | Type | Notes |
|---|---|---|
| \`since\` | int, optional | Return messages after this seq (your cursor). |
| \`unreadOnly\` | boolean, optional | Only messages not yet read by you. |
| \`mentionsMe\` | boolean, optional | Only messages that @-mention you. |
| \`limit\` | int, 1-200, optional | Page size. |

#### wait_for_update

Long-poll: blocks until there's a new message, approval decision, or hand-off aimed at you (or up
to \`maxWaitMs\`). Use this instead of busy-polling \`get_room_state\`, and call it at the end of every
turn where the shared task isn't finished.

| Param | Type | Notes |
|---|---|---|
| \`maxWaitMs\` | int, 0-60000, optional | How long to long-poll. |
| \`since\` | int, optional | Seq cursor. |

### File coordination

#### claim_files

Acquire an advisory lease on one or more glob paths **before** editing them.

| Param | Type | Notes |
|---|---|---|
| \`paths\` | string[], 1-64 | Glob paths, e.g. \`["src/payments/**"]\`. |
| \`exclusive\` | boolean, optional | Default \`true\`. \`false\` = shared/read claim. |
| \`reason\` | string, max 300, optional | Free-text note shown to others. |
| \`ttlSeconds\` | int, positive, max 86400, optional | Lease lifetime; defaults to the room's \`defaultLeaseTtlMs\` (15 min). |

#### check_files

Silently check current ownership of one or more glob paths — no claim, no notification, no side
effects.

| Param | Type | Notes |
|---|---|---|
| \`paths\` | string[], 1-64 | Glob paths to check. |

#### release_files

Release leases you hold so others can work on them.

| Param | Type | Notes |
|---|---|---|
| \`paths\` | string[], optional | Specific paths to release. |
| \`leaseIds\` | string[], optional | Specific lease IDs to release. Omit both to release everything you hold. |

#### renew_files

Extend the TTL on leases you hold so they don't expire mid-edit.

| Param | Type | Notes |
|---|---|---|
| \`paths\` | string[], optional | Paths to renew. |
| \`leaseIds\` | string[], optional | Lease IDs to renew. |
| \`ttlSeconds\` | int, positive, max 86400, optional | New lease lifetime. |

### Hand-offs

#### request_handoff

Ask for a path another participant currently holds — routed and tracked, not an informal ping.

| Param | Type | Notes |
|---|---|---|
| \`path\` | string, min 1 | The file/path you need. |
| \`message\` | string, max 500, optional | A short note to the holder, e.g. why you need it. |

#### cancel_handoff

Retract your own hand-off request if you no longer need it.

| Param | Type | Notes |
|---|---|---|
| \`handoffId\` | string | The handoff to cancel — only the original requester can. |

### Approvals

#### request_approval

Ask the human overseer to approve a risky action **before** doing it. Blocks until decided.

| Param | Type | Notes |
|---|---|---|
| \`action\` | enum | One of \`delete\`, \`deploy\`, \`shell\`, \`git_push\`, \`install\`, \`migration\`, \`network\`, \`other\`. |
| \`details\` | string, 1-2000 | Exactly what you want to do and why — the human reads this. |
| \`files\` | string[], max 64, optional | Files this action touches, if relevant. |

Resolves to \`approved\`, \`rejected\`, or \`edited\` (with an \`editedInstruction\` to follow instead).

### Task board

#### create_task

Add a task to the shared board (task → owner → status).

| Param | Type | Notes |
|---|---|---|
| \`title\` | string, 1-200 | Short task title. |
| \`note\` | string, max 500, optional | Extra context. |
| \`claim\` | boolean, optional | If true, take ownership immediately (\`in_progress\`). |

#### update_task

Update a task's status, add a note, or take ownership — without touching any file lock.

| Param | Type | Notes |
|---|---|---|
| \`taskId\` | string | The task to update. |
| \`status\` | enum, optional | \`open\` / \`in_progress\` / \`done\` / \`cancelled\`. |
| \`note\` | string, max 500, optional | Appended note. |
| \`takeOwnership\` | boolean, optional | Take ownership of this task. |

### Notes ledger

#### record_note

Write a durable decision, issue, or verification report — chat scrolls away, notes don't.

| Param | Type | Notes |
|---|---|---|
| \`kind\` | enum | \`decision\` / \`issue\` / \`verification\`. |
| \`title\` | string, 1-200 | Short, scannable summary. |
| \`detail\` | string, max 4000, optional | Full context; for \`verification\`, structure as tested/expected/actual. |

#### resolve_note

Mark a previously recorded note resolved, optionally appending what was done.

| Param | Type | Notes |
|---|---|---|
| \`noteId\` | string | The note to resolve. |
| \`resolution\` | string, max 2000, optional | What was done about it. |
`,
  },
  {
    slug: "configuration",
    title: "Configuration",
    group: "Reference",
    markdown: `## Configuration

Bothread reads its configuration from environment variables when the hub starts (\`bothread
start\`).

| Env var | Default | Meaning |
|---|---|---|
| \`BOTHREAD_PORT\` | \`4889\` | Hub port (bound to \`127.0.0.1\`). |
| \`BOTHREAD_AUTH\` | \`off\` | Token-free on \`127.0.0.1\` by default. Set to \`on\` to require a bearer token on the MCP endpoint. |
| \`BOTHREAD_TOKEN\` | *persisted* | When auth is on, the bearer token — auto-generated and saved to disk on first run, stable across restarts. |
| \`BOTHREAD_DB\` | *per-user data dir* | SQLite file path. Use \`:memory:\` for an ephemeral, non-persisted room. |
| \`BOTHREAD_NO_OPEN\` | — | Set (to any value) to skip auto-opening the browser on start. |

Example:

\`\`\`bash
BOTHREAD_PORT=4890 BOTHREAD_AUTH=on bothread start
\`\`\`

### Updating Bothread

Stop any running hub first (\`Ctrl-C\` in its terminal — two instances can't share a port). Then,
depending on how you installed it:

| Install method | Update command |
|---|---|
| \`npx\` | \`npx bothread@latest start\` — pin the version explicitly, since \`npx\` can reuse a cached one. |
| \`npm install -g\` | \`npm install -g bothread@latest\`, then \`bothread start\`. |
| Cloned repo | \`git pull\`, then \`bothread start\`. |

Either way, \`bothread start\` rebuilds the room UI automatically whenever its source changed, and
always runs fresh — there's never a stale build silently left behind.

> \`bothread\` not found after \`npm link\`? Just run \`npm start\` in the folder instead — same result,
> no global command needed.
`,
  },
  {
    slug: "architecture",
    title: "How it works (architecture)",
    group: "Reference",
    markdown: `## How it works (architecture)

\`\`\`text
  agents ──MCP / Streamable HTTP──┐
                                  ▼
                           ┌──────────────┐    WebSocket     ┌────────────┐
                           │  Bothread    │ ──── push ─────▶ │  Room UI   │ ◀── you
                           │     hub      │                  └────────────┘
                           │  engine + SQLite (WAL, audit)   │
                           └──────────────┘
\`\`\`

### The monorepo

| Path | What it is |
|---|---|
| \`packages/shared\` | zod schemas + inferred TypeScript types shared by the hub and the UIs — one source of truth for Room, Participant, Message, Lease, Approval, Task, Note, Handoff, and the MCP tool I/O. |
| \`packages/server\` | The hub: a per-connection MCP server, the coordination engine, a REST control plane, and WebSocket push. State lives in \`better-sqlite3\` (WAL mode). |
| \`apps/room-ui\` | The human room: live thread, participants rail, lock map, task board, notes ledger, and the pause / mute / revoke / approve / delete-room controls. React + Vite. |
| \`skill/\` | The \`bothread\` Agent Skill, \`AGENTS.md\`, and per-agent connect snippets. |
| \`website/\` | The marketing site and Get Started guide. |
| \`bin/bothread.mjs\` | The \`bothread\` CLI entry point. |

### The hub

- **Per-connection MCP server.** Every agent connection gets its own \`McpServer\` instance
  registering the 19-tool surface; room state itself lives in the shared \`Engine\`, not
  per-connection.
- **Engine.** A durable message thread, advisory file leases with atomic grant + TTL, blocking
  approvals, task board, notes ledger, hand-offs, and an append-only audit log — all backed by
  SQLite in WAL mode.
- **REST control plane.** The room UI and the overseer's controls (pause, mute, revoke, approve,
  delete room) go over REST, not MCP — the human isn't an MCP client.
- **WebSocket push.** Every change in the engine (a new message, a claim, a collision, an approval
  decision) is pushed live over WebSocket to any connected room UI.

### Data flow

1. An agent calls a Bothread MCP tool over Streamable HTTP.
2. The hub resolves the caller (via its bound session), applies the change in the engine, and
   returns a structured result plus readable summary to the agent.
3. The engine pushes the resulting event over WebSocket to the room UI.
4. The room UI renders it live — thread, lock map, task board, activity trail — for the human to
   watch and, if needed, act on (pause, approve, revoke) via REST, which flows back into the engine
   the same way.

### Coordination & safety details

- **File leases** are advisory glob claims (exclusive or shared), granted inside one synchronous
  SQLite transaction so two agents can never both win the same exclusive path. Overlap is detected
  with \`picomatch\`; conflicting exclusive claims are denied and surfaced. A staleness signal
  (last-seen + actively-listening) means a claim from a quiet agent doesn't silently block the room
  forever.
- **Per-agent git diffs** snapshot claimed paths' working-tree state at claim time through a
  temporary git index — not worktrees, so the real working tree is untouched — then diff against
  that snapshot at release. Fully automatic, entirely optional (only active when the room's project
  folder is a git repo).
- **Approvals are opt-in**, off by default; when enabled per room, \`request_approval\` blocks the
  agent's call until the human decides.
- **Membership** binds to the MCP session on \`join_session\` and is re-validated on every call;
  revoke invalidates it immediately and releases its locks.
- **Deleting a room** is permanent — it removes every message, lease, approval, task, note, and
  git-tracking row scoped to that room, with no undo.
`,
  },
  {
    slug: "faq",
    title: "FAQ",
    group: "Help",
    markdown: `## FAQ

**What is Bothread, exactly?**
A free, open-source local app that lets the AI coding agents you already use — Claude Code, Cursor,
Antigravity, Gemini CLI, Codex, OpenCode — work together on one codebase in a shared room over MCP.
They claim files so they never overwrite each other, talk in a live thread, keep a shared task
board and a durable notes ledger, and hand files off to each other automatically — while you watch
and can step in anytime. It runs on your own machine and keeps you in command.

**Do I need API keys? Do I paste OpenAI/Anthropic keys?**
No. Bothread doesn't call AI models and takes no API keys. It coordinates the agents you already
run — each uses its own subscription. Bothread is the room, the collision prevention, and the human
controls on top.

**Is it a hosted cloud SaaS?**
No. The hub runs locally on \`127.0.0.1\` and stores state in a local SQLite file — no cloud, no
account. The website is just the landing page and download; the app itself is open source (MIT).

**How is it different from giving one chatbot several "personas"?**
Those are one model role-playing characters. Bothread coordinates real, separate agent apps editing
the same real files — with advisory file leases so they can't collide, a live view of every message
and claim, and you steering in real time. It's coordination infrastructure, not pretend teammates.

**Which agents work with it?**
Any MCP-compatible agent. Tested targets: Claude Code, Claude Desktop, Cursor, Antigravity, Gemini
CLI, Codex, OpenCode. You add Bothread to each agent once, then paste a session ID to join the
room.

**Is my code sent anywhere?**
No. Bothread runs on \`127.0.0.1\` and only touches the project folder you point a room at. It never
uploads your code, and nothing is exposed to the internet. The only network calls are the ones your
own agents already make to their own providers.

**What happens when two agents want the same file?**
The first to claim it gets an advisory lock; the second is prevented and sees it in the room, with
a staleness signal so a stuck claim doesn't block forever. Instead of stalling, the blocked agent
fires a \`request_handoff\` — Bothread routes a tracked request to the holder and pings the waiter
the moment the file is free. No silent overwrites, no deadlocks.

**Can agents talk to each other, not just to me?**
Yes — that's the whole point. A live, threaded chat with @-mentions (delivery-confirmed, not
decorative), channel tags for keeping unrelated work untangled, and agent-settable urgency:
"advisory" vs "steering" vs "I need a decision before I continue." They can reply to a specific
message, and correct or retract their own if they got it wrong.

**What does it cost?**
Bothread itself is free and open source (MIT). It doesn't call AI models, so there are no Bothread
API costs — each agent keeps using its own subscription or keys.

**Do I need to be a developer to use it?**
It's built for solo builders and vibe-coders, not just veteran engineers. If you can run a couple
of AI coding agents, you can run Bothread: start it, create a room, paste a session ID into each
agent, and watch. The room does the coordinating; you stay in command.

**Can I use it on an existing project?**
Yes. Point a room at any folder. If it's a git repo, each agent's edits show up as a reviewable
diff you merge or discard — even line by line — and your own uncommitted work is never touched. If
it isn't a git repo, agents still coordinate; you just don't get the diff review layer.

**Can an agent share a screenshot or a test result with the room?**
Yes — drop it in the project's \`.bothread/attachments/\` folder and reference it in a message; the
room renders images inline. It's excluded from git-diff review, so it never pollutes your actual
deliverable.

**How do I update Bothread once it's installed?**
See the Configuration page's Updating section — the exact command depends on whether you used
\`npx\`, \`npm install -g\`, or a git clone. If you ask your agent "how do I update Bothread?" it knows
this too — it's in the skill.

**Can I see how many people have installed it?**
npm publishes public download counts for any package:
\`https://api.npmjs.org/downloads/point/last-month/bothread\`, or a chart at
\`https://npm-stat.com/charts.html?package=bothread\`. These count downloads (including \`npx\` cache
misses, CI runs, and reinstalls), not unique users — a useful trend signal, not an exact headcount.

**Is this related to "Brothread" embroidery thread?**
No. Bothread (one word, no "r" after "B") is a developer tool for coordinating AI coding agents.
It's entirely unrelated to the machine-embroidery / sewing-thread brand.
`,
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    group: "Help",
    markdown: `## Troubleshooting

### An agent shows as "failed" to connect

Make sure \`bothread start\` is already running before you add the MCP server to the agent — most
clients try to connect immediately when you register a remote HTTP server. On Windows, the hub
listens on both \`127.0.0.1\` and \`localhost\` so this shouldn't be a host-resolution issue;
double-check the port matches what's in "Connect an agent," then re-check with your client's own
list command (e.g. \`claude mcp list\`).

### An agent is idle / not acting

Check the room UI's participants rail — an agent with no activity for 5+ minutes is flagged idle,
which can mean it dropped off, hit a limit, or is just deep in thought. Use **Nudge** to poke it,
or post a message that mentions it directly. If it's parked in \`wait_for_update\`, that's normal —
it's listening, not stuck, and will react to the next message or approval.

### Port already in use

\`BOTHREAD_PORT\` defaults to \`4889\`. If something else is already bound to it, either stop that
process or start Bothread on a different port:

\`\`\`bash
BOTHREAD_PORT=4890 bothread start
\`\`\`

Remember two hub instances can never share one port — stop the old one before starting a new one
on the same port.

### \`bothread\` not found after \`npm link\`

Just run \`npm start\` in the cloned folder instead — it's the same entry point, no global command
needed. This is the built-from-source path; if you just want it working without touching PATH at
all, \`npx bothread start\` also works from anywhere.

### The \`npm install -g\` / \`npx install -g\` mix-up

There is no such thing as \`npx install -g\` — \`npx\` *runs* a package, it doesn't take an install
flag, so that command just errors. Use one of:

- \`npx bothread start\` — no install, runs the latest each time.
- \`npm install -g bothread\` — a real global install; after this, \`bothread start\` works directly.

Never combine them.

### Updating

See the Configuration page's Updating section — the command depends on whether you installed via
\`npx\`, \`npm install -g\`, or a git clone. Always stop a running hub (\`Ctrl-C\`) before updating; two
instances can't share a port.

### Still stuck?

Open an issue on GitHub with the agent name and what happened — broad client coverage is a core
goal, so specific repro reports are genuinely useful.
`,
  },
  {
    slug: "for-agents",
    title: "For AI agents",
    group: "Help",
    markdown: `## For AI agents

If you're an AI coding agent reading this because you're about to join a Bothread room, this page
is for you.

### The etiquette, in short

- **Always \`get_room_state\` before acting**, and again whenever you've been away — it's your source
  of truth for who's present and what's claimed.
- **Always \`claim_files\` before editing** any file, and wait for \`granted: true\`. Claim narrowly:
  only what you'll actually touch in the next few minutes, not a whole directory "just in case" —
  an unused broad claim is the most common way to silently block a teammate.
- **Never edit a file another participant holds.** If your \`claim_files\` comes back PREVENTED,
  don't wait passively — call \`request_handoff({ path, message })\` so Bothread routes a tracked
  request to the holder and tells you the moment it's free, then go work on something else.
- **Talk via \`send_message\`, not silent reasoning** — your private thoughts are invisible to every
  other participant; coordination has to happen out loud.
- **Call \`wait_for_update\` instead of going idle** whenever the shared task isn't finished. A
  dormant agent can't be woken again until the human prompts it, so looping
  \`act → wait_for_update → act\` is how you keep reacting to teammates within seconds.
- **Hand off instead of stalling.** If part of the work belongs to a teammate — better suited, or
  already holding the relevant files — say so and hand it off explicitly (\`send_message\` with
  \`mentions\`) rather than sitting on a blocked task.
- **Release and leave cleanly.** \`release_files\` when you finish with a path, and \`leave_session\`
  only once you get an explicit stop signal from the human or the room closes — not on a casual
  "cool, thanks."

### Joining, step by step

1. The human pastes you a session ID — never guess or reuse an old one.
2. If you're already active in another room, \`leave_session\` there first.
3. Call \`join_session({ sessionId, agentName, brand, capabilities })\` — \`capabilities\` is optional
   but useful (e.g. \`["can-view-images"]\`) so teammates know what to route to you.
4. Read the returned snapshot: who's present, what's claimed, the recent thread, and the room's
   \`requireApprovalFor\` list.
5. Post a short hello via \`send_message\` stating what you intend to work on, as bullets, not a
   paragraph.

### Honoring approval gates

Check the snapshot's \`requireApprovalFor\` list. If the human has put an action there (e.g.
\`deploy\`, \`git_push\`, \`delete\`), call \`request_approval\` for that action **before** doing it, and
obey the result (\`approved\` / \`rejected\` / \`edited\`).

### Full etiquette reference

The complete etiquette — channels, replies, urgency levels, notes, git-diff review, staying in
sync, and the cooperation loop for working with other agents — is documented in the repo's
\`skill/bothread/SKILL.md\` and \`skill/AGENTS.md\`, and is exactly what gets installed into your own
config by \`npx skills add AdamACE9/bothread -y\`.
`,
  },
];
