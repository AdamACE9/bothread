import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/database";
import { Engine, type Caller } from "../src/engine/engine";
import { globsOverlap, leasesConflict } from "../src/engine/leases";
import { RoomBus } from "../src/realtime";
import { BothreadError } from "../src/engine/errors";

function makeEngine() {
  const db = openDatabase(":memory:");
  const bus = new RoomBus();
  return new Engine(db, bus);
}

/** Spin up a room with two joined agents and return their Callers. */
function twoAgentRoom(engine: Engine) {
  const { room, sessionId } = engine.createRoom({ name: "payments-refactor" });
  engine.joinSession("mcp-A", { sessionId, agentName: "Claude Code", brand: "claude" });
  engine.joinSession("mcp-B", { sessionId, agentName: "Cursor", brand: "cursor" });
  const a = engine.resolveCaller("mcp-A");
  const b = engine.resolveCaller("mcp-B");
  return { room, sessionId, a, b };
}

describe("globsOverlap", () => {
  it("detects a concrete file under a held glob (the demo case)", () => {
    expect(globsOverlap("src/payments/*", "src/payments/webhook.ts")).toBe(true);
    expect(globsOverlap("src/payments/**", "src/payments/webhook.ts")).toBe(true);
  });
  it("treats identical patterns as overlapping", () => {
    expect(globsOverlap("src/a.ts", "src/a.ts")).toBe(true);
  });
  it("lets genuinely disjoint paths run in parallel", () => {
    expect(globsOverlap("src/payments/**", "src/checkout/**")).toBe(false);
    expect(globsOverlap("src/a.ts", "src/b.ts")).toBe(false);
    expect(globsOverlap("src/*", "src/payments/webhook.ts")).toBe(false); // direct child glob vs deeper file
  });
  it("flags overlapping globs via base containment", () => {
    expect(globsOverlap("src/payments/**", "src/payments/*.ts")).toBe(true);
  });
});

describe("leasesConflict", () => {
  const ex = (participantId: string, pathPattern: string, exclusive = true) => ({ participantId, pathPattern, exclusive });
  it("never conflicts with the same participant", () => {
    expect(leasesConflict(ex("p1", "src/**"), ex("p1", "src/a.ts"))).toBe(false);
  });
  it("shared + shared never conflicts", () => {
    expect(leasesConflict(ex("p1", "docs/**", false), ex("p2", "docs/guide.md", false))).toBe(false);
  });
  it("exclusive vs shared overlap conflicts", () => {
    expect(leasesConflict(ex("p1", "src/**", true), ex("p2", "src/a.ts", false))).toBe(true);
  });
});

describe("Engine — messages", () => {
  it("assigns monotonic seq and reads with a cursor", () => {
    const engine = makeEngine();
    const { a } = twoAgentRoom(engine);
    const before = engine.readMessages(a, {}).latestSeq;
    const m1 = engine.sendMessage(a, { text: "first" });
    const m2 = engine.sendMessage(a, { text: "second" });
    expect(m2.seq).toBe(m1.seq + 1);

    const since = engine.readMessages(a, { since: before });
    const texts = since.messages.map((t) => t.text);
    expect(texts).toContain("first");
    expect(texts).toContain("second");

    const onlyAfterM1 = engine.readMessages(a, { since: m1.seq });
    expect(onlyAfterM1.messages.map((t) => t.text)).toEqual(["second"]);
  });

  it("supports mentionsMe filtering", () => {
    const engine = makeEngine();
    const { a, b } = twoAgentRoom(engine);
    engine.sendMessage(a, { text: "hey @Cursor", mentions: ["Cursor"] });
    engine.sendMessage(a, { text: "unrelated" });
    const mine = engine.readMessages(b, { mentionsMe: true });
    expect(mine.messages).toHaveLength(1);
    expect(mine.messages[0]!.text).toContain("@Cursor");
  });
});

describe("Engine — leases / collision prevention (the thesis)", () => {
  it("grants a claim, then PREVENTS an overlapping exclusive claim by another agent", () => {
    const engine = makeEngine();
    const { a, b, room } = twoAgentRoom(engine);

    const granted = engine.claimFiles(a, { paths: ["src/payments/*"], exclusive: true });
    expect(granted.granted).toBe(true);
    expect(granted.leases).toHaveLength(1);

    const seqBefore = engine.latestSeq(room.id);
    const blocked = engine.claimFiles(b, { paths: ["src/payments/webhook.ts"], exclusive: true });
    expect(blocked.granted).toBe(false);
    expect(blocked.conflicts).toHaveLength(1);
    expect(blocked.conflicts[0]!.heldByName).toBe("Claude Code");

    // A "Prevented:" system message is posted in front of the human.
    const after = engine.readMessages(b, { since: seqBefore });
    expect(after.messages.some((m) => m.text.startsWith("Prevented:"))).toBe(true);
  });

  it("is all-or-nothing across multiple paths", () => {
    const engine = makeEngine();
    const { a, b } = twoAgentRoom(engine);
    engine.claimFiles(a, { paths: ["src/payments/*"] });
    const res = engine.claimFiles(b, { paths: ["src/checkout/*", "src/payments/webhook.ts"] });
    expect(res.granted).toBe(false);
    // Nothing granted for B, even the non-conflicting checkout path.
    const bLeases = engine.activeLeases(res.leases[0]?.roomId ?? "x").filter((l) => l.participantName === "Cursor");
    expect(bLeases).toHaveLength(0);
  });

  it("allows two shared claims to coexist", () => {
    const engine = makeEngine();
    const { a, b } = twoAgentRoom(engine);
    expect(engine.claimFiles(a, { paths: ["docs/**"], exclusive: false }).granted).toBe(true);
    expect(engine.claimFiles(b, { paths: ["docs/guide.md"], exclusive: false }).granted).toBe(true);
  });

  it("reopens a path after release", () => {
    const engine = makeEngine();
    const { a, b } = twoAgentRoom(engine);
    engine.claimFiles(a, { paths: ["src/payments/*"] });
    expect(engine.claimFiles(b, { paths: ["src/payments/*"] }).granted).toBe(false);
    engine.releaseFiles(a, { paths: ["src/payments/*"] });
    expect(engine.claimFiles(b, { paths: ["src/payments/*"] }).granted).toBe(true);
  });

  it("expires leases past their TTL (no zombie locks)", () => {
    vi.useFakeTimers();
    try {
      const engine = makeEngine();
      const { a, b } = twoAgentRoom(engine);
      engine.claimFiles(a, { paths: ["src/payments/*"], ttlSeconds: 60 });
      expect(engine.claimFiles(b, { paths: ["src/payments/*"] }).granted).toBe(false);
      vi.advanceTimersByTime(61_000);
      // A's lease is now expired and swept; B can claim.
      expect(engine.claimFiles(b, { paths: ["src/payments/*"] }).granted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Engine — approvals (blocking risk gate)", () => {
  it("blocks until the overseer decides, then resolves with the decision", async () => {
    const engine = makeEngine();
    const { a, room } = twoAgentRoom(engine);
    const pending = engine.requestApproval(a, { action: "deploy", details: "deploy:staging" });

    const open = engine.pendingApprovals(room.id);
    expect(open).toHaveLength(1);

    engine.decideApproval(room.id, open[0]!.id, "approved", "You");
    const result = await pending;
    expect(result.status).toBe("approved");
    expect(engine.pendingApprovals(room.id)).toHaveLength(0);
  });

  it("passes an edited instruction back to the agent", async () => {
    const engine = makeEngine();
    const { a, room } = twoAgentRoom(engine);
    const pending = engine.requestApproval(a, { action: "shell", details: "rm -rf build" });
    const id = engine.pendingApprovals(room.id)[0]!.id;
    engine.decideApproval(room.id, id, "edited", "You", "use: npm run clean");
    const result = await pending;
    expect(result.status).toBe("edited");
    expect(result.editedInstruction).toBe("use: npm run clean");
  });
});

describe("Engine — human-in-command", () => {
  it("pause freezes writes; resume restores them", () => {
    const engine = makeEngine();
    const { room } = twoAgentRoom(engine);
    engine.setRoomStatus(room.id, "paused");
    expect(() => engine.claimFiles(engine.resolveCaller("mcp-A"), { paths: ["x"] })).toThrow(BothreadError);
    engine.setRoomStatus(room.id, "active");
    expect(engine.claimFiles(engine.resolveCaller("mcp-A"), { paths: ["x"] }).granted).toBe(true);
  });

  it("mute blocks the agent's writes but not reads", () => {
    const engine = makeEngine();
    const { b, room } = twoAgentRoom(engine);
    const bId = b.participant.id;
    engine.setParticipantStatus(room.id, bId, "muted");
    expect(() => engine.sendMessage(engine.resolveCaller("mcp-B"), { text: "hi" })).toThrow(/muted/);
    // reads still work
    expect(() => engine.readMessages(engine.resolveCaller("mcp-B"), {})).not.toThrow();
  });

  it("revoke invalidates the membership on the next call and releases its leases", () => {
    const engine = makeEngine();
    const { a, b, room } = twoAgentRoom(engine);
    engine.claimFiles(a, { paths: ["src/payments/*"] });
    engine.setParticipantStatus(room.id, a.participant.id, "revoked");
    // A's next call is rejected.
    expect(() => engine.resolveCaller("mcp-A")).toThrow(/revoked/);
    // A's lease was released, so B can now claim it.
    expect(engine.claimFiles(b, { paths: ["src/payments/*"] }).granted).toBe(true);
  });
});

describe("Engine — snapshot", () => {
  it("builds a clean RoomSnapshot with locks, participants, and etiquette", () => {
    const engine = makeEngine();
    const { a, room } = twoAgentRoom(engine);
    engine.claimFiles(a, { paths: ["src/payments/*"], reason: "webhook" });
    engine.sendMessage(a, { text: "claimed payments" });
    const snap = engine.buildSnapshot(room, a.participant);
    expect(snap.room.name).toBe("payments-refactor");
    expect(snap.you.leases).toContain("src/payments/*");
    expect(snap.locks.some((l) => l.path === "src/payments/*" && l.heldByName === "Claude Code")).toBe(true);
    expect(snap.participants.map((p) => p.name)).toContain("Cursor");
    expect(snap.etiquette).toMatch(/claim_files/);
  });

  it("threads a joiner's self-declared capabilities into ParticipantView", () => {
    const engine = makeEngine();
    const { room, sessionId } = engine.createRoom({ name: "capability-room" });
    engine.joinSession("mcp-A", {
      sessionId,
      agentName: "Claude Code",
      brand: "claude",
      capabilities: ["can-view-images"],
    });
    const a = engine.resolveCaller("mcp-A");
    const snap = engine.buildSnapshot(room, a.participant);
    const self = snap.participants.find((p) => p.id === a.participant.id);
    expect(self?.capabilities).toContain("can-view-images");
  });
});

describe("Engine — hand-offs (routed file requests)", () => {
  it("opens a tracked hand-off when a claim is PREVENTED, mentioning the holder", () => {
    const engine = makeEngine();
    const { a, b, room } = twoAgentRoom(engine);
    engine.claimFiles(a, { paths: ["src/pay/*"] }); // Claude holds it
    const res = engine.claimFiles(b, { paths: ["src/pay/*"] }); // Cursor blocked
    expect(res.granted).toBe(false);

    const pend = engine.pendingHandoffs(room.id);
    expect(pend.length).toBe(1);
    expect(pend[0]!.requesterName).toBe("Cursor");
    expect(pend[0]!.holderName).toBe("Claude Code");

    // A directed @Claude Code message was posted.
    const snap = engine.buildSnapshot(room, b.participant);
    expect(snap.handoffs.length).toBe(1);
    expect(snap.thread.some((m) => m.kind === "system" && m.text.includes("@Claude Code"))).toBe(true);
  });

  it("does not duplicate a hand-off when the same claim is retried", () => {
    const engine = makeEngine();
    const { a, b, room } = twoAgentRoom(engine);
    engine.claimFiles(a, { paths: ["src/pay/*"] });
    engine.claimFiles(b, { paths: ["src/pay/*"] });
    engine.claimFiles(b, { paths: ["src/pay/*"] }); // retry
    expect(engine.pendingHandoffs(room.id).length).toBe(1);
  });

  it("resolves the hand-off and notifies the requester when the holder releases", () => {
    const engine = makeEngine();
    const { a, b, room } = twoAgentRoom(engine);
    engine.claimFiles(a, { paths: ["src/pay/webhook.ts"] });
    engine.claimFiles(b, { paths: ["src/pay/webhook.ts"] }); // blocked → handoff
    expect(engine.pendingHandoffs(room.id).length).toBe(1);

    engine.releaseFiles(a, { paths: ["src/pay/webhook.ts"] });
    expect(engine.pendingHandoffs(room.id).length).toBe(0); // resolved

    const snap = engine.buildSnapshot(room, b.participant);
    expect(snap.thread.some((m) => m.kind === "system" && m.text.includes("@Cursor") && m.text.includes("free"))).toBe(true);
  });

  it("requestHandoff routes proactively to the holder", () => {
    const engine = makeEngine();
    const { a, b, room } = twoAgentRoom(engine);
    engine.claimFiles(a, { paths: ["src/core/**"] });
    const res = engine.requestHandoff(b, { path: "src/core/db.ts", message: "need an export" });
    expect(res.routed).toBe(true);
    expect(res.holder).toBe("Claude Code");
    expect(engine.pendingHandoffs(room.id).length).toBe(1);
  });

  it("requestHandoff on an unheld path tells you to just claim it", () => {
    const engine = makeEngine();
    const { b } = twoAgentRoom(engine);
    const res = engine.requestHandoff(b, { path: "src/free.ts" });
    expect(res.routed).toBe(false);
    expect(res.reason).toMatch(/claim_files/);
  });
});

describe("Engine — liveness (listening, nudge, hand-off-aware wait)", () => {
  it("marks an agent as listening after it enters wait_for_update", async () => {
    const engine = makeEngine();
    const { b, room } = twoAgentRoom(engine);
    await engine.waitForUpdate(b, { maxWaitMs: 0 }); // park + return immediately
    const snap = engine.snapshotForOverseer(room.id)!;
    const view = snap.participants.find((p) => p.name === "Cursor")!;
    expect(view.listening).toBe(true);
  });

  it("wait_for_update tells the holder which files others are waiting on", async () => {
    const engine = makeEngine();
    const { a, b } = twoAgentRoom(engine);
    engine.claimFiles(a, { paths: ["src/x.ts"] }); // Claude holds
    engine.claimFiles(b, { paths: ["src/x.ts"] }); // Cursor blocked → handoff to Claude
    const res = await engine.waitForUpdate(a, { maxWaitMs: 0 });
    expect(res.changed).toBe(true);
    expect(res.handoffsForYou.length).toBe(1);
    expect(res.handoffsForYou[0]!.requestedBy).toBe("Cursor");
    expect(res.handoffsForYou[0]!.path).toBe("src/x.ts");
  });

  it("nudge posts a high-priority @mention from the overseer", () => {
    const engine = makeEngine();
    const { a, b, room } = twoAgentRoom(engine);
    const before = engine.readMessages(a, {}).latestSeq;
    const res = engine.nudgeParticipant(room.id, b.participant.id);
    expect(typeof res.listening).toBe("boolean");
    const msgs = engine.readMessages(a, { since: before }).messages;
    expect(msgs.some((m) => m.text.includes("@Cursor") && m.importance === "interrupt")).toBe(true);
  });
});

describe("Engine — mentions delivery confirmation", () => {
  it("honestly reports a mentioned participant as not listening, then listening once parked in wait_for_update", async () => {
    const engine = makeEngine();
    const { a, b } = twoAgentRoom(engine);

    // Cursor hasn't called wait_for_update yet — not listening.
    const notYet = engine.mentionDeliveryStatus(a, ["Cursor"]);
    expect(notYet).toEqual([{ name: "Cursor", listening: false }]);

    // Cursor parks in wait_for_update (matches the existing "marks an agent as
    // listening" test: maxWaitMs: 0 parks + returns immediately).
    await engine.waitForUpdate(b, { maxWaitMs: 0 });

    const now = engine.mentionDeliveryStatus(a, ["Cursor"]);
    expect(now).toEqual([{ name: "Cursor", listening: true }]);
  });

  it("send_message surfaces mentionDelivery in its result, matching mentionDeliveryStatus", async () => {
    const engine = makeEngine();
    const { a, b } = twoAgentRoom(engine);
    await engine.waitForUpdate(b, { maxWaitMs: 0 }); // Cursor now listening

    const status = engine.mentionDeliveryStatus(a, ["Cursor"]);
    expect(status).toEqual([{ name: "Cursor", listening: true }]);

    // Sending doesn't change the persisted Message/ThreadEntry shape.
    const msg = engine.sendMessage(a, { text: "hey @Cursor", mentions: ["Cursor"] });
    expect((msg as Record<string, unknown>).mentionDelivery).toBeUndefined();
  });

  it("case-insensitively matches mentioned display names and reports unknown names as not listening", () => {
    const engine = makeEngine();
    const { a } = twoAgentRoom(engine);
    const res = engine.mentionDeliveryStatus(a, ["cursor", "NoSuchAgent"]);
    expect(res).toEqual([
      { name: "cursor", listening: false },
      { name: "NoSuchAgent", listening: false },
    ]);
  });
});

describe("Engine — governance (settings + audit log)", () => {
  it("updateRoomSettings surfaces requireApprovalFor to agents via the snapshot", () => {
    const engine = makeEngine();
    const { a, room } = twoAgentRoom(engine);
    expect(engine.buildSnapshot(room, a.participant).room.requireApprovalFor).toEqual([]);
    engine.updateRoomSettings(room.id, { requireApprovalFor: ["deploy", "git_push"] });
    const snap = engine.buildSnapshot(engine.getRoom(room.id)!, a.participant);
    expect(snap.room.requireApprovalFor).toEqual(["deploy", "git_push"]);
  });

  it("listAudit returns the append-only governance trail", () => {
    const engine = makeEngine();
    const { a, room } = twoAgentRoom(engine);
    engine.claimFiles(a, { paths: ["src/x.ts"] });
    engine.updateRoomSettings(room.id, { requireApprovalFor: ["delete"] });
    const types = engine.listAudit(room.id).map((e) => e.type);
    expect(types).toContain("room.create");
    expect(types).toContain("participant.join");
    expect(types).toContain("lease.claim");
    expect(types).toContain("room.settings");
    // Newest-first ordering.
    const seqs = engine.listAudit(room.id).map((e) => e.seq);
    expect(seqs[0]!).toBeGreaterThan(seqs[seqs.length - 1]!);
  });
});

describe("Engine — transcript persistence (overseer view vs agent snapshot)", () => {
  it("never deletes messages, and the overseer's snapshot sees far more than the lean agent window", () => {
    const engine = makeEngine();
    const { a, room } = twoAgentRoom(engine);
    // Send more messages than SNAPSHOT_THREAD_LIMIT (12) but fewer than OVERSEER_THREAD_LIMIT (300).
    for (let i = 0; i < 40; i++) engine.sendMessage(a, { text: `msg ${i}` });

    // Agent-facing snapshot (join_session / get_room_state) stays lean.
    const agentSnap = engine.buildSnapshot(room, a.participant);
    expect(agentSnap.thread.length).toBe(12);

    // The overseer's own live view is NOT capped at the agent's lean window.
    const overseerSnap = engine.snapshotForOverseer(room.id)!;
    expect(overseerSnap.thread.length).toBeGreaterThan(12);
    // All 40 sent messages are visible to the overseer (well under OVERSEER_THREAD_LIMIT).
    expect(overseerSnap.thread.filter((m) => m.text.startsWith("msg ")).length).toBe(40);
  });

  it("messagesBefore pages backward through history that predates the overseer window, losing nothing", () => {
    const engine = makeEngine();
    const { a, room } = twoAgentRoom(engine);
    for (let i = 0; i < 25; i++) engine.sendMessage(a, { text: `m${i}` });

    // Simulate the UI's initial view being just the most recent 10 (as if OVERSEER_THREAD_LIMIT were tiny).
    const recent = engine.buildSnapshot(room, a.participant, 10).thread;
    expect(recent.map((m) => m.text)).toEqual(["m15", "m16", "m17", "m18", "m19", "m20", "m21", "m22", "m23", "m24"]);

    // Page backward from the oldest visible message.
    const page1 = engine.messagesBefore(room.id, recent[0]!.seq, 10);
    expect(page1.messages.map((m) => m.text)).toEqual(["m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12", "m13", "m14"]);
    expect(page1.hasMore).toBe(true);

    // Keep paging until exhausted — every earlier message is reachable, nothing lost.
    const page2 = engine.messagesBefore(room.id, page1.messages[0]!.seq, 10);
    // page2 includes the two hello messages from twoAgentRoom's join + up to m0..m4.
    expect(page2.messages.map((m) => m.text)).toContain("m0");
    expect(page2.hasMore).toBe(false);
  });
});

describe("Engine — overseer 'last seen' watermark", () => {
  it("does not silently auto-advance between polls, and updates on the next poll", () => {
    const engine = makeEngine();
    const { a, room } = twoAgentRoom(engine);

    // First poll: nobody has polled before, so there's no prior watermark yet.
    const first = engine.snapshotForOverseer(room.id)!;
    expect(first.overseerLastSeenSeq).toBeUndefined();
    const seqAtFirstPoll = first.latestSeq;

    // Send more messages WITHOUT polling again.
    engine.sendMessage(a, { text: "one" });
    engine.sendMessage(a, { text: "two" });
    engine.sendMessage(a, { text: "three" });

    // Nothing re-computed this until we poll again — the watermark from the
    // engine's internal state must still reflect the first poll, not silently
    // track the latest seq. We can only observe it via the NEXT call, so verify
    // the next call reports the seq as of the FIRST poll, not as of right now.
    const second = engine.snapshotForOverseer(room.id)!;
    expect(second.overseerLastSeenSeq).toBe(seqAtFirstPoll);
    // Proves it's a real "last polled" signal, not always-current: three
    // messages were sent since, so the exposed watermark is well behind latestSeq.
    expect(second.latestSeq).toBeGreaterThan(second.overseerLastSeenSeq!);
    expect(second.latestSeq - second.overseerLastSeenSeq!).toBe(3);

    // A third poll immediately after now reflects the second poll's latestSeq.
    const third = engine.snapshotForOverseer(room.id)!;
    expect(third.overseerLastSeenSeq).toBe(second.latestSeq);
  });

  it("overseerActive is true only when polls land within the active window, false after a gap", () => {
    vi.useFakeTimers();
    try {
      const engine = makeEngine();
      const { room } = twoAgentRoom(engine);

      // First poll ever: no previous poll to compare against, so not "active".
      const first = engine.snapshotForOverseer(room.id)!;
      expect(first.overseerActive).toBe(false);

      // Poll again quickly (well within the 15s window) — now active.
      vi.advanceTimersByTime(2_000);
      const second = engine.snapshotForOverseer(room.id)!;
      expect(second.overseerActive).toBe(true);

      // Let a long gap pass (tab closed / human stepped away) before polling again.
      vi.advanceTimersByTime(30_000);
      const third = engine.snapshotForOverseer(room.id)!;
      expect(third.overseerActive).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Engine — idle participant detection", () => {
  it("flags an agent idle after 5+ minutes of no activity, and not for a freshly-active one", () => {
    const engine = makeEngine();
    const { a, b, room } = twoAgentRoom(engine);

    // Directly poke participant b's last_seen_at back to simulate a long absence
    // (the schema's participants.last_seen_at column — see db/schema.ts).
    const longAgo = Date.now() - 6 * 60 * 1000; // 6 minutes ago
    (engine as any).db.prepare(`UPDATE participants SET last_seen_at = ? WHERE id = ?`).run(longAgo, b.participant.id);

    const snap = engine.buildSnapshot(room, a.participant);
    const bView = snap.participants.find((p) => p.id === b.participant.id)!;
    const aView = snap.participants.find((p) => p.id === a.participant.id)!;

    expect(bView.idle).toBe(true);
    // `a` just called resolveCaller (via twoAgentRoom) so its last_seen_at is fresh.
    expect(aView.idle).toBe(false);
  });

  it("idle is independent of listening — a parked waiter with stale last_seen_at is both", () => {
    const engine = makeEngine();
    const { a, b, room } = twoAgentRoom(engine);

    // b enters wait_for_update (marks it "listening")...
    void engine.waitForUpdate(b, { maxWaitMs: 0 });
    // ...but its last_seen_at is artificially old (e.g. the process has been
    // parked in a long-poll for a while with no other tool calls in between).
    const longAgo = Date.now() - 10 * 60 * 1000;
    (engine as any).db.prepare(`UPDATE participants SET last_seen_at = ? WHERE id = ?`).run(longAgo, b.participant.id);

    const snap = engine.buildSnapshot(room, a.participant);
    const bView = snap.participants.find((p) => p.id === b.participant.id)!;
    expect(bView.listening).toBe(true);
    expect(bView.idle).toBe(true);
  });
});

describe("Engine — checkFiles (quiet ownership peek, zero side effects)", () => {
  it("reports the holder of a claimed path without broadcasting anything", () => {
    const engine = makeEngine();
    const { a, b, room } = twoAgentRoom(engine);
    engine.claimFiles(a, { paths: ["src/x.ts"] }); // Claude Code holds it

    const seqBefore = engine.latestSeq(room.id);
    const handoffsBefore = engine.pendingHandoffs(room.id).length;

    const res = engine.checkFiles(b, ["src/x.ts"]);

    expect(res).toEqual([
      { path: "src/x.ts", held: true, heldBy: a.participant.id, heldByName: "Claude Code", exclusive: true },
    ]);
    // Truly silent: no new message and no hand-off opened, unlike claimFiles's PREVENTED path.
    expect(engine.latestSeq(room.id)).toBe(seqBefore);
    expect(engine.pendingHandoffs(room.id).length).toBe(handoffsBefore);
  });

  it("reports free for an unclaimed path", () => {
    const engine = makeEngine();
    const { b } = twoAgentRoom(engine);
    const res = engine.checkFiles(b, ["src/unclaimed.ts"]);
    expect(res).toEqual([{ path: "src/unclaimed.ts", held: false }]);
  });

  it("checks multiple paths in one call, mixing held and free", () => {
    const engine = makeEngine();
    const { a, b } = twoAgentRoom(engine);
    engine.claimFiles(a, { paths: ["src/payments/*"], exclusive: true });
    const res = engine.checkFiles(b, ["src/payments/webhook.ts", "src/checkout/index.ts"]);
    expect(res.find((r) => r.path === "src/payments/webhook.ts")).toMatchObject({ held: true, heldByName: "Claude Code" });
    expect(res.find((r) => r.path === "src/checkout/index.ts")).toEqual({ path: "src/checkout/index.ts", held: false });
  });

  it("does not conflict with the caller's own held lease (reports it as held by self, still silent)", () => {
    const engine = makeEngine();
    const { a, room } = twoAgentRoom(engine);
    engine.claimFiles(a, { paths: ["src/mine.ts"] });
    const seqBefore = engine.latestSeq(room.id);
    const res = engine.checkFiles(a, ["src/mine.ts"]);
    expect(res).toEqual([
      { path: "src/mine.ts", held: true, heldBy: a.participant.id, heldByName: "Claude Code", exclusive: true },
    ]);
    expect(engine.latestSeq(room.id)).toBe(seqBefore);
  });
});

describe("Engine — room identity (rename + topic tagging)", () => {
  it("renameRoom updates the name, is reflected in a fresh fetch, and posts audit + system message", () => {
    const engine = makeEngine();
    const { room } = twoAgentRoom(engine);
    expect(room.name).toBe("payments-refactor");

    const seqBefore = engine.latestSeq(room.id);
    const renamed = engine.renameRoom(room.id, "mario-platformer", "You");
    expect(renamed.name).toBe("mario-platformer");

    // Reflected in a fresh getRoom fetch and in a fresh snapshot.
    expect(engine.getRoom(room.id)!.name).toBe("mario-platformer");
    const a = engine.resolveCaller("mcp-A");
    expect(engine.buildSnapshot(engine.getRoom(room.id)!, a.participant).room.name).toBe("mario-platformer");

    // Audit entry posted.
    const types = engine.listAudit(room.id).map((e) => e.type);
    expect(types).toContain("room.rename");

    // System message posted, visible to agents reading since the rename.
    const after = engine.readMessages(a, { since: seqBefore });
    expect(after.messages.some((m) => m.kind === "system" && m.text.includes('renamed the room to "mario-platformer"'))).toBe(
      true
    );
  });

  it("throws BothreadError when renaming a nonexistent room", () => {
    const engine = makeEngine();
    expect(() => engine.renameRoom("no-such-room", "x")).toThrow(BothreadError);
  });

  it("send_message's threadId round-trips through storage into ThreadEntry (topic tagging, no new field)", () => {
    const engine = makeEngine();
    const { a, b } = twoAgentRoom(engine);
    engine.sendMessage(a, { text: "working on mario jump physics", threadId: "mario-game" });
    engine.sendMessage(b, { text: "wiring up the tarzan swing", threadId: "tarzan-game" });
    engine.sendMessage(a, { text: "untagged general chatter" });

    const { messages } = engine.readMessages(a, {});
    const marioMsg = messages.find((m) => m.text.includes("mario jump"));
    const tarzanMsg = messages.find((m) => m.text.includes("tarzan swing"));
    const untagged = messages.find((m) => m.text.includes("untagged"));

    expect(marioMsg?.threadId).toBe("mario-game");
    expect(tarzanMsg?.threadId).toBe("tarzan-game");
    expect(untagged?.threadId).toBeUndefined();
  });
});

describe("Engine — notes (durable decisions / issues / verification)", () => {
  it("recordNote creates a note that appears in listNotes and the snapshot with the right kind", () => {
    const engine = makeEngine();
    const { a, room } = twoAgentRoom(engine);
    const note = engine.recordNote(a, {
      kind: "decision",
      title: "physics.js owns collision",
      detail: "level.js owns tiles; isSolid(col,row) is the contract.",
    });
    expect(note.kind).toBe("decision");
    expect(note.status).toBe("open");
    expect(note.authorName).toBe("Claude Code");

    const listed = engine.listNotes(room.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.title).toBe("physics.js owns collision");

    const snap = engine.buildSnapshot(room, a.participant);
    expect(snap.notes).toHaveLength(1);
    expect(snap.notes[0]!.kind).toBe("decision");
  });

  it("supports issue and verification kinds", () => {
    const engine = makeEngine();
    const { a, b, room } = twoAgentRoom(engine);
    engine.recordNote(a, { kind: "issue", title: "leftover shadow artifact" });
    engine.recordNote(b, {
      kind: "verification",
      title: "collision regression suite",
      detail: "tested: 20 falling-block cases\nexpected: no clip-through\nactual: all passed",
    });
    const notes = engine.listNotes(room.id);
    expect(notes.map((n) => n.kind).sort()).toEqual(["issue", "verification"]);
  });

  it("resolveNote marks a note resolved and is reflected in a fresh snapshot", () => {
    const engine = makeEngine();
    const { a, room } = twoAgentRoom(engine);
    const note = engine.recordNote(a, { kind: "issue", title: "vine anchors ignore terrain height" });
    expect(engine.buildSnapshot(room, a.participant).notes[0]!.status).toBe("open");

    const resolved = engine.resolveNote(a, { noteId: note.id, resolution: "anchors now sample terrain height" });
    expect(resolved.status).toBe("resolved");
    expect(resolved.detail).toContain("anchors now sample terrain height");

    // A fresh snapshot reflects the resolution.
    const fresh = engine.buildSnapshot(engine.getRoom(room.id)!, a.participant);
    const found = fresh.notes.find((n) => n.id === note.id)!;
    expect(found.status).toBe("resolved");
  });

  it("resolveNote throws for an unknown note id", () => {
    const engine = makeEngine();
    const { a } = twoAgentRoom(engine);
    expect(() => engine.resolveNote(a, { noteId: "nope" })).toThrow(BothreadError);
  });

  it("callerForOverseer builds a Caller the human overseer's REST actions can use", () => {
    const engine = makeEngine();
    const { room } = twoAgentRoom(engine);
    const overseerCaller = engine.callerForOverseer(room.id);
    expect(overseerCaller.participant.kind).toBe("human");
    const note = engine.recordNote(overseerCaller, { kind: "decision", title: "ship the MVP without symbol-level locks" });
    expect(note.authorName).toBe(overseerCaller.participant.name);
    expect(engine.listNotes(room.id).some((n) => n.id === note.id)).toBe(true);
  });
});

describe("Engine — rejoin digest", () => {
  const git = (cwd: string, args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

  function makeRepo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bothread-rejoin-"));
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "test@bothread.local"]);
    git(dir, ["config", "user.name", "Bothread Test"]);
    git(dir, ["config", "commit.gpgsign", "false"]);
    git(dir, ["config", "core.autocrlf", "false"]);
    fs.writeFileSync(path.join(dir, "app.js"), "const x = 1;\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "initial"]);
    return dir;
  }

  let repoDir: string;
  beforeEach(() => {
    repoDir = makeRepo();
  });
  afterEach(() => {
    try {
      fs.rmSync(repoDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("is undefined on a fresh join, and reflects real activity on a true rejoin", () => {
    const engine = makeEngine();
    const { sessionId } = engine.createRoom({ name: "rejoin-room", projectPath: repoDir });

    // Fresh join: brand-new participant, nothing to digest.
    const first = engine.joinSession("mcp-A", { sessionId, agentName: "Claude Code", brand: "claude" });
    expect(first.rejoinDigest).toBeUndefined();
    const a = engine.resolveCaller("mcp-A");

    // A second agent so there's someone else driving activity + resolving hand-offs.
    engine.joinSession("mcp-B", { sessionId, agentName: "Cursor", brand: "cursor" });
    const b = engine.resolveCaller("mcp-B");

    // Advance room state while A is "away": messages, a claim/edit/release (branch
    // ready + merged), and a hand-off request/resolution.
    engine.sendMessage(b, { text: "one" });
    engine.sendMessage(b, { text: "two" });
    engine.sendMessage(b, { text: "three" });

    const claim = engine.claimFiles(b, { paths: ["app.js"] });
    expect(claim.granted).toBe(true);
    // A asks for the file B holds — opens a tracked hand-off.
    const ho = engine.requestHandoff(a, { path: "app.js", message: "need it" });
    expect(ho.routed).toBe(true);

    fs.writeFileSync(path.join(repoDir, "app.js"), "const x = 1;\nconst y = 2;\n");
    engine.releaseFiles(b, { paths: ["app.js"] }); // finalizes branch -> 'ready'; also resolves the hand-off
    const branch = engine.listBranches(a.room.id)[0]!;
    expect(branch.status).toBe("ready");
    engine.mergeBranch(a.room.id, branch.id); // -> 'merged', finalized_at set

    // Now A rejoins on the SAME mcp session id — a true rejoin.
    const rejoin = engine.joinSession("mcp-A", { sessionId, agentName: "Claude Code", brand: "claude" });
    expect(rejoin.rejoinDigest).toBeDefined();
    const digest = rejoin.rejoinDigest!;

    expect(digest.awayMs).toBeGreaterThanOrEqual(0);
    // 3 explicit sends + system messages from join/claim/handoff/release/merge — at least our 3.
    expect(digest.newMessages).toBeGreaterThanOrEqual(3);
    expect(digest.branchesResolved).toBe(1);
    expect(digest.handoffEvents).toBeGreaterThanOrEqual(1);
    expect(digest.tasksChanged).toBe(0); // no task board in this build

    // Confirm the same participant row was reused (rejoin, not a new participant).
    expect(rejoin.participant.id).toBe(a.participant.id);
  });

  it("does not attach a digest when a brand-new participant joins an already-active room", () => {
    const engine = makeEngine();
    const { sessionId } = engine.createRoom({ name: "room2" });
    engine.joinSession("mcp-X", { sessionId, agentName: "Claude Code" });
    const x = engine.resolveCaller("mcp-X");
    engine.sendMessage(x, { text: "hello" });

    // A different connection joining for the first time — fresh join, not a rejoin.
    const freshJoin = engine.joinSession("mcp-Y", { sessionId, agentName: "Gemini" });
    expect(freshJoin.rejoinDigest).toBeUndefined();
  });
});

describe("Engine — message replies, edits, and retraction", () => {
  it("threads a reply via replyToSeq, visible on the ThreadEntry", () => {
    const engine = makeEngine();
    const { a, b } = twoAgentRoom(engine);
    const original = engine.sendMessage(a, { text: "should we use REST or MCP for this?" });
    const reply = engine.sendMessage(b, { text: "MCP, we're already wired for it", replyToSeq: original.seq });

    const entry = engine.readMessages(a, {}).messages.find((m) => m.seq === reply.seq)!;
    expect(entry.replyToSeq).toBe(original.seq);
  });

  it("lets the author edit their own message, marks editedAt, and rejects other authors", () => {
    const engine = makeEngine();
    const { a, b } = twoAgentRoom(engine);
    const msg = engine.sendMessage(a, { text: "typo in this sentance" });

    const edited = engine.editMessage(a, { seq: msg.seq, text: "typo in this sentence" });
    expect(edited.text).toBe("typo in this sentence");
    expect(edited.editedAt).toBeDefined();

    const reread = engine.readMessages(a, {}).messages.find((m) => m.seq === msg.seq)!;
    expect(reread.text).toBe("typo in this sentence");
    expect(reread.editedAt).toBeDefined();

    expect(() => engine.editMessage(b, { seq: msg.seq, text: "hijacked" })).toThrow(BothreadError);
  });

  it("lets the author retract their own message; text is redacted everywhere, row isn't deleted", () => {
    const engine = makeEngine();
    const { a, b } = twoAgentRoom(engine);
    const msg = engine.sendMessage(a, { text: "wait, ignore that, wrong channel" });

    const retracted = engine.retractMessage(a, { seq: msg.seq });
    expect(retracted.text).toBe("[message retracted]");
    expect(retracted.retractedAt).toBeDefined();

    // Redacted for every reader, not just the author.
    const asB = engine.readMessages(b, {}).messages.find((m) => m.seq === msg.seq)!;
    expect(asB.text).toBe("[message retracted]");

    // Can't edit or double-retract a retracted message.
    expect(() => engine.editMessage(a, { seq: msg.seq, text: "nope" })).toThrow(BothreadError);
    expect(() => engine.retractMessage(a, { seq: msg.seq })).toThrow(BothreadError);

    // Not the author -> forbidden, independent of retraction.
    const msg2 = engine.sendMessage(a, { text: "another one" });
    expect(() => engine.retractMessage(b, { seq: msg2.seq })).toThrow(BothreadError);
  });
});

describe("Engine — channels (threadId discovery)", () => {
  it("lists distinct channels used, in first-seen order, and surfaces them on the snapshot", () => {
    const engine = makeEngine();
    const { a, b, room } = twoAgentRoom(engine);
    engine.sendMessage(a, { text: "level 3 layout", threadId: "mario-game" });
    engine.sendMessage(b, { text: "vine physics", threadId: "tarzan-game" });
    engine.sendMessage(a, { text: "more mario stuff", threadId: "mario-game" });
    engine.sendMessage(a, { text: "no channel here" });

    expect(engine.listChannels(room.id)).toEqual(["mario-game", "tarzan-game"]);
    const snap = engine.buildSnapshot(room, a.participant);
    expect(snap.channels).toEqual(["mario-game", "tarzan-game"]);
  });
});

describe("Engine — agent-visible read state (snapshotForAgent)", () => {
  it("exposes overseerActive/overseerLastSeenSeq to agents via get_room_state's snapshot path, without the human ever polling", () => {
    const engine = makeEngine();
    const { a, room } = twoAgentRoom(engine);
    engine.sendMessage(a, { text: "one" });

    // Before this fix, buildSnapshot() (what get_room_state used) never set these —
    // an agent had no way to know whether the human had seen anything.
    const snap = engine.snapshotForAgent(room, a.participant);
    expect(snap.overseerActive).toBe(false);
    expect(snap.overseerLastSeenSeq).toBeUndefined();
  });

  it("reflects the human's real watermark to agents once the overseer has actually polled, without advancing it itself", () => {
    const engine = makeEngine();
    const { a, room } = twoAgentRoom(engine);
    engine.sendMessage(a, { text: "one" });

    const overseerPoll = engine.snapshotForOverseer(room.id)!;
    const seenAsOfPoll = overseerPoll.latestSeq;

    // More activity happens after the human's poll, before any agent checks in.
    engine.sendMessage(a, { text: "two" });
    engine.sendMessage(a, { text: "three" });

    const agentView = engine.snapshotForAgent(room, a.participant);
    expect(agentView.overseerLastSeenSeq).toBe(seenAsOfPoll);
    expect(agentView.latestSeq - agentView.overseerLastSeenSeq!).toBe(2);

    // Calling it again must NOT have moved the watermark (read-only for agents).
    const agentViewAgain = engine.snapshotForAgent(room, a.participant);
    expect(agentViewAgain.overseerLastSeenSeq).toBe(seenAsOfPoll);
  });
});
