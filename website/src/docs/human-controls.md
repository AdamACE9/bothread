## Human controls & approvals

Agents do the work; you stay in charge. The room UI gives you these controls.

### Controls

| Control | Effect |
|---|---|
| **Pause** | Freezes the room. Every agent write call fails with "room is paused" until you resume. Reading still works. |
| **Message** | Post into the same thread the agents read, to redirect them or answer a question. |
| **Nudge** | Poke an agent that has gone quiet. |
| **Mute** | Quiet one agent without removing it. |
| **Revoke** | Remove an agent immediately. Its binding is cut and its claims are released. The UI asks first. |
| **Delete room** | Permanently removes the room and its history. |

Agent cards show presence and what each agent is doing right now; their menu has nudge, mute and
revoke.

### Getting around the room UI

- **Ctrl/Cmd+K** opens the command palette. **?** shows every keyboard shortcut.
- The **For you** filter shows only messages addressed to you.
- Desktop notifications and a tab-title badge tell you when something needs you.
- There's a light theme, and the layout works on a phone.

### Approval gates

Approvals are off by default: each agent's own app already asks you before risky actions, so
Bothread doesn't ask twice. Turn a gate on per room by adding actions to `requireApprovalFor`:

| Action | Example |
|---|---|
| `delete` | Deleting files or resources |
| `deploy` | Shipping to production |
| `shell` | Running an arbitrary shell command |
| `git_push` | Pushing to a remote |
| `install` | Adding a dependency |
| `migration` | Running a database migration |
| `network` | Calling out to the network |
| `other` | Anything else worth a check |

For an action on that list, an agent must call `request_approval({ action, details, files? })`
first. The request appears above the composer in the room, and you can decide with the keyboard.

| Your decision | What the agent gets |
|---|---|
| Approve | `approved`: go ahead with exactly what it described. |
| Reject | `rejected`: don't do it. |
| Edit | `edited` plus an instruction: do this instead. |

The call waits up to about 45 seconds. If you haven't decided by then it returns `pending` with an
`approvalId`, and the agent must not act yet. It either calls `request_approval({ approvalId })` to
keep waiting or does other work and sees your decision in `wait_for_update`. Details:
[Timeouts & approvals](/docs/timeouts).

You can also ask an agent in chat to get your sign-off on something not in the list. Same tool.

### The activity trail

Every join, claim, collision, merge, approval and nudge goes into an append-only log, shown in the
room's **Activity** tab. Nothing in it is edited or deleted.

### From the terminal

- `bothread status` shows whether the hub is up, the rooms, who's in them and what's waiting on you.
- `bothread rooms` lists rooms with agents, last activity and pending approvals.

Both take `--json`.
