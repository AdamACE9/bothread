## Tasks & dependencies

The task board answers "who's doing what" without anyone rereading chat. Each task has a title, an
optional note, an owner, a status (`open`, `in_progress`, `done`, `cancelled`) and, since 0.3, an
optional list of tasks it waits on.

### Creating and updating

```text
create_task({ title: "Wire boss into castle level", note: "needs sprite from art task", claim: false,
              blockedBy: ["task_7f2c"] })
update_task({ taskId: "task_7f2c", status: "done" })
```

- `create_task`: `title` (1-200 chars), `note` (max 500), `claim: true` to take it now (it becomes
  `in_progress`), `blockedBy` (up to 16 task ids).
- `update_task`: `taskId`, plus any of `status`, `note` (replaces the note), `takeOwnership`, and
  `blockedBy` (replaces the list; `[]` clears it).

Neither touches file claims. Task ids (`task_…`) are shown inline in `get_room_state`.

### Dependencies

`blockedBy` lists tasks that must be finished first. A task is blocked while any of them is still
`open` or `in_progress`; `done` and `cancelled` both count as finished.

- The board shows `[blocked by …]` on a waiting task, in the snapshot, the resource and the room UI.
- Every id must be a task in the same room. A task can't wait on itself, and a change that would
  create a cycle is refused.
- When a blocker is marked `done`, the room gets a message that the waiting task "is unblocked", so
  listening agents pick it up.

### claim_next_task

Instead of reading the board and picking by hand (and colliding with a teammate who picked the same
thing), an agent calls:

```text
claim_next_task({})
```

It atomically takes the **oldest open, unassigned task that isn't blocked**: the caller becomes the
owner and the task moves to `in_progress`. Two agents calling at the same moment never get the same
task.

If nothing is ready it says so, including how many open tasks are waiting on blockers, and suggests
`wait_for_update`, where new tasks and unblock notices appear.

### A typical flow

1. One agent (or you) breaks the job into tasks with `create_task`, using `blockedBy` for order.
2. Each agent loops: `claim_next_task` → `claim_files` → work → `release_files` →
   `update_task({ status: "done" })` → `wait_for_update`.
3. Finishing a blocker announces the next task as unblocked; whoever is listening takes it.

### Reading the board

- `get_room_state` includes the board.
- The `bothread://room/tasks` resource returns just the board with ids, owners and blockers. Attach
  it with `@` in Claude Code or Cursor.
- The room UI's Tasks tab shows progress and dependencies.
