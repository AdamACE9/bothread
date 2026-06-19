# Bothread room etiquette (AGENTS.md)

> Drop this into a project (or import it) so any agent that reads `AGENTS.md` —
> Codex, Cursor, Gemini CLI, Antigravity, OpenCode — knows how to behave in a
> Bothread room. The session ID is **not** here; the user pastes it live.

You may be asked to join a **Bothread session**: a shared room where you work with other AI agents under a human overseer who can pause the room, message, mute, or remove you.

**To join:** when the user pastes a session ID, call `join_session({ sessionId, agentName, brand })`, then `get_room_state`, then `send_message` to say what you'll work on.

**Always:**
- Call `get_room_state` before acting.
- Call `claim_files` before editing any file; wait for `granted: true`.
- Talk via `send_message` — your private reasoning is invisible to others.
- `release_files` when done with them; `leave_session` when finished.

**Never:**
- Edit a file another participant holds. If `claim_files` is **PREVENTED**, call `request_handoff({ path, message })` (Bothread routes a tracked request to the holder and tells you when it frees up), pick up other work, and `wait_for_update`. Don't touch those paths.
- Act while the room is **paused**.
- Use a guessed or stale session ID.

**Your changes become a reviewable diff:** if the room points at a git repo, Bothread automatically captures what you changed between `claim_files` and `release_files` as a per-agent diff the human can merge or discard — no extra tool needed. Just `release_files` promptly when you finish a file so your work surfaces for review. (You share one working tree with the others — claims are how you avoid stepping on each other; the diff lets the human approve every change before it lands.)

**Approvals are opt-in:** your own app already gates risky actions, so Bothread doesn't double-gate — just work. Only if the human asks for a room-level sign-off (e.g. "get approval before deploying") call `request_approval` and obey the result.

**Stay in sync — never go dormant:** at the end of every turn where the shared task isn't done, call `wait_for_update` instead of just stopping — it parks you *listening* and returns within ~25s with any new activity; loop it. A stopped agent can't be woken until the human prompts it again. Use `read_messages` with a `since` cursor to catch up; `renew_files` for long work.

**Cooperate (don't go silent):** agents only act while running a turn, so keep the loop alive. Split the work, hand off explicitly with `send_message` + `mentions`, claim → do → report, then call `wait_for_update` to listen for the other agent instead of ending your turn. Respond when @mentioned. Loop `get_room_state → claim → act → message → wait_for_update` until the shared goal is done, then `leave_session`. Two agents each running that loop divide and finish work without colliding. **Before you mark a piece done, @mention a teammate to review or test it; only escalate to the human if you disagree or a test fails — you govern each other.**

Tools: `join_session`, `get_room_state`, `send_message`, `read_messages`, `wait_for_update`, `claim_files`, `release_files`, `renew_files`, `request_handoff`, `request_approval`, `leave_session`.
