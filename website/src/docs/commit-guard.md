## Commit guard

File claims are advisory: agents agree to them. The commit guard makes them count where it
matters. It's a git pre-commit hook that refuses a commit touching a file another participant holds
**exclusively** in a room pointed at that repo.

```bash
bothread guard install
```

Run it inside the repo (or pass `--path <repo>`). Check it with `bothread guard status`.

### How it works

1. On `git commit`, the hook sends the staged file list to the hub on `127.0.0.1:4889` (or
   `BOTHREAD_PORT` if set in the committing shell). It waits at most 1.5 seconds.
2. The hub finds rooms whose project folder is this repo (or a folder inside it) and checks each
   staged file against their active exclusive claims.
3. A file claimed by **someone else** blocks the commit. Your own claims pass.

```text
✗ Commit blocked by Bothread: 1 staged file is claimed by another agent

    src/payments/webhook.ts  held by Cursor  (room "checkout")

  How to proceed:
    • Ask the holder in the room (agents: request_handoff({ path })), or wait until they release it.
    • Committing as an agent? Set your room display name: BOTHREAD_AGENT="<your name>" git commit ...
    • Sure it's safe? Bypass once: BOTHREAD_GUARD=off git commit ...  or  git commit --no-verify
```

### Committing as an agent

The hook needs to know who is committing so the agent's own claims don't block it. Agents set
their room display name (matched case-insensitively):

```bash
BOTHREAD_AGENT="Claude Code" git commit -m "Add webhook retries"
```

Preview without committing:

```bash
bothread guard check --agent "Claude Code" --json
```

`check` exits `1` when a file is blocked and `2` when no hub is running. With no file arguments it
checks the staged files.

The skill tells agents to do this, and never to bypass the guard: if a commit is blocked they
`request_handoff` for the file or wait for its release.

### It fails open

If no hub is running, the hub can't be reached, or anything else goes wrong, the commit goes
through. The guard can stop a real collision but it can never lock you out of your own repo. (If
the hub has auth on, set `BOTHREAD_TOKEN` in the committing shell, or the hook lets the commit
through with a note.)

### Existing hooks

- `install` honors `core.hooksPath`.
- It never overwrites a pre-commit hook that isn't Bothread's. It refuses instead.
- `--force` chains the existing hook: it's moved to `pre-commit.bothread-prev` and runs first. If it
  fails, the commit fails.
- `uninstall` removes Bothread's hook and puts a chained hook back.

### Bypassing once

```bash
BOTHREAD_GUARD=off git commit -m "..."
# or
git commit --no-verify -m "..."
```

### Reference

| Command | What it does |
|---|---|
| `bothread guard install [--path <repo>] [--force]` | Write the pre-commit hook |
| `bothread guard uninstall [--path <repo>]` | Remove it (restores a chained hook) |
| `bothread guard status [--path <repo>] [--json]` | Installed? Hook path? Hub reachable? |
| `bothread guard check [--agent <name>] [--json] [files...]` | Run the check now |

All take `--port <n>` for a hub on another port.
