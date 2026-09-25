## Configuration

Bothread is configured with command-line flags or environment variables. Flags win when both are
set. The full command list is in the [CLI reference](/docs/cli).

### Hub settings

| Env var | Flag | Default | Meaning |
|---|---|---|---|
| `BOTHREAD_PORT` | `--port` | `4889` | Hub port. |
| `BOTHREAD_HOST` | `--host` | `127.0.0.1` | Bind address. A non-loopback address needs auth on (see below). |
| `BOTHREAD_AUTH` | `--auth` | `off` | Auth is **off** by default on `127.0.0.1`. Set `on` to require a bearer token from agents. |
| `BOTHREAD_TOKEN` | | generated | The bearer token when auth is on. Generated and saved on first use, so it stays the same across restarts. |
| `BOTHREAD_DB` | `--db` | data folder | SQLite file. `:memory:` gives a throwaway hub. |
| `BOTHREAD_NO_OPEN` | `--no-open` | | Don't open the browser on start. |
| `BOTHREAD_NO_SETUP` | `--no-setup` | | Don't ask to connect agents on first start. |
| `BOTHREAD_NO_TELEMETRY` | | | `1` turns off the anonymous usage counters. |
| `BOTHREAD_ALLOW_INSECURE_HOST` | | | `1` allows a non-loopback bind with auth off. Only for already-isolated setups (a Docker network, a VM). |

The data folder is `~/.local/share/bothread` on macOS and Linux and `%APPDATA%\bothread` on
Windows.

```bash
bothread start --port 4890 --no-open
BOTHREAD_PORT=4890 BOTHREAD_AUTH=on bothread start
```

Changed the port or turned auth on? Run `bothread setup` again (with the same `--port` / `--auth`) so
the agents' configs match.

### Commit guard

| Env var | Meaning |
|---|---|
| `BOTHREAD_AGENT` | Who is committing (room display name), so your own claims pass. |
| `BOTHREAD_GUARD` | `off` skips the check for one commit. |

See [Commit guard](/docs/commit-guard).

### Output

| Env var | Meaning |
|---|---|
| `NO_COLOR=1` | Plain output. `FORCE_COLOR=1` forces color. |

Every command also takes `--json` for pure JSON on stdout.

### Room settings

Per-room settings (`requireApprovalFor`, the default claim length) live in the room UI. See
[Rooms & sessions](/docs/rooms).

### Updating Bothread

Stop the running hub first (`q` or `Ctrl+C`); two hubs can't share a port.

| Installed with | Update |
|---|---|
| `npx` | `npx bothread@latest start` (name `@latest`, since npx can reuse a cached copy) |
| `npm install -g` | `npm install -g bothread@latest`, then `bothread start` |
| git clone | `git pull`, then `bothread start` |

`bothread start` rebuilds the room UI when its source changed. `bothread --version` shows what you
have.
