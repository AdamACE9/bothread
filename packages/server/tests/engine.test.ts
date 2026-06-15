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
});
