/** A clean, agent-readable error. `code` is stable; `message` is for the model. */
export class BothreadError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "BothreadError";
  }
}

/**
 * The single next step an agent should take after a given error code. Rendered
 * as a "Next:" line under every MCP error so the agent never has to guess how to
 * recover. Only codes an agent can actually hit over MCP are listed; the rest
 * (overseer-only REST paths) fall back to a generic hint.
 */
const NEXT_STEP: Record<string, string> = {
  not_joined:
    "call join_session with the session ID the human pasted to you. Never guess one — if you don't have it, ask the human for it.",
  bad_session:
    "use exactly the session ID the human pasted (never guess one). If it's a different room, call join_session with it; otherwise omit the sessionId argument. If it still fails, ask the human to re-share the ID.",
  no_room: "the room no longer exists. Ask the human for a current session ID, then call join_session with it.",
  closed: "the room is over — stop working in it and tell your human. Only join again if they give you a new session ID.",
  revoked: "stop. The human removed you from this room — don't retry; tell your human what happened.",
  left: "you left this room. Call join_session again (same session ID) if you should still be here.",
  paused:
    "the human paused the room. Don't edit files. Call wait_for_update (reading still works) and retry once the room resumes.",
  muted:
    "the human muted you. You can still read (get_room_state, read_messages, wait_for_update) — call wait_for_update until you're un-muted.",
  not_found: "call read_messages (or get_room_state) to find the right message seq, then retry.",
  forbidden: "you can only edit/retract your OWN messages. Call read_messages to find the seq of one you sent.",
  bad_input: "that message is already retracted — nothing more to do. Send a new message with send_message if needed.",
  no_task: "call get_room_state to get current task ids (shown as `(task_…)` on the task board), then retry.",
  no_note: "call get_room_state to get current note ids (shown as `<kind> note_…: <title>` under Notes), then retry.",
  no_handoff: "call get_room_state to get current hand-off ids (shown under Open hand-off requests), then retry.",
  not_yours:
    "you can only cancel hand-off requests YOU made. Call get_room_state to see which are yours; to free a file you hold, use release_files.",
  invalid_arguments: "fix the arguments to match the tool's input schema and call it again.",
  no_approval:
    "check the approvalId from your earlier request_approval result (it looks like appr_…). If you've lost it, call wait_for_update — decisions on your requests show up there.",
  not_your_approval:
    "you can only wait on approvals YOU requested. To ask for your own, call request_approval({ action, details }).",
  bad_blocker:
    "blockedBy must list OTHER tasks that this one waits on, with no cycles. Check the task ids on the board (get_room_state) and retry.",
  unknown_tool:
    "use one of Bothread's tools: join_session, get_room_state, send_message, read_messages, wait_for_update, claim_files, check_files, release_files, …",
};

/** The "Next:" hint for an error code (a generic fallback for unknown codes). */
export function nextStepFor(code: string | undefined): string {
  return (code && NEXT_STEP[code]) || "call get_room_state to re-orient, then retry or tell the human if it keeps failing.";
}
