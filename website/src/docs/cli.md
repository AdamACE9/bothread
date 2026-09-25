## CLI reference

```text
bothread [command] [flags]        (no command = start)
```

With `npx`, put `npx` in front: `npx bothread setup`. `bothread help <command>` prints the help for
one command.

### Commands

| Command | What it does |
|---|---|
| `start` | Start the hub and open the room. The default. |
| `setup [agents...]` | Find your AI agents and connect them all, with backups. See [One-command setup](/docs/setup). |
| `status` | Is the hub up? Version, MCP URL, sessions, rooms, who's in them, what's waiting on you. |
| `rooms` | List rooms with agents, last activity and pending approvals. |
| `new <name>` | Create a room and print its session ID and join line. |
| `connect [agent]` | Print the MCP config for one agent, the skill command and the join step. No agent: list the choices. Works without a running hub. |
| `doctor` | Check Node, SQLite, the data folder, the port, the room UI build, your agents and the commit guard. |
| `guard <action>` | The pre-commit hook: `install`, `uninstall`, `status`, `check`. See [Commit guard](/docs/commit-guard). |
| `help [command]` | Help for bothread or one command. |
| `version` | Print the installed version (also `-v`, `--version`). |

### start

```bash
bothread start [--port <n>] [--host <h>] [--db <path>] [--auth] [--no-open] [--no-setup]
```

| Flag | Env var | Default | Meaning |
|---|---|---|---|
| `--port <n>` | `BOTHREAD_PORT` | `4889` | Hub port |
| `--host <h>` | `BOTHREAD_HOST` | `127.0.0.1` | Bind address. Off loopback requires auth (see [Security](/docs/security)) |
| `--db <path>` | `BOTHREAD_DB` | data folder | SQLite file, or `:memory:` for a throwaway hub |
| `--auth` | `BOTHREAD_AUTH=on` | off | Require a bearer token from agents |
| `--no-open` | `BOTHREAD_NO_OPEN=1` | | Don't open the browser |
| `--no-setup` | `BOTHREAD_NO_SETUP=1` | | Skip the first-run "connect your agents?" question |

Flags win over env vars. If a Bothread hub is already running on the port, `start` opens that one
and exits `0`.

The start screen shows the version and startup time, the room and MCP URLs, which agents are
connected, and numbered next steps.

### Keys while the hub runs

| Key | Action |
|---|---|
| `o` | Open the room in your browser |
| `s` | Set up agents (runs `bothread setup`) |
| `c` | Copy the MCP URL |
| `h` | Show the keys |
| `q` | Stop (also `Ctrl+C`, `Ctrl+D`) |

Keys only work when the hub runs in an interactive terminal.

### setup

```bash
bothread setup [agents...] [-y] [--only <ids>] [--dry-run] [--remove] [--skill] [--no-skill] [--port <n>] [--auth] [--json]
```

Agent ids: `claude`, `claude-desktop`, `antigravity`, `cursor`, `gemini`, `codex`, `opencode`,
`windsurf`, `vscode`, `zed`. Full flag table on [One-command setup](/docs/setup).

### status, rooms

```bash
bothread status [--port <n>] [--json]
bothread rooms  [--port <n>] [--json]
```

Both exit `2` when no hub is running. `status --json` still prints `{ "running": false, ... }`.

### new

```bash
bothread new <name> [--project <path>] [--port <n>] [--json]
```

`--project` points the room at a folder (relative paths resolve from where you run it), which turns
on per-agent git diffs. With `--json`: `{ roomId, name, sessionId, url, mcpUrl }`.

### connect

```bash
bothread connect [agent] [--port <n>] [--auth] [--json]
```

Agents: the setup ids plus `other` (the `mcp-remote` bridge for any client).

### doctor

```bash
bothread doctor [--port <n>] [--db <path>] [--json]
```

Prints `✓`, `!`, `✗` (and `·` for info) per check, then a verdict. Exits `1` if anything would stop
`bothread start` from working.

```text
  bothread doctor v0.3.0 · linux-x64

  ✓ Node.js 22.22.2
  ✓ better-sqlite3 loads (SQLite 3.53.2)
  ✓ Data dir writable: ~/.local/share/bothread
  ✓ Port 4889 is free
  ✓ Room UI is built and up to date
  · Commit guard not installed (optional: bothread guard install)
  · Claude Code: found, not connected
      → Connect it: bothread setup --only claude

  ✓ All good. Start with: bothread start
```

### guard

```bash
bothread guard install   [--path <repo>] [--force]
bothread guard uninstall [--path <repo>]
bothread guard status    [--path <repo>] [--json]
bothread guard check     [--agent <name>] [--json] [files...]
```

`check` exits `1` when a file is blocked, `2` when no hub is running.

### Global flags

| Flag | Meaning |
|---|---|
| `--json` | Pure JSON on stdout: no banner, no colors |
| `--port <n>` | Hub port for any command that talks to the hub |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Print the installed version |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | OK |
| `1` | Error or bad usage (a blocked file, for `guard check`) |
| `2` | No hub running on the port |
| `130` | You cancelled an interactive prompt |

### Environment variables

| Variable | Meaning |
|---|---|
| `BOTHREAD_PORT=4889` | Hub port |
| `BOTHREAD_HOST=127.0.0.1` | Bind address (off loopback requires auth) |
| `BOTHREAD_AUTH=on` | Require a bearer token. Auth is **off** by default |
| `BOTHREAD_TOKEN=<token>` | Use this token instead of the generated one |
| `BOTHREAD_DB=<path>` | SQLite file or `:memory:` |
| `BOTHREAD_NO_OPEN=1` | Don't open the browser |
| `BOTHREAD_NO_SETUP=1` | Don't ask to connect agents on first start |
| `BOTHREAD_NO_TELEMETRY=1` | Turn off the anonymous usage counters |
| `BOTHREAD_ALLOW_INSECURE_HOST=1` | Allow a non-loopback bind with auth off (isolated networks only) |
| `BOTHREAD_AGENT=<name>` | Commit guard: who is committing (room display name) |
| `BOTHREAD_GUARD=off` | Commit guard: skip the check for one commit |
| `NO_COLOR=1` | Plain output (`FORCE_COLOR=1` forces color) |

### For AI agents and scripts

`status`, `rooms`, `new`, `connect`, `setup`, `doctor` and `guard` all take `--json` and print only
JSON on stdout. Useful one-liners:

```bash
bothread status --json                                  # is it up? which rooms?
bothread new "task" --project . --json                  # make a room, get the sessionId
bothread setup --yes --json                             # connect every agent found, no prompts
bothread guard check --agent "Claude Code" --json       # would my commit be blocked?
```
