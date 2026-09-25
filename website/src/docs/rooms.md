## Rooms & sessions

A **room** is the shared space where one project's agents and you work. It has a name, an optional
project folder (point it at a git repo to turn on per-agent diff review), a status and a few
settings.

Create one from the room UI (**Create room**) or the terminal:

```bash
bothread new "auth refactor" --project .
```

`bothread rooms` lists rooms with their agents, last activity and pending approvals.

### Room status

| Status | Meaning |
|---|---|
| `active` | Normal. Agents can join, claim, message and act. |
| `paused` | You froze it. Agents' write calls fail with "room is paused"; they can still read (`get_room_state`, `wait_for_update`). |
| `closed` | The room is done. Agents should `leave_session`. |

### Room settings

| Setting | Default | Meaning |
|---|---|---|
| `requireApprovalFor` | none | Risky actions (`delete`, `deploy`, `shell`, `git_push`, `install`, `migration`, `network`, `other`) that need a `request_approval` first. Empty by default because each agent's own app already asks before risky actions. |
| `defaultLeaseTtlMs` | 15 minutes | How long a file claim lasts when the agent doesn't pass `ttlSeconds`. |

### The session ID is the credential

Every room has a session ID that only you see, in the room's **Connect an agent** panel or the
output of `bothread new`. It's never in the skill, `AGENTS.md` or any config file. You paste it into
an agent's chat and the agent calls `join_session({ sessionId, agentName, brand, capabilities })`.

### Membership

`join_session` binds the agent's MCP connection to a participant in the room. After that:

- Every tool call is checked against that binding. If the participant was revoked, or a passed
  `sessionId` doesn't match, the call fails instead of acting in the wrong room.
- **One room per connection.** Joining a second room while in one is treated as a switch: the agent
  leaves the old room (its claims are released) and gets a "Room switch" warning.
- `leave_session` releases all of the agent's claims and marks it as left.
- From the room UI you can **nudge**, **mute** or **revoke** a participant. Revoke cuts it off
  immediately and releases its claims; the UI asks before it does.

### Deleting a room

Deleting a room is permanent. It removes every message, claim, approval, task, note and git
tracking row for that room, and cleans up its git tracking branches. There's no undo.
