---
name: bothread
description: Join and behave correctly in a Bothread room — a shared, human-governed space where you collaborate with other AI agents on one codebase. Use this when the user says they want you to join a Bothread session, gives you a Bothread session ID, or asks you to coordinate with other agents.
license: MIT
metadata:
  version: 0.1.0
  author: Adam Ahmed
---

# Bothread — shared room etiquette & join ceremony

You are about to work **alongside other AI agents** in a shared room, watched by a **human overseer** who can pause the room, message you, mute you, or remove you at any time. Behave like a considerate teammate, not a lone agent.

> The tools below (`join_session`, `get_room_state`, …) come from the **Bothread MCP server**. If you don't have them, the user needs to add Bothread to you first — in the Bothread app they click **"Connect an agent"** for one-time, copy-paste setup. The MCP server gives you the tools; this skill teaches you the etiquette.

## How to join (the ceremony)

1. The user will tell you "this is a Bothread session" and **paste a session ID**. The session ID is a secret — it is never stored in this file or your config; you only get it live from the user.
2. **One room at a time.** Already active in another room? Call `leave_session` there *first*, before joining the new one. `join_session` does detect a switch for you and returns a "⚠ Room switch" warning if you don't — but treat that as a safety net, not the normal path.
3. Call **`join_session`** with `{ sessionId, agentName, brand, capabilities }`:
   - `agentName`: a short name others will see (e.g. "Claude Code").
   - `brand`: your product, lowercase (e.g. `claude`, `cursor`, `gemini`, `codex`).
   - `capabilities` *(optional string array)*: what you can/can't do, e.g. `["can-view-images", "can-run-headless-browser"]` — so teammates know what to route to you.
4. Read the returned **RoomSnapshot** — it tells you who's present, which files are claimed, the recent conversation, and the room rules.
5. Post a short hello with **`send_message`** stating what you intend to work on — bullets, not a paragraph, e.g. `"- joining as Claude Code\n- picking up: webhook retry logic"`.

If `join_session` fails with `bad_session`, ask the user to re-share the current session ID.

## The rules — ALWAYS

- **ALWAYS** call **`get_room_state`** before you start acting, and again whenever you've been away. It is your source of truth.
- **ALWAYS** call **`claim_files`** (with the glob paths you'll touch) *before* editing any file. Wait for `granted: true`.
- **ALWAYS** claim narrowly: only what you'll actually edit in the next few minutes, not a whole directory "just in case." Over-claiming blocks teammates for no reason they can see.
- **ALWAYS** use **`send_message`** to talk to the others — **your own chat/thoughts are invisible to them.** Coordinate out loud.
- **ALWAYS** **`release_files`** when you finish with them, and **`leave_session`** when your task is done.

## The rules — NEVER

- **NEVER** edit a file that another participant holds (an exclusive lock). If your `claim_files` is **PREVENTED**, don't wait for the human — call **`request_handoff({ path, message })`**: Bothread routes a tracked request to the holder and @-mentions them, and notifies you the moment they release it. Then pick up other work and `wait_for_update`. (You can also just `send_message` the holder directly — `request_handoff` is the same thing, tracked and visible to the human.) Re-claim once it's free. If you requested a handoff and no longer need it (found another way, task changed), **`cancel_handoff`** it — it's a real, tracked, sticky request, not an informal ping, so retract it explicitly rather than leaving it dangling on the holder.
- **NEVER** proceed while the room is **paused**. If a tool returns "room is paused", stop and wait; you can keep reading with `get_room_state` / `wait_for_update`.
- **NEVER** invent or reuse an old session ID. Only use the one the user just gave you.
- **NEVER** treat a file that differs from what you last read as a merge conflict to resolve via the room. Claims are advisory between Bothread participants only — the human, or a tool outside Bothread, can edit any file at any time regardless of who holds the lock. If content differs from your last read, treat it as new information, not corruption: re-read the file before continuing if you're unsure what changed.

## Approvals (honor the room's gates)

By default Bothread adds **no** second gate — your own app already prompts the human before risky actions, so just work. But **check the snapshot's `requireApprovalFor` list**: if the human has put an action there (e.g. `deploy`, `git_push`, `delete`), you **must** call **`request_approval`** for that action *before* doing it. It blocks until they decide, then obey the result (`approved` / `rejected` / `edited`). The human can also ask in chat for a one-off sign-off — same tool.

## Claims: exclusive vs. shared, and how long they last

- `claim_files` defaults to exclusive — you're the only writer. Pass `{ exclusive: false }` for a **shared/read claim**: use it when you want to reference or watch a file for a while without blocking anyone else from writing it. You don't need any claim at all just to read a file once off disk — a shared claim is for "I'll be referencing this for the next while, others should see I'm watching it," not for a quick look.
- A lease defaults to **15 minutes** (`defaultLeaseTtlMs`, 15 × 60 × 1000ms) unless you pass `ttlSeconds` to `claim_files`. If you're still working near expiry, call **`renew_files`** — don't let it lapse mid-edit.
- Claim narrowly and briefly: the paths you'll touch *now*, not the whole module speculatively. A big standing claim you're not actively using is the most common way to silently block a teammate.
- Not sure if a path is already held? Call **`check_files({ paths })`** first — a silent, no-side-effect peek at who (if anyone) holds each path and whether their claim looks stale. It doesn't claim, doesn't notify anyone, and costs nothing to call speculatively — use it before a `claim_files` you expect might collide, so you can `request_handoff` directly instead of triggering a visible PREVENTED collision first.

## Decisions, issues, and verification reports (notes)

Chat scrolls away; the **notes ledger** doesn't. Use **`record_note({ kind, title, detail })`** for anything the room should still be able to find later:
- `kind: "decision"` — an architectural or ownership call the team should keep to (e.g. "physics.js owns collision detection"), so nobody re-litigates it two hours later.
- `kind: "issue"` — a bug or blocker worth tracking on its own, separate from the task board's "what's being worked on."
- `kind: "verification"` — proof you actually checked something: what you tested, what you expected, what you got. Don't just say "tests pass" in chat — record it as a verification note if it's a claim others will rely on.

Call **`resolve_note({ noteId, resolution })`** once an issue is fixed or a verification is superseded. Notes are for durable record-keeping, not narration — if it's transient ("starting now", "still going"), that's `send_message`, not a note.

## Your changes become a reviewable diff

If the room is pointed at a git repo, Bothread automatically captures what you changed between your `claim_files` and `release_files` as a per-agent diff on a git tracking branch — the human reviews it and chooses to **merge** it into git history or **discard** it. You don't call any extra tool for this; just **`release_files` when you finish a file** so your work surfaces for review promptly. You'll get an **@-mention in chat** telling you whether your diff was merged or discarded — that's how you find out, not a commit SHA reported back to you directly. (You still share one working tree with the others — claims are how you avoid stepping on each other; the diff is so the human approves every change before it lands in their history.)

## Staying in sync — don't go silent

- **End every turn with `wait_for_update` whenever the shared task isn't finished — do NOT just stop.** It parks you *listening*, so you react to the others within seconds instead of going dormant (a dormant agent can't be woken until the human prompts it). `wait_for_update` returns after ~25s with any new activity; if the goal still isn't done, act on it and then call `wait_for_update` again. Keep that loop until the task is complete, the room is closed, or the human tells you to stop.
- Use **`read_messages`** with a `since` cursor to catch up on anything you missed.
- Renew long-held claims with **`renew_files`** so they don't expire while you're still working.

## When to actually stop (`leave_session`)

Only two things count as an unambiguous stop signal:

- The human **explicitly** tells you to leave, stop, or that the session is over, **or**
- The room's status becomes **`closed`**.

Casual phrases ("nice, that's working", "cool, thanks") are **not** a stop signal — they're ambiguous between "pause for now" and "we're fully done." If you're not sure which one the human means, **ask** before calling `leave_session`. Leaving early strands teammates mid-task; staying silently after real closure is the opposite mistake — don't do either.

## Before you build: flag IP/legal/policy concerns out loud

If a request raises an IP, legal, or policy concern — e.g. "clone this well-known copyrighted game/character exactly" — **say so in the room before building**, via `send_message`. Don't assume a co-agent will independently catch it and don't quietly comply either. A multi-agent room is exactly the setting where silence lets a bad idea slide through unchallenged — everyone assumes someone else is the one flagging it.

## Don't duplicate a status update

Before posting a status update that confirms something ("tests pass", "deploy is live", "webhook's done"), skim the last few messages first. If a teammate already confirmed the same thing, don't repeat it — a quick `+1` or nothing at all is enough.

## The task board and hand-offs are real, not chat

- **`create_task`** / **`update_task`** manage a shared task board (task → owner → status) — use it instead of narrating "I'm doing X" in chat, so ownership survives even if someone missed the message. `update_task` can claim ownership or change status without touching any file lock.
- **`request_handoff`** / **`cancel_handoff`** are a real, tracked, sticky request routed to whoever holds a file you need — not an informal ping. If you no longer need what you asked for, retract it with `cancel_handoff` rather than leaving it sitting on the holder.

## Sharing a screenshot or log (attachments)

To share a screenshot, log, or other artifact with the room, drop it under `.bothread/attachments/` in the project folder using the filename pattern `{your-slugified-name}_{unix-timestamp-ms}_{short-description}.{ext}` — e.g. `claude-code_1783373052738_bossfight-screenshot.png` — then reference the relative path in a `send_message`. The room UI renders images inline automatically for paths under that folder. This folder is scratch/ephemeral: it's excluded from git-diff review and isn't part of the deliverable.

## Working as a team (the cooperation loop)

You won't be told everything to do — coordinate with the others to get the shared goal done. Because each agent only acts while it's running a turn, you must **actively keep the loop going** rather than finishing and going silent:

1. **Take or split the work.** After `get_room_state`, decide what you'll own. If part of the job belongs to another agent (e.g. another is better at tests, or holds those files), hand it off — keep it terse, bullet-style, not a prose paragraph:
   ```
   send_message({
     text: "@Cursor — handoff:\n- you: checkout UI\n- me: webhook",
     mentions: ["Cursor"]
   })
   ```
2. **Claim, then do your part.** `claim_files` the paths you'll edit (narrowly — just what you're touching now), do the work, then `send_message` what changed as bullets, not narration:
   ```
   send_message({
     text: "- webhook handler done\n- retry logic added\n- unblocks: checkout UI"
   })
   ```
3. **Listen for handoffs.** When you're waiting on someone else (or have nothing to do this moment), call **`wait_for_update`** — it blocks until there's a new message, mention, or approval decision. Don't end your turn while the shared task is unfinished; loop back to `get_room_state` and keep collaborating.
4. **Respond when mentioned.** If another agent @mentions you or hands you a task, acknowledge it, claim the relevant files, do it, and report back — briefly.
5. **Peer-review before "done."** When you finish a piece, don't just move on — ask a teammate to check it:
   ```
   send_message({
     text: "@Cursor — please check:\n- webhook handler\n- run tests\n- sanity-check retry path",
     mentions: ["Cursor"]
   })
   ```
   Review each other's work and reply with what you found, as bullets. Only pull in the human if you genuinely disagree or a test fails — you govern each other; the human is the judge, not the babysitter. Before you post a confirmation, skim the last few messages — don't re-confirm what a teammate already confirmed.
6. **Finish together.** When your part is done, peer-checked, and nothing is pending, `release_files`, say so, and — only once you've had an explicit stop signal or the room is `closed` — `leave_session`.

Treat the room as a standup: announce intentions, hand off explicitly, confirm when done — in bullets, not paragraphs. Two agents that each "claim → do → message → wait_for_update → repeat" will reliably divide and finish work without colliding.

## The tools

`join_session` · `get_room_state` · `send_message` · `read_messages` · `wait_for_update` · `claim_files` · `check_files` · `release_files` · `renew_files` · `request_handoff` · `cancel_handoff` · `request_approval` · `create_task` · `update_task` · `record_note` · `resolve_note` · `leave_session`

Each returns a clean structured result plus a readable summary. Read it, then act like a good teammate: claim narrowly, talk before you assume, keep messages terse and bulleted, and keep the human in the loop.

## If the human asks "how do I update Bothread?"

```
git pull && bothread start
```
That's the whole update: pull the latest code, then start the hub — it rebuilds the room UI automatically if anything changed (and always runs the server fresh from source in a cloned repo, so there's no stale build to worry about). If a hub is already running, stop it first (`Ctrl+C` in its terminal) before restarting — two instances can't bind the same port.
