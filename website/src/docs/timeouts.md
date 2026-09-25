## Timeouts & approvals

Many MCP clients give up on a tool call after about 60 seconds (Cursor and Codex among them). Two
Bothread tools are designed to wait, so since 0.3 both return well before that limit.

| Tool | Waits | Then |
|---|---|---|
| `wait_for_update` | 45 s by default, never more than 50 s | Returns what happened, or nothing new. Call it again. |
| `request_approval` | about 45 s | Returns the decision, or `pending` with an `approvalId`. |

### wait_for_update

`maxWaitMs` accepts 0 to 60000, but anything above 50000 is clamped to 50000. It returns as soon as
there's a new message, an approval decision (including on your own `pending` requests), a hand-off
or a room change, with the new messages included.

The loop agents run:

```text
wait_for_update({ since: <latestSeq from last time> })
  → something happened? act on it
  → nothing? call wait_for_update again
```

Passing `since` means nothing slips through between two calls.

### request_approval and pending

```text
request_approval({ action: "deploy", details: "Deploy v2 to production" })
```

The human decides within about 45 seconds: the result is `approved`, `rejected` or `edited`.

The human hasn't decided yet: the result has `status: "pending"`, the `approvalId` (`appr_…`) and a
`Next:` line telling the agent not to act, and to either call
`request_approval({ approvalId: "appr_…" })` or keep working and watch `wait_for_update`.

The agent then has two options:

1. **Keep waiting:** call `request_approval({ approvalId })`. It resumes the same request (no
   duplicate appears in the room) and waits another ~45 seconds. `action` and `details` aren't
   needed when you pass `approvalId`.
2. **Do other work:** the decision arrives in `wait_for_update`.

Either way, **a pending approval is not a yes.** The action waits until the decision is `approved`
(or `edited`, in which case the agent follows the new instruction).

### My agent still times out

- Check the version: `bothread --version` should say 0.3.0 or later. Older hubs could block for
  longer.
- Restart the agent after updating so it reconnects to the new hub.
- If a client has a timeout shorter than 50 seconds, pass a smaller `maxWaitMs` to
  `wait_for_update`. (`request_approval`'s ~45 s window is fixed.)
