// TEMPORARY visual harness for RoomMap/Timeline. Not imported by the app. Delete before shipping.
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "../../index.css";
import type { AgentBranch, AuditEvent, ServerEvent } from "@bothread/shared";
import type { RoomDetail } from "../../api";
import { RoomMap, Timeline } from "./index";

interface Frame {
  at: number;
  detail: RoomDetail;
  audit: AuditEvent[];
  branches: AgentBranch[];
}
interface Rec {
  roomId: string;
  frames: Frame[];
  events: ServerEvent[];
}

const q = new URLSearchParams(location.search);
const mode = q.get("mode") ?? "map";
const theme = (q.get("theme") ?? "dark") as "dark" | "light";
const T = Number(q.get("t") ?? "40");
const play = q.get("play") === "1";
const empty = q.get("empty") === "1";
document.documentElement.dataset.theme = theme;

function shift(rec: Rec, offset: number): Rec {
  const lo = rec.frames[0]!.at - 86_400_000;
  const hi = rec.frames[rec.frames.length - 1]!.at + 86_400_000;
  const walk = (v: unknown): unknown => {
    if (typeof v === "number") return v > lo && v < hi ? v + offset : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  return walk(rec) as Rec;
}

function stress(base: RoomDetail["snapshot"]) {
  const brands = ["claude", "cursor", "codex", "gemini", "opencode", "antigravity", "claude", "cursor", "gemini", "codex"];
  const names = ["Claude Code", "Cursor", "Codex", "Gemini CLI", "OpenCode", "Antigravity", "Claude Reviewer", "Cursor Tests", "Gemini Docs", "Codex Infra"];
  const models = ["Claude Opus 5.5", "Claude Sonnet 5", "GPT-5 Codex", "Gemini 3 Pro", "Kimi K3", "Gemini 3 Flash", "Claude Opus 5.5", "Claude Sonnet 5", "Gemini 3 Pro", "GPT-5 Codex"];
  const now = Date.now();
  const human = base.participants.find((p) => p.kind === "human")!;
  const parts = names.map((name, i) => ({
    id: "p" + i, name, brand: brands[i], kind: "agent" as const, status: (i === 9 ? "left" : "active") as "left" | "active",
    claimedFiles: [], lastSeen: now, listening: i % 3 === 0, idle: i === 4 || i === 7, model: models[i], client: i % 2 ? "Cursor 3.2" : "Claude Code 2.1",
  }));
  const files = ["src/api/routes.ts", "src/api/auth.ts", "src/db/schema.ts", "src/db/migrate.ts", "src/ui/App.tsx", "src/ui/Button.tsx", "src/ui/theme.css", "tests/e2e/login.spec.ts", "docs/README.md", "src/payments/**", "src/physics.ts", "src/levels/**", "package.json", "src/boss.ts", "src/net/socket.ts"];
  const locks: RoomDetail["snapshot"]["locks"] = [];
  const leases: RoomDetail["leases"] = [];
  let k = 0;
  parts.forEach((p, i) => {
    if (i === 9) return;
    const n = [9, 6, 5, 7, 3, 6, 4, 2, 5][i]!;
    for (let j = 0; j < n; j++) {
      const path = j < 2 ? files[(i * 2 + j) % files.length]! : `pkg${i}/mod${j}/file${k}.ts`;
      k++;
      const exclusive = (i + j) % 4 !== 0;
      const ttl = 15 * 60_000;
      const created = now - ((i * 7 + j * 13) % 14) * 60_000;
      locks.push({ path, heldBy: p.id, heldByName: p.name, exclusive, expiresAt: created + ttl, heldByLastSeen: now, heldByListening: false });
      leases.push({ id: "l" + k, roomId: "r", participantId: p.id, participantName: p.name, pathPattern: path, exclusive, reason: "refactoring " + path, status: "active", createdAt: created, expiresAt: created + ttl });
    }
  });
  const snapshot = {
    ...base,
    participants: [human, ...parts],
    locks,
    handoffs: [{ id: "h1", path: "src/db/schema.ts", requestedBy: "Gemini CLI", heldBy: "Codex", message: "need the users table" }],
    pendingApprovals: [{ id: "a1", action: "deploy" as const, details: "ship it", requestedBy: "OpenCode" }],
  };
  const branches = [
    { id: "b1", roomId: "r", participantId: "p1", participantName: "Cursor", branchName: "x", baseSha: "x", paths: ["a"], status: "ready" as const, createdAt: now, hunks: [{ id: "h", file: "a", header: "", lines: [], additions: 42, deletions: 7 }] },
    { id: "b2", roomId: "r", participantId: "p3", participantName: "Gemini CLI", branchName: "x", baseSha: "x", paths: ["a"], status: "ready" as const, createdAt: now, hunks: [{ id: "h", file: "a", header: "", lines: [], additions: 12, deletions: 3 }] },
  ];
  return { snapshot, leases, branches };
}

function App() {
  const [rec, setRec] = useState<Rec | null>(null);
  const [t, setT] = useState(T);
  const [extra, setExtra] = useState<ServerEvent[]>([]);
  useEffect(() => {
    fetch("/recording.json")
      .then((r) => r.json())
      .then((raw: Rec) => {
        const start = raw.frames[0]!.at;
        setRec(shift(raw, Date.now() - (start + T * 1000)));
      });
  }, []);
  useEffect(() => {
    if (!play) return;
    const id = setInterval(() => setT((x) => x + 0.25), 250);
    return () => clearInterval(id);
  }, []);
  // Synthetic collision on demand: window.__collide()
  useEffect(() => {
    (window as unknown as { __collide: (path: string, by: string, holder: string) => void }).__collide = (path, by, holder) =>
      setExtra((e) => [...e, { type: "collision", roomId: "x", ts: Date.now(), data: { by, conflicts: [{ path, heldByName: holder, heldBy: "x", exclusive: true }] } }]);
  }, []);
  const view = useMemo(() => {
    if (!rec) return null;
    const start = rec.frames[0]!.at;
    const cut = start + t * 1000;
    let f = rec.frames[0]!;
    for (const fr of rec.frames) if (fr.at <= cut) f = fr;
    const events = [...rec.events.filter((e) => e.ts <= cut), ...extra].slice(-200);
    return { f, events };
  }, [rec, t, extra]);
  if (!view || !rec) return <div style={{ padding: 20 }}>loading…</div>;
  const { f, events } = view;
  let snapshot = f.detail.snapshot;
  let leases = f.detail.leases;
  let branches = f.branches;
  if (q.get("stress") === "1") ({ snapshot, leases, branches } = stress(snapshot));
  if (empty) snapshot = { ...snapshot, participants: snapshot.participants.filter((p) => p.kind === "human"), locks: [], handoffs: [] };
  const props = {
    roomId: rec.roomId,
    snapshot,
    leases: empty ? [] : leases,
    branches: empty ? [] : branches,
    events,
    audit: empty ? [] : f.audit,
    theme,
    onSelectAgent: (n: string) => console.log("select", n),
    onOpenTab: (tab: string) => console.log("tab", tab),
  };
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>{mode === "map" ? <RoomMap {...props} /> : <Timeline {...props} />}</div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
