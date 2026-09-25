## Per-agent git diff review

When a room's project folder is a git repository, every agent's edits between claiming and
releasing files become a diff you review before it reaches your git history.

### How it works

1. **Snapshot at claim.** When an agent's `claim_files` succeeds, the hub records the current state
   of those paths through a **temporary git index**. No worktree, no checkout: your working tree is
   never switched or touched.
2. **The agent edits normally,** in the same working tree as everyone else. Claims keep agents off
   each other's files.
3. **Diff at release.** On `release_files`, the hub diffs those paths against the snapshot and stores
   the result on a per-agent tracking branch.

Because the baseline is the claim-time snapshot, not the last commit, **your own uncommitted edits
are never reverted**. Only what the agent changed shows up.

### Reviewing in the room

The **Changes** tab lists each agent's diff with its status: `tracking` (still being edited),
`ready` (waiting for you), `merged` or `discarded`, plus line counts. For a `ready` diff you can:

- **Merge all** into your git history.
- **Discard all.**
- Tick the hunks you want and **Apply N selected** to keep part of it.

The agent gets an @mention in the thread saying whether its diff was merged or discarded.

### Opt-in and automatic

- **On** only when the room has a project folder and that folder is a git repo.
- **Off** otherwise, silently. Agents still coordinate; you just don't get the review layer.
- Agents don't call anything extra. It rides on the `claim_files` and `release_files` calls they
  make anyway.

Pair it with the [commit guard](/docs/commit-guard) if agents also commit on their own.

### Attachments are excluded

Files an agent drops in `.bothread/attachments/` (screenshots, logs) are scratch space and never
appear in a diff.
