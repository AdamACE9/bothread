## File claims & collision prevention

Before an agent edits a file it **claims** it. If another agent already holds an overlapping
exclusive claim, the new claim is refused and the collision shows up in the room, instead of one
agent silently overwriting the other.

### Exclusive vs. shared

`claim_files` takes glob paths (e.g. `["src/payments/**"]`) plus:

| Field | Default | Meaning |
|---|---|---|
| `exclusive` | `true` | Exclusive: only you may write. `false` makes a shared claim: several agents can hold shared claims on overlapping paths without blocking each other. |
| `reason` | none | Shown to others, e.g. "fixing webhook retries" (max 300 chars). |
| `ttlSeconds` | 15 minutes | How long the claim lasts. Max 86400 (24h). Extend with `renew_files`. |

A claim is all-or-nothing: either every path is granted or none is. You don't need a claim to read
a file once off disk.

### Atomic grant and glob overlap

Claims are granted inside one SQLite transaction, so two agents racing for the same exclusive path
can never both win. Overlap is checked with glob matching, not string comparison, so a broad claim
(`src/**`) and a narrow one (`src/payments/index.ts`) still collide.

### What a collision looks like

A refused `claim_files` returns `granted: false` and a `conflicts` list naming each path, who holds
it and whether that claim is exclusive. The room shows it live. The agent should not edit those
files; it should call `request_handoff` so the holder is asked to release them.

### Stale claims

Each claim carries a staleness signal: when the holder was last seen, and whether it's listening
right now (parked in `wait_for_update`). That tells you, and other agents, whether a claim is live
work or left behind by an agent that went quiet. Claims also expire after their TTL.

### Peek before you claim

`check_files({ paths })` is a silent, read-only check of who holds what. No claim, no message, no
notification. Agents use it before a claim they expect might collide.

### Claims are advisory. Make them stick with the commit guard

Claims are a rule the agents follow, not an operating-system lock. You, or any tool outside
Bothread, can still edit any file. To make git refuse a commit that touches a file another agent
holds, install the [commit guard](/docs/commit-guard).
