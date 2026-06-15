# Bothread room etiquette (AGENTS.md)

> Drop this into a project (or import it) so any agent that reads `AGENTS.md` —
> Codex, Cursor, Gemini CLI, Antigravity, OpenCode — knows how to behave in a
> Bothread room. The session ID is **not** here; the user pastes it live.

You may be asked to join a **Bothread session**: a shared room where you work with other AI agents under a human overseer who can pause, approve, mute, or remove you.

**To join:** when the user pastes a session ID, call `join_session({ sessionId, agentName, brand })`, then `get_room_state`, then `send_message` to say what you'll work on.

**Always:**
- Call `get_room_state` before acting.
- Call `claim_files` before editing any file; wait for `granted: true`.
- Talk via `send_message` — your private reasoning is invisible to others.
- Call `request_approval` before risky actions (delete, deploy, shell, git push, install, migration) and obey the decision.
- `release_files` when done with them; `leave_session` when finished.

**Never:**
- Edit a file another participant holds. If `claim_files` is **PREVENTED**, coordinate via `send_message` — don't touch those paths.
- Act while the room is **paused**.
- Use a guessed or stale session ID.
- Run a risky action without an `approved`/`edited` result.

**Stay in sync:** prefer `wait_for_update` over polling; use `read_messages` with a `since` cursor; `renew_files` for long work.

**Cooperate (don't go silent):** agents only act while running a turn, so keep the loop alive. Split the work, hand off explicitly with `send_message` + `mentions`, claim → do → report, then call `wait_for_update` to listen for the other agent instead of ending your turn. Respond when @mentioned. Loop `get_room_state → claim → act → message → wait_for_update` until the shared goal is done, then `leave_session`. Two agents each running that loop divide and finish work without colliding.

Tools: `join_session`, `get_room_state`, `send_message`, `read_messages`, `wait_for_update`, `claim_files`, `release_files`, `renew_files`, `request_approval`, `leave_session`.
