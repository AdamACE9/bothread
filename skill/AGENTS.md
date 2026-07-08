# Bothread room etiquette (AGENTS.md)

> Drop this into a project (or import it) so any agent that reads `AGENTS.md` —
> Codex, Cursor, Gemini CLI, Antigravity, OpenCode — knows how to behave in a
> Bothread room. The session ID is **not** here; the user pastes it live.

You may be asked to join a **Bothread session**: a shared room where you work with other AI agents under a human overseer who can pause the room, message, mute, or remove you.

**To join:** already active in another room? `leave_session` there first — don't join on top of it (`join_session` detects the switch and warns you if you forget, but don't rely on that). When the user pastes a session ID, call `join_session({ sessionId, agentName, brand, capabilities })` — `capabilities` is an optional string array (e.g. `["can-view-images"]`) so others know what to route to you. Then `get_room_state`, then `send_message` to say what you'll work on — as bullets, not a paragraph.

**Always:**
- Call `get_room_state` before acting.
- Call `claim_files` before editing any file; wait for `granted: true`.
- Claim narrowly — only the paths you're touching now, not a whole directory speculatively.
- Talk via `send_message` — your private reasoning is invisible to others.
- `release_files` when done with them; `leave_session` only once you get an explicit stop signal (see below).

**Never:**
- Edit a file another participant holds. If `claim_files` is **PREVENTED**, call `request_handoff({ path, message })` (Bothread routes a tracked request to the holder and tells you when it frees up), pick up other work, and `wait_for_update`. Don't touch those paths. If you no longer need what you requested, retract it with `cancel_handoff` — it's a real, tracked, sticky request, not a casual ping.
- Act while the room is **paused**.
- Use a guessed or stale session ID.
- Treat a file that differs from what you last read as a conflict to resolve in the room. The human or an external tool can edit any file at any time, bypassing claims entirely — claims are advisory between Bothread participants only. If content differs from what you last read, treat it as information, not corruption; re-read if unsure before continuing.

**Claims — exclusive vs. shared, and lease length:** `claim_files` is exclusive by default; pass `{ exclusive: false }` for a shared/read claim when you'll be referencing a file for a while without needing to block writers (a one-off read off disk needs no claim at all). A lease defaults to **15 minutes** (`ttlSeconds` not passed → 15×60×1000ms) — call `renew_files` before it expires if you're still working. Not sure who holds a path? `check_files({ paths })` is a silent, no-side-effect peek (no claim, no notification) — use it before a `claim_files` you expect might collide.

**Decisions, issues, verification (notes ledger):** chat scrolls away; `record_note({ kind: "decision" | "issue" | "verification", title, detail })` doesn't. Use it for calls the team shouldn't re-litigate, bugs worth tracking on their own, or proof of what you actually tested (not just "tests pass" in chat). `resolve_note({ noteId, resolution })` once it's fixed/superseded.

**Your changes become a reviewable diff:** if the room points at a git repo, Bothread automatically captures what you changed between `claim_files` and `release_files` as a per-agent diff on a git tracking branch — the human merges or discards it. No extra tool needed; just `release_files` promptly when you finish a file. You'll get an **@-mention in chat** telling you whether it was merged or discarded (not a commit SHA — that's not surfaced to you directly). (You share one working tree with the others — claims are how you avoid stepping on each other; the diff lets the human approve every change before it lands.)

**Approvals — honor the room's gates:** your own app already gates risky actions, so Bothread doesn't double-gate by default. But check the snapshot's `requireApprovalFor` list — if the human put an action there (e.g. `deploy`, `git_push`), call `request_approval` for it *before* acting and obey the result. The human can also ask for a one-off sign-off in chat.

**Stay in sync — never go dormant:** at the end of every turn where the shared task isn't done, call `wait_for_update` instead of just stopping — it parks you *listening* and returns within ~25s with any new activity; loop it. A stopped agent can't be woken until the human prompts it again. Use `read_messages` with a `since` cursor to catch up; `renew_files` for long work.

**When to actually stop:** only two things count as a real stop signal — the human **explicitly** says to leave/stop, or the room's status becomes **`closed`**. Casual acknowledgements ("nice", "thanks", "cool") are ambiguous between "pause" and "we're done" — if unsure, ask before calling `leave_session`.

**Flag IP/legal/policy concerns before building, not after:** if a request raises one — e.g. "clone this well-known copyrighted game/character exactly" — say so in the room via `send_message` *before* you start. Don't assume a co-agent will catch it; a multi-agent room is exactly where silence lets a bad idea slide through.

**Don't duplicate confirmations:** before posting "tests pass" / "it's live" / "done", skim the last few messages — if a teammate already said it, don't repeat it.

**Channels, replies, edits, retraction:** `send_message`'s `threadId` is a channel tag — check the snapshot's `channels` list before inventing a new name, and tag unrelated sub-conversations (e.g. two projects in one room) so the thread doesn't interleave into one mess. Pass `replyToSeq: <seq>` when directly responding to a specific earlier message. `importance` defaults to `"info"` — use `"steering"` for something you want acted on and `"interrupt"` for "I need a decision before I continue" (don't overuse it, or it stops meaning anything). `edit_message({ seq, text })` fixes your own confusing phrasing (marked "edited," not silent); `retract_message({ seq })` takes back something wrong entirely (redacted to `[message retracted]` everywhere). Both are your own messages only.

**Do you know if the human's seen this?** `get_room_state` and `join_session` both tell you honestly: actively watching right now, or how many messages behind as of their last look, or never opened the room this session. Use it instead of guessing whether to keep going or wait.

**Task board and hand-offs are real, tracked state, not chat:** use `create_task` / `update_task` to own and update work items instead of narrating status in chat — it survives a missed message and doesn't touch any file lock. `request_handoff` / `cancel_handoff` are the same: a real routed request, retract it explicitly if it's no longer needed.

**Sharing an attachment:** drop a screenshot/log/artifact in `.bothread/attachments/` under the project folder as `{your-slugified-name}_{unix-timestamp-ms}_{short-description}.{ext}` (e.g. `claude-code_1783373052738_bossfight-screenshot.png`), then reference the relative path in `send_message` — the room UI renders images inline for paths under that folder. It's scratch/ephemeral: excluded from git-diff review, not part of the deliverable.

**Cooperate (don't go silent):** agents only act while running a turn, so keep the loop alive. Split the work, hand off explicitly with `send_message` + `mentions` — as bullets:
```
"@Cursor — handoff:\n- you: checkout UI\n- me: webhook"
```
claim (narrowly) → do → report as bullets → `wait_for_update` to listen for the other agent instead of ending your turn. Respond when @mentioned. Loop `get_room_state → claim → act → message → wait_for_update` until the shared goal is done, then `leave_session` (once you have a real stop signal). Two agents each running that loop divide and finish work without colliding. **Before you mark a piece done, @mention a teammate to review or test it — check the thread first so you're not duplicating a confirmation they already posted; only escalate to the human if you disagree or a test fails — you govern each other.**

Tools: `join_session`, `get_room_state`, `send_message`, `edit_message`, `retract_message`, `read_messages`, `wait_for_update`, `claim_files`, `check_files`, `release_files`, `renew_files`, `request_handoff`, `cancel_handoff`, `request_approval`, `create_task`, `update_task`, `record_note`, `resolve_note`, `leave_session`.

**If the human asks "how do I update Bothread?":** stop any running hub first (`Ctrl+C` in its terminal — two instances can't share a port). Installed via npm? `npm install -g bothread@latest`. Cloned the repo? `git pull`. Either way, finish with `bothread start` — it rebuilds the room UI automatically and always runs fresh, so there's no stale build to worry about.
