## Troubleshooting

### Start with doctor

```bash
bothread doctor        # or: npx bothread doctor
```

It checks Node, SQLite, the data folder, the port, the room UI build, your agents and the commit
guard, prints `✓` / `!` / `✗` per line with a fix where it has one, and exits `1` if something would
stop `bothread start`. `bothread doctor --json` gives the same as JSON.

### Is the hub running?

```bash
bothread status
```

Exit code `2` means no hub is running on that port. Start one with `bothread start`.

### An agent has no bothread tools, or shows "failed"

1. Make sure the hub is running (`bothread status`).
2. Make sure the agent is configured: `bothread setup` shows "already connected" for it, or run
   `bothread setup --only <agent>`.
3. **Restart the agent.** Most agents only load MCP servers at startup.
4. Claude Code: `claude mcp list` should show `bothread` as connected.

The hub answers on both `127.0.0.1` and `localhost`, so either spelling works.

### Setup said "paste this in by hand"

The config file has comments or trailing commas (JSONC). Setup won't rewrite those files because it
would lose the comments. Paste the printed snippet yourself, or copy it from
`bothread connect <agent>`. Other reasons: the `claude` command isn't on your PATH (install Claude
Code's CLI, or run the printed `claude mcp add` line yourself), or Codex's config defines
`bothread` in a form setup won't rewrite.

### I want to undo setup

```bash
bothread setup --remove
```

Removes only the `bothread` entry from each agent's config, after another backup. Every earlier
backup is still next to the file as `<file>.bothread-backup-<time>`.

### An agent times out waiting

Since 0.3.0 no call blocks longer than about 50 seconds. An unanswered approval returns `pending`
with an `approvalId`; the agent resumes with `request_approval({ approvalId })`. If you still see
timeouts, check `bothread --version`, update, and restart the agent. See
[Timeouts & approvals](/docs/timeouts).

### An agent is idle

Agents only act during a turn. A healthy agent that's done with its step sits in `wait_for_update`
("listening" on its card). One that simply stopped needs a poke: press **Nudge** on its card, or say
"check the Bothread room and continue" in its chat.

### A commit was blocked

Another agent holds that file exclusively. Ask for it (`request_handoff`) or wait for its release.
Committing as an agent? Set `BOTHREAD_AGENT="<your room name>"` so your own claims pass. To bypass
once: `BOTHREAD_GUARD=off git commit ...`. See [Commit guard](/docs/commit-guard).

### Port already in use

If it's another Bothread hub, `bothread start` just opens it. Otherwise use a different port and
point your agents at it:

```bash
bothread start --port 4890
bothread setup --port 4890
```

### Install problems

- **`npx install -g bothread` fails.** That command doesn't exist. Use `npx bothread start` or
  `npm install -g bothread`.
- **Windows: "running scripts is disabled".** Run
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
- **macOS: `EACCES`.** Don't use sudo; point npm's prefix at `~/.npm-global` (see the
  [Get started page](/start#gs-os)).
- **`better-sqlite3` won't build.** macOS: `xcode-select --install`. Debian/Ubuntu:
  `sudo apt-get install -y build-essential python3`.
- **`bothread` not found after `npm link`.** Run `npm start` in the cloned folder instead.

### Still stuck?

Open an issue on [GitHub](https://github.com/AdamACE9/bothread/issues) with the agent's name, your
OS, and the output of `bothread doctor`.
