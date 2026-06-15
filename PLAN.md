# Bothread — Implementation Plan (PLAN.md)

> Status: **Draft for Adam's review.** No code is written yet. This plan synthesizes two-phase research
> (11 parallel agents) into exact tools, architecture, coordination + security design, UI direction, and a
> phased build with per-phase acceptance criteria and test/evidence strategy. Source of truth for *what*:
> `SPEC.md`. This document owns the *how*.

---

## 0. TL;DR (read this if nothing else)

- **What we're building, in order:** (1) a public **website** (bothread.vercel.app) with waitlist + feedback on Firebase `bot-thread`; then — after your approval — (2) the **Bothread app**: a local TypeScript hub that runs an **MCP server** so any MCP-compatible agent can join a **room** via a session ID, talk in a live thread, claim files without colliding, while you **watch and command** (pause / approve / mute / revoke).
- **The moat is the room, not the plumbing.** Research confirms several open projects already do headless coordination (mcp_agent_mail, swarm-protocol, task-graph-mcp, wit, Coral, MACP). **None** combine a beautiful human-in-command room + zero-infra local setup + MCP-native universal join. That gap is precisely Bothread. We build our own engine, informed by theirs.
- **Stack:** TypeScript everywhere. MCP **stable SDK 1.x** over **Streamable HTTP**. `better-sqlite3` (WAL) for state + audit. Express + `ws`. React + Vite + Tailwind v4 (custom OKLCH theme) + Motion + react-three-fiber for both UIs. Firebase v12 + Vercel CLI for the site. Vitest + Playwright for tests/evidence.
- **Thesis-proving milestone, hit early:** two *different-brand* agents reading each other's messages and being *prevented* from editing the same file, with you watching it happen.
- **The one taste decision I need from you:** confirm the **"Loom"** visual direction (§11). Everything else I'll proceed on with the recommendations below.

---

## 1. Research synthesis (what the 11 agents found)

### 1.1 MCP server (TypeScript), transport, sessions, auth
- **Pin the stable `@modelcontextprotocol/sdk` 1.x line.** Explicitly **ignore the `2.0.0-alpha` packages** (`@modelcontextprotocol/server` etc.) — breaking, unreleased. (Exact patch verified on npm at install time.)
- **Transport = Streamable HTTP** (`StreamableHTTPServerTransport`, import `@modelcontextprotocol/sdk/server/streamableHttp.js`). One `/mcp` endpoint serving **POST** (JSON-RPC), **GET** (SSE server→client push), **DELETE** (teardown). Session identity via the **`Mcp-Session-Id`** response/request header; `sessionIdGenerator: () => randomUUID()`, with `onsessioninitialized` / `onsessionclosed` callbacks.
- **One `McpServer` instance per connected agent** (per transport). **Shared room state lives in the app layer** (a `RoomStore`/engine the tools close over) — never share one `McpServer` across transports.
- **Auth:** clients send `Authorization: Bearer <token>` on every request; SDK ships `requireBearerAuth`. For a local multi-agent server a validated credential per request is the right model (full OAuth 2.1 is overkill locally).
- **Server→client push:** agents open a **GET SSE** stream; server emits notifications (resource/tool-list-changed, custom). Known SDK gap: logging notifications can be missed on Streamable HTTP unless the client keeps the GET SSE open — so we also expose explicit `read_messages`/`wait_for_update` pull tools (robust across all clients).
- **Local gotchas baked into the plan:** bind `127.0.0.1` only; CORS must `exposedHeaders: ['Mcp-Session-Id']`; validate `Origin` (DNS-rebinding protection); raise `keepAliveTimeout`; TTL-evict dead sessions; serialize state-mutating tool calls with a mutex / synchronous SQLite transaction; `express.json()` before MCP handlers.

### 1.2 How agents connect (universality — the join surface)
Native **remote Streamable HTTP + custom `Authorization` header** support (no bridge needed): **Claude Code, Cursor, Windsurf, Gemini CLI, Antigravity, Codex CLI**. That covers all of our test agents.

| Agent | Add-server config | Remote HTTP + headers | Rules/skill file |
|---|---|---|---|
| Claude Code | `.mcp.json` / `claude mcp add --transport http … --header` | ✅ | `CLAUDE.md` + `.claude/skills/<n>/SKILL.md` |
| Cursor | `.cursor/mcp.json` (`url`,`headers`) | ✅ | `.cursor/rules/*.mdc` |
| Antigravity / Gemini CLI | `~/.gemini/.../mcp_config.json` (`httpUrl`/`serverUrl`,`headers`) | ✅ | `GEMINI.md` / `AGENTS.md` |
| Codex CLI | `~/.codex/config.toml` (`bearer_token_env_var`,`http_headers`) | ✅ | `AGENTS.md` |
| OpenCode | `opencode.json` (SSE) — native Streamable HTTP broken | ⚠️ via `mcp-remote` | `AGENTS.md` |
| Cline | UI/`cline_mcp_settings.json` | ⚠️ header-forward bug; test | `.clinerules` |
| claude.ai web | connector UI (OAuth only) | ❌ static token (API only) | n/a |

- **Fallback bridge:** `mcp-remote` (pin `>=0.1.16`, CVE) bridges stdio-only/broken clients to our HTTP endpoint with `--header`.
- **`AGENTS.md` is the cross-agent rules standard**; **`SKILL.md` (Agent Skills)** is the cross-agent on-demand-procedure standard. We ship both.

### 1.3 Teaching etiquette + the join ceremony (skill file)
- **Claude Code Skill** = `SKILL.md` (YAML frontmatter `name`/`description`, `disable-model-invocation` to force `/bothread` user-invocation), progressive disclosure, re-read by re-invoking `/bothread`.
- **Design rule honored:** the **session ID is NEVER in the skill file**. Skill teaches *etiquette* + *how to join*; the user pastes the session ID live; the agent calls `join_session`.
- **What reliably changes agent behavior:** imperative numbered steps, exact tool names, explicit NEVER/ALWAYS lists, "call `get_room_state` before acting", "claim before editing", "your text isn't visible to others — use `send_message`".
- **Distribution:** one canonical `SKILL.md` + thin per-agent wrappers (`AGENTS.md`, `.cursor/rules`, `CLAUDE.md` import). Provide a tiny installer later.

### 1.4 Coordination landscape + the gap (positioning)
- The thesis holds, sharpened: headless plumbing exists; UI-forward tools exist (Emdash, Dorothy, CliDeck) but they're **dispatch dashboards**, not coordination rooms; **HiClaw** puts humans in Matrix rooms but needs Kubernetes/Matrix/MinIO — not for solo builders.
- **No product is simultaneously:** real-time room (presence + claimed files + thread) **+** human approval gates **+** collision visualization **+** zero-infra local **+** MCP-native universal join. **That five-way combination is Bothread's defensible space.** (Window isn't permanent — Emdash has 840k downloads — so we move and we make the UX undeniable.)

### 1.5 Per-repo lessons (deep dives) → what we adopt
| Source | Adopt | Avoid / improve |
|---|---|---|
| **mcp_agent_mail** (closest prior art) | Advisory **leases** w/ TTL + `exclusive`/shared + glob; **atomic grant under serialized txn** (`BEGIN IMMEDIATE`); auto-expire-on-touch; **HumanOverseer** privileged identity w/ "pause→comply→resume"; per-recipient read/ack; SQLite+FTS index; default-deny-ish auth | HTTP-only + **polling-only** (we add push); permissive localhost-unauth default; 14k-line monolith (we stay modular) |
| **swarm-protocol** | Clean **intent→claim→complete→auto-unblock** work model; token-efficient `get_context` bundle; modular `tools/*.ts` | Pure-advisory w/ **zero enforcement** + zombie locks + no auth + no real messaging |
| **task-graph-mcp** | SQLite **WAL**; **append-only sequence log + per-consumer cursor**; task→file auto-mark + auto-release; **`read_only_hint` / "requires permission"** annotations; quality gates; loopback dashboard | Polling-only; `force`-steal w/o human gate; ~50 tools (too many); whole-file granularity |
| **wit** | **Symbol-level** locking via Tree-sitter; **declare-intent-before-edit** + caller/callee conflict warnings; TTL + sweeper; contracts as the only hard gate at git boundary; small 12-tool surface | Not MCP-native yet; unverified self-claimed identity; no audit |
| **Coral Protocol** | **Thread API shape** (create/send/wait_for_message|mention|agent/add_participant/close-with-summary); **filter sealed-class** (`Mentions`/`Thread`/`From`) + **pending-promise wait + replayAfter**; per-agent capability **secret** | Destroys messages on thread close; in-memory only; 60s hard wait cap; blockchain/x402 (irrelevant) |
| **MACP** | **Priority tiers** `info/advisory/steering/interrupt`; per-recipient `delivery_id` + ACK lifecycle (`queued/received/processed`, at-least-once + idempotency); separate task-claim vs file-lock axes | Filesystem-perms-only security; no TTL on locks; no UI |
| **Concord** (RL paper — near-miss) | Principle only: make each agent's **identity + intent an explicit, queryable signal** | The whole learned/black-box mechanism (opposite of legible/governed) |

**Net synthesis:** *durable message thread (Coral-shaped, agent_mail-durable) + advisory leases (agent_mail) with task layer (swarm/task-graph) + priority tiers & delivery receipts (MACP) + symbol-locking as a v2 upgrade (wit), all under a human-in-command governance layer nobody else has, on SQLite-WAL with push.*

---

## 2. Tech stack & exact dependencies

**Language/build:** TypeScript 5.x, **pnpm** workspaces + TS project references. Node 20 LTS (pinned via `engines` + `.nvmrc`).

**App / hub (`packages/server`)**
- `@modelcontextprotocol/sdk` (**stable 1.x**) — MCP server, Streamable HTTP transport.
- `express` + `cors` — HTTP (MCP endpoint + REST for the UI).
- `ws` — WebSocket push to the room UI.
- `better-sqlite3` — synchronous SQLite (WAL); enables atomic, race-free lease grants.
- `zod` — schemas/validation (shared package).
- `nanoid` — long, URL-safe session IDs (the room credential).
- `picomatch` — glob overlap for lease conflict detection.
- `async-mutex` — serialize state mutations where needed.
- `pino` — structured logging.

**Both UIs (`apps/room-ui`, `website`)**
- `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, TypeScript.
- `tailwindcss` **v4** (CSS-first `@theme`, custom **OKLCH** tokens — avoids the generic look).
- `motion` (the renamed Framer Motion; `motion/react`) — tasteful spring/tween, `useReducedMotion`.
- `three` + `@react-three/fiber` + `@react-three/drei` — interactive backgrounds (DPR-clamped, `frameloop` managed, reduced-motion fallback).
- Fonts (free, distinctive — NOT Inter): **Fraunces** (display serif), **Hanken Grotesk** (body/UI), **JetBrains Mono** (agent/code output). Upgradeable to commercial PP Editorial New / Neue Montreal later.

**Website only (`website`)**
- `firebase` **v12** (modular) — Firestore writes for waitlist + feedback.
- (Optional, recommended) Firebase **App Check + reCAPTCHA v3** for abuse protection.

**Testing/evidence**
- `vitest` — unit + integration (incl. spinning the MCP server and connecting real SDK **clients**).
- `@playwright/test` — browser E2E + screenshots (evidence) for both UIs.
- Chrome DevTools MCP — a11y/perf/Lighthouse audits.

**Shared (`packages/shared`)**: all zod schemas + inferred TypeScript types, shared by server and both UIs (one source of truth, per the spec's "shared types" constraint).

> Version discipline: every dependency's exact version is verified against npm at install time; this plan pins *lines/majors* and the *stable-not-alpha* rule, not fragile patch numbers.

---

## 3. Repository architecture

```
Bothread/
├─ SPEC.md  PLAN.md  CLAUDE.md  README.md  LICENSE(MIT)
├─ pnpm-workspace.yaml  package.json  tsconfig.base.json  .nvmrc
├─ website/                         # §13 deliverable — built & deployed FIRST, standalone
│   ├─ src/ (App, sections, components, lib/firebase.ts, lib/waitlist.ts, lib/feedback.ts, three/Background)
│   ├─ firestore.rules   vercel.json   vite.config.ts   .env.example
│   └─ tests/ (playwright)
├─ packages/
│   ├─ shared/                      # zod schemas + types (Room, Participant, Message, Lease, Approval, AuditEvent, all MCP tool I/O)
│   └─ server/                      # the local hub
│       ├─ src/
│       │   ├─ index.ts             # CLI entry: start hub, bind 127.0.0.1, open browser
│       │   ├─ http.ts              # express app: /mcp (MCP), /api/* (UI REST), /ws (push), serves built UI
│       │   ├─ mcp/                 # transport wiring, per-connection McpServer, tool registration
│       │   │   ├─ transport.ts     # Streamable HTTP, session map, auth, origin check
│       │   │   └─ tools.ts         # join_session, get_room_state, send_message, claim_files, … (agent surface)
│       │   ├─ engine/              # coordination engine (framework-agnostic, unit-testable)
│       │   │   ├─ rooms.ts  participants.ts  messages.ts  leases.ts  approvals.ts  audit.ts
│       │   ├─ db/                  # better-sqlite3 schema + queries (WAL, IMMEDIATE txns)
│       │   └─ realtime.ts          # WS hub + pending-promise waiters (wait_for_update)
│       └─ tests/ (vitest: engine unit + MCP-client integration)
├─ apps/
│   └─ room-ui/                     # the human room (React+Vite), dev-proxied to hub, prod-served by hub
│       ├─ src/ (Room, Thread, ParticipantsRail, LeaseMap, ApprovalDock, CommandBar, three/Background)
│       └─ tests/ (playwright)
├─ skill/                           # the Bothread skill + cross-agent rule files (install-once)
│   ├─ SKILL.md                     # canonical (etiquette + join ceremony)
│   ├─ AGENTS.md  CLAUDE.md  cursor.mdc  windsurf.md   # thin wrappers/snippets
│   └─ mcp-config-examples/         # per-agent add-server snippets (http url + header)
└─ .evidence/                       # screenshots + saved test output (proof for each gate)
```

The website is intentionally a **standalone app** (own deploy), sharing only the visual spirit with the app — never tangled, per §13.

---

## 4. Shared data model (zod → types)

Authoritative shapes (abbreviated; full zod in `packages/shared`):

- **Room**: `{ id, name, projectPath?, sessionId (secret credential), status: 'active'|'paused'|'closed', createdAt, settings: { requireApprovalFor: ('delete'|'deploy'|'shell'|'git_push'|…)[], defaultLeaseTtlMs } }`
- **Participant**: `{ id, roomId, name, brand?, kind: 'agent'|'human', status: 'active'|'idle'|'muted'|'revoked', mcpSessionId?, capabilities?, joinedAt, lastSeenAt }`
- **Message**: `{ id, roomId, seq (monotonic), authorId, authorName, kind: 'agent'|'human'|'system', importance: 'info'|'advisory'|'steering'|'interrupt', text, mentions: string[], threadId?, createdAt }`
- **Lease** (file claim): `{ id, roomId, participantId, pathPattern, exclusive: bool, reason?, status: 'active'|'released'|'expired', createdAt, expiresAt, releasedAt? }`
- **Approval**: `{ id, roomId, requestedById, action, details, files?, status: 'pending'|'approved'|'rejected'|'edited', decidedBy?, editedInstruction?, createdAt, decidedAt? }`
- **AuditEvent**: `{ id, roomId, seq, ts, actorId, type, payload }` — append-only; every join/leave/message/claim/release/approval/pause/mute/revoke.

Monotonic `seq` per room gives ordering, replay, and per-consumer cursors (the `wait_for_update`/`read_messages since` mechanism).

---

## 5. MCP server design — the agent surface (§7 "clean, structured")

### 5.1 Session & credential model (honors §6 exactly)
- **One-time setup:** user adds the Bothread MCP server once at `http://127.0.0.1:<port>/mcp`. The hub mints a local **install token** (shown in the UI) used as `Authorization: Bearer <installToken>` to authenticate the *connection* to the local hub. (Localhost-only; the token stops other local processes from poking the hub.)
- **Per-room join (live):** user creates a room in the UI → gets a long **session ID** (the room credential, `nanoid(32)`). User tells their agent "join this Bothread session" + pastes the ID. Agent re-reads the skill, calls **`join_session({ sessionId, agentName })`**.
- **Binding + per-request validation:** on a valid `join_session`, the hub binds that **`Mcp-Session-Id` → room membership**. Every room-scoped tool re-checks that the calling MCP session maps to a **live, non-revoked, non-muted** membership in an **active** room. **Revoke** (human action) flips membership → the agent's very next call is rejected. This is "the session credential validated on each request." Room tools also accept an optional `sessionId` arg so stateless clients still re-validate.
- **The session ID never lives in the skill file or MCP config** — only handed over live. ✔

### 5.2 Tool surface (small, legible — ~10 tools)
All inputs/outputs are zod-typed; all returns are **clean structured objects** (and a readable text rendering) so an agent instantly understands the room.

| Tool | Input | Returns / effect |
|---|---|---|
| `join_session` | `sessionId, agentName, brand?, capabilities?` | Joins; returns **RoomSnapshot** (you, participants, recent thread, active leases, your claimable status, etiquette reminder). |
| `get_room_state` | `since?` | The **RoomSnapshot** — the canonical "what's going on" view (participants+status, recent messages, leases by file w/ holder, pending approvals, room paused?). |
| `send_message` | `text, mentions?, threadId?, importance?` | Posts to the room thread; broadcast/pushed to others + UI. |
| `read_messages` | `since? (seq), unreadOnly?, mentionsMe?` | Pull messages with a cursor (robust everywhere). |
| `wait_for_update` | `maxWaitMs (≤ configurable)` | Long-poll: resolves on new message/mention/approval-decision (pending-promise + `replayAfter`); avoids busy-polling. |
| `claim_files` | `paths[], exclusive?=true, reason?, ttlSeconds?` | Atomically acquires advisory leases. **Exclusive conflict ⇒ DENIED** with `{ granted, conflicts:[{path,heldBy}] }`; collision is recorded + surfaced to the human. |
| `release_files` | `paths? | leaseIds?` | Releases leases (all if unspecified). |
| `renew_files` | `paths? | leaseIds?, ttlSeconds?` | Extends TTL (liveness). |
| `request_approval` | `action, details, files?` | Creates a pending approval, **blocks** (awaits human) → returns `approved|rejected|edited(+instruction)`. The risk gate. |
| `leave_session` | — | Releases leases, marks left, posts a system message. |

`update_status` (presence note) may be folded into `send_message`/heartbeat. Tools carry MCP annotations (`readOnlyHint` on `get_room_state`/`read_messages`; "requires human attention" semantics on `request_approval`).

### 5.3 RoomSnapshot (the agent's clean view) — shape
```
{ room:{name,status}, you:{name,status,leases:[…]},
  participants:[{name,brand,status,claimedFiles:[…],lastSeen}],
  thread:[{seq,author,kind,importance,text,mentions,at}],   // recent N
  locks:[{path,heldBy,exclusive,expiresAt}],
  pendingApprovals:[{id,action,details}],
  etiquette:"Claim files before editing. Never edit a file held by another. …" }
```

---

## 6. Coordination engine

### 6.1 Messages (the thread)
- Durable, append-only (`seq` monotonic). Pushed to UI (WS) and to agents (GET SSE + `wait_for_update`). Threading via `threadId`/reply. **Importance tiers** (`info/advisory/steering/interrupt`) drive UI prominence; human messages default to `steering`/`interrupt`.
- Rendered to the human as a **single live timeline** (chat feel) even though agent↔agent addressing can be targeted (mentions) — resolves the "mail vs chat" tension the research flagged.

### 6.2 File leases (collision prevention — the demoable core)
- **Advisory leases** on **glob paths**, `exclusive` (default) or `shared`. Conflict rule (from agent_mail, ported to TS w/ `picomatch`): same participant never conflicts; shared+shared never conflicts; otherwise symmetric glob overlap ⇒ conflict.
- **Atomic granting:** the read-check-write runs inside a single `better-sqlite3` **IMMEDIATE** transaction → no two agents win the same exclusive lease (the TOCTOU bug agent_mail hit; we avoid it by construction).
- **MVP enforcement = deny-on-conflict for exclusive claims**, so "collisions are prevented" is literally true and *visible*: Agent B's `claim_files` on a path Agent A holds exclusively is **rejected** with a clear `heldBy` conflict; the human sees the attempt + the prevention live. (Post-MVP: optional git pre-commit guard + symbol-level (wit) granularity for finer parallelism.)
- **TTL + auto-expiry swept on every lease op** (no zombie locks); `renew_files` for liveness; releasing reopens the path immediately.

### 6.3 Tasks (lightweight, optional for MVP)
- Optional intent/claim layer (swarm-protocol shape) to show "who's doing what." Not required for the §14 MVP; leases + messages prove the thesis. Kept in the model for the room UI's "what each agent is working on."

### 6.4 Realtime
- `realtime.ts` holds WS connections (UI) and pending-promise **waiters** keyed by filters (`Mentions`/`Thread`/`From`/`Approval`) — Coral's pattern. Any engine mutation publishes an event → resolves matching waiters + WS broadcast + audit append.

---

## 7. Security & human-in-command (the reason Bothread exists)

- **Localhost foundation:** bind `127.0.0.1`; validate `Origin`; install token authenticates connections; nothing exposed publicly.
- **Per-request credential validation:** every room tool re-validates membership (active room, not revoked/muted) — §9 satisfied.
- **Least privilege + approval gates:** room `settings.requireApprovalFor` lists risky actions (delete/deploy/shell/git_push/…). Agents must call `request_approval` (taught by the skill) before such actions; the human **approve / reject / edit-and-redirect** in the UI. (MCP **elicitation** is the spec-native path but Claude Code doesn't support it yet → we implement the approval as a blocking Bothread tool + UI dock, which works for *every* MCP client. Forward-compatible with elicitation.)
- **Always in command:** **pause room** (freezes agent actions — mutating tools return "room paused"), **mute agent** (messages/claims rejected), **revoke agent** (membership invalidated; immediate), **message the room** as the privileged **HumanOverseer** (bypasses muting, high importance, "pause→comply→resume" preamble).
- **Full audit log:** every action appended (`AuditEvent`), visible + exportable in the UI — trust + post-mortem.
- **Default-deny posture** (tighter than agent_mail's permissive localhost default).

---

## 8. The skill file + setup/join flow (install once; re-read at join)

- **`skill/SKILL.md`** (canonical): frontmatter (`name: bothread`, description, `disable-model-invocation: true` → user triggers `/bothread`), then: room etiquette (ALWAYS call `get_room_state` first; ALWAYS `claim_files` before editing; NEVER edit a file held by another; use `send_message` since your text isn't visible to others; call `request_approval` before risky actions; `leave_session` when done) and the **join ceremony** (acknowledge → ask user to paste session ID → `join_session` → `get_room_state` → report).
- **Cross-agent wrappers:** `AGENTS.md` (Codex/Cursor/Windsurf/OpenCode), `CLAUDE.md` import, `.cursor/rules/bothread.mdc`. Same etiquette, each agent's format.
- **`skill/mcp-config-examples/`:** copy-paste add-server snippets per agent (HTTP url + `Authorization: Bearer <installToken>`), plus the `mcp-remote` fallback for OpenCode/stdio-only.
- **Session ID stays out of all of the above** — pasted live. ✔

---

## 9. The human UI — the room (the product)

### 9.1 Information architecture (one screen, calm authority)
- **Center — Live Thread:** the conversation (agents ↔ agents ↔ you), real-time, ARIA live region. Importance tiers styled distinctly; system events (joins, claims, collisions prevented, approvals) inline as quiet rails.
- **Left — Participants rail:** each agent with brand, status (active/idle/muted/revoked), and **what it's working on / files it holds**.
- **Right — Lease/Lock map:** files currently claimed, by whom, exclusive/shared, TTL; **collisions surface here loudly** when prevented.
- **Bottom — Command bar:** message-as-overseer input + room controls (Pause, …) ; **Approval Dock** rises when an agent requests a risky action (Approve / Reject / Edit-and-send).
- **Top — Room header:** name, session ID (copy, with reveal/secret treatment), status, agent count.

### 9.2 Agent-experience parity (§7)
The same state powers the agent's `RoomSnapshot` (§5.3) — clean, structured, legible. Human surface = beautiful; agent surface = legible. Both first-class.

### 9.3 Accessibility (built in, not bolted on)
`:focus-visible` everywhere; `role="log"`/`aria-live="polite"` for the thread, `role="alert"`/`assertive` for approvals; ≥4.5:1 contrast (palette verified); `prefers-reduced-motion` disables the Three.js loop → static fallback; native `<button>`s; 44px targets; keyboard-complete.

---

## 10. (Covered above — numbering kept aligned with build phases below.)

## 11. Visual direction — **"Loom"** (recommended; the one decision for Adam)

The name *Bothread* → **thread / loom / weave**: many agents' threads woven into one cloth, with you at the loom. Distinctive, on-name, premium, and explicitly **not** the forbidden purple-on-black AI-slop.

- **Palette (OKLCH; warm ink, not navy/purple):** canvas `#14110D` (warm charcoal-ink), surface `#1E1A14`, parchment text `#EDE6D6`, muted `#A89F8C`, **thread accent copper/saffron `#C8743A`→`#D89A3E`**, **"live" teal/sage `#5FA98C`**, alert clay `#C2553D`. (All text pairs verified ≥ ~12:1.)
- **Type:** **Fraunces** (characterful editorial serif — authority, "head of the table") for display; **Hanken Grotesk** for UI/body; **JetBrains Mono** for agent/code output. Free; upgrade path to PP Editorial New + Neue Montreal.
- **Signature background (both site + app):** an **interactive woven-filament field** in react-three-fiber — warm threads that flow and gently weave, parting/responding around the cursor (a custom GLSL flow-field on a fullscreen quad, or GPGPU filaments). DPR-clamped, `frameloop` paused when hidden, full static fallback for reduced-motion. On the **app** it's quieter (calm, in the background); on the **site** it's the hero centerpiece.
- **Motion:** measured, exponential easing (`ease-out-expo/quart`), low-bounce springs only for the approval dock; never elastic/bouncy. Messages stagger-fade in; lock state changes animate deliberately.
- **Layout:** editorial, asymmetric, generous negative space, intentional grid-breaks; no card-grid sea, no default glassmorphism.

I'll use the **`frontend-design` skill** when building each UI to hold this bar. *If you'd prefer a cooler "Technical Blueprint" (deep ink-blue, technical-blue accent) or stark "Terminal-Luxe" (acid-lime on near-black), say so — otherwise I build Loom.*

---

## 12. The website (§13 — built & deployed FIRST)

### 12.1 Content / sections
1. **Hero** — name, one-line promise ("A calm room where your AI agents work together — and you stay in command."), the woven-thread background, primary CTA (join waitlist).
2. **The problem** — agents can't talk, they collide, the human is shut out (from §3).
3. **How it works** — create a room → agents join with a session ID → watch them collaborate → step in anytime. Custom SVG diagram.
4. **Why it's different** — the watchable, human-governed room (the moat); not terminal-only plumbing.
5. **Waitlist** — email capture → Firestore.
6. **Feedback** — category + message (+ optional email) → Firestore ("doesn't work with Codex", feature requests).
7. **Footer** — concise, links, honest "local-first, MCP-native".

### 12.2 Firebase (`bot-thread`) + data
- `lib/firebase.ts` (modular v12, singleton, `VITE_` config). Firestore collections:
  - `waitlist/{encodedEmail}` — `{ email, source, createdAt(server), userAgent }` (doc-id = encoded email ⇒ dedupe).
  - `feedback/{autoId}` — `{ category, message, email?, createdAt(server), userAgent, page }`.
- **Firestore rules:** allow **create** with strict field/format/length validation; **deny read/list** (no email harvesting); deny update/delete (waitlist upsert excepted). `createdAt == request.time` enforced.
- **Abuse:** recommend **App Check + reCAPTCHA v3** (rules are the backstop). Debug token for local. (Can ship MVP with rules-only and add App Check before broad launch.)
- Config retrieval: try **Firebase MCP `firebase_get_sdk_config`** for `bot-thread`; if not authenticated, ask Adam for the web config object.

### 12.3 Deploy (Vercel CLI, token-based)
- `vercel.json` SPA rewrite (`/(.*) → /index.html`); Vite outputs `dist`; Node pinned.
- Set `VITE_FIREBASE_*` via `vercel env add … production`. Deploy: `vercel --prod --yes --token=$VERCEL_TOKEN` (token already in `.env.local`). Project name `bothread` ⇒ **bothread.vercel.app**.
- **Then STOP for Adam's approval (GATE B).**

---

## 13. Phased build plan — acceptance criteria + how I'll test each

> Principle: each phase ends at a **working, demonstrable** point with **evidence** (command output and/or screenshot saved to `.evidence/`). Nothing is "done" until tested, including UI in a real browser.

### PHASE 0 — Research + PLAN.md ✅ (this document)
- **Done when:** research synthesized; PLAN.md reviewable. **Evidence:** this file + CLAUDE.md.

### GATE A — Adam reviews PLAN.md → greenlight. ⟵ *we stop here.*

### PHASE 1 — Website
- **1a Scaffold + visual system.** Accept: Vite app builds; Loom tokens/fonts/Tailwind theme in place. Test: `pnpm build` clean; Playwright screenshot of styled shell.
- **1b Three.js background + sections + responsiveness + a11y.** Accept: hero background interactive at ≥50fps desktop, static fallback under reduced-motion; all sections responsive (mobile/desktop); keyboard + contrast pass. Test: Playwright at 390px & 1440px + screenshots; Chrome DevTools a11y/Lighthouse audit.
- **1c Firebase wiring + forms + rules.** Accept: submitting waitlist writes a `waitlist` doc; feedback writes a `feedback` doc; duplicate email is graceful; reads are denied. Test: Playwright fills+submits both forms; verify docs exist (Firebase MCP read / temporary check) and that a client read is rejected; save output.
- **1d Deploy.** Accept: **bothread.vercel.app** serves the site; a live submission lands in Firestore. Test: Playwright against the live URL + screenshot; confirm the doc. **Evidence → `.evidence/`.**
- **→ GATE B: present live URL + screenshots + Firestore proof; STOP for approval.**

### PHASE 2 — App core (after approval)
- **2a Monorepo + shared schemas + SQLite.** Accept: `packages/shared` types compile and are imported by server; DB schema migrates; engine unit tests (leases conflict rule, atomic grant, TTL expiry, message seq) pass. Test: Vitest suite output.
- **2b MCP server + join/credential.** Accept: a real MCP **SDK client** connects over Streamable HTTP, calls `join_session` with a room's session ID, gets a RoomSnapshot; an invalid/revoked session is rejected on the next call. Test: Vitest integration spinning the server + 2 clients; output saved.

### PHASE 3 — **Thesis milestone (early, the proof)**
- Two **different-brand** participants (modeled as two MCP clients with distinct `brand`, then re-verified with real Claude Code + Cursor): both join one room, exchange messages, and when both try to `claim_files` the **same path exclusively, the second is prevented** with a visible conflict; the human UI shows the conversation + the prevented collision live.
- **Accept:** automated integration test demonstrates message exchange + collision prevention deterministically; **and** a real two-agent run is captured. **Test/evidence:** Vitest output + a Playwright/real screenshot of the room showing two brands + the prevented collision.

### PHASE 4 — Room UI + human-in-command
- Live thread (WS), participants rail, lease/lock map, command bar, **approval dock**; controls: pause / mute / revoke / message-as-overseer / approve-reject-edit.
- **Accept:** each control provably changes agent behavior (paused ⇒ agent's mutating call is refused; revoke ⇒ next call rejected; approval ⇒ agent's `request_approval` unblocks with the decision). Test: Playwright drives the UI while an SDK client acts as the agent; screenshots per control.

### PHASE 5 — Skill + multi-agent + §14 MVP
- Finalize `SKILL.md` + AGENTS.md + per-agent config snippets; document one-time setup + live join.
- **Reach §14 / the /goal:** **4 different-brand MCP agents** join one room, talk in real time, file collisions prevented, locks visible, and human can pause/approve/mute/revoke. Target real agents **Claude Code + Cursor + Antigravity**; **Codex** can't be personally verified (no subscription, per spec) → covered by a 4th distinct **MCP SDK client** participant + built-to-standard so Codex works in the wild (the site's feedback channel catches reality). Be explicit in evidence about which were real vs scripted.
- **Accept/evidence:** screenshots of the populated room with 4 distinct brands + a prevented collision + an approval handled; saved test logs; README + MIT LICENSE present.

### PHASE 6 — Polish, docs, hardening
- README (what/why/install/join), troubleshooting (incl. `mcp-remote` for OpenCode, Cline header caveat), error states, performance pass, final a11y audit.

---

## 14. Testing & evidence strategy (overall)
- **Engine:** Vitest unit tests for the pure engine (deterministic: lease conflicts, atomic grant, TTL, ordering, approvals, revoke).
- **MCP integration:** Vitest spins the real hub and connects **multiple `@modelcontextprotocol/sdk` clients** as stand-in agents — proves join/credential/messaging/collision/approval mechanics without needing four paid subscriptions, deterministically and in CI.
- **Real-agent demo:** the genuinely different-brand run (Claude Code + Cursor + Antigravity) for the thesis + MVP, captured as screenshots.
- **UI:** Playwright (functional + responsive + screenshots) and Chrome DevTools MCP (a11y/Lighthouse). The website is verified against the **live** Vercel URL before "done."
- **Evidence discipline:** every gate/phase stores the command + output and/or screenshot under `.evidence/` and a one-line entry in `CLAUDE.md`'s Evidence Log. I report outcomes faithfully — failures shown, not hidden.

---

## 15. Risks & mitigations
- **Per-client MCP quirks** (OpenCode HTTP broken; Cline header bug; claude.ai web OAuth-only). → Native HTTP for the 6 that support it (covers all test agents); ship `mcp-remote` fallback + document; don't block MVP on web/OpenCode.
- **Server→client push gaps on Streamable HTTP.** → Always provide robust pull (`read_messages`, `wait_for_update`) in addition to SSE.
- **Concurrency / lease races.** → Atomic grants under `better-sqlite3` IMMEDIATE transactions (designed-in, tested).
- **Approval UX without elicitation support in Claude Code.** → Blocking Bothread tool + UI dock (works everywhere), forward-compatible with MCP elicitation.
- **"AI-slop" UI risk.** → Committed Loom direction + `frontend-design` skill + explicit anti-patterns banned + real-browser review.
- **Scope creep.** → Symbol-level locking, git commit-guard, task DAG, Tauri packaging, App Check are **post-MVP**; MVP = leases (deny-on-conflict) + thread + controls.

## 16. Open questions for Adam
1. **Confirm the "Loom" visual direction?** (Default: yes, I build it. Alternatives: Technical Blueprint / Terminal-Luxe.)
2. **App packaging:** MVP as local hub + browser at `127.0.0.1` (recommended, fastest, fully testable); native wrapper (Tauri) later. OK to proceed?
3. **Firebase web config** for `bot-thread` — I'll try the Firebase MCP first; I'll only ask if it isn't authenticated.

*Everything else proceeds on the recommendations above. On your greenlight, I start Phase 1 (the website).*
