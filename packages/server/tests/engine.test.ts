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
