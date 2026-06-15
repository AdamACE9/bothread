# Bothread — Build Journal & Working State

> **Read this first when resuming.** This file is the single source of continuity. If context was
> compacted, you can pick up exactly where things left off by reading this + `PLAN.md`.
> Source of truth for *what* to build: `SPEC.md` (in `~/Downloads/SPEC.md`). *How* to build: `PLAN.md`.

**One-liner:** Bothread = a local, human-governed room where any MCP-compatible AI agents collaborate
on one codebase while the human watches and stays in command. TypeScript end-to-end, MCP-based,
local-first. Plus a public marketing website (bothread.vercel.app) with waitlist + feedback.

---

## CURRENT STATUS

- **Phase:** MCP MVP **BUILT + WORKING** end-to-end. Website = DONE + LIVE. GATE A + GATE B passed.
- **Live site:** https://bothread.vercel.app (Vercel project `bothread`, team `adams-projects-28e38c4e`, prj_r4qYoX8Pdic0tJKVfC32vLZOWWVJ).
- **MCP app:** `packages/shared` + `packages/server` (engine/MCP/REST/WS) + `apps/room-ui` + `skill/` all done. 23 tests green; UI live with 3 real MCP clients; README + LICENSE written.
- **Next action:** optional polish — real-brand 4-agent demo capture; then it's feature-complete for MVP. (Adam handles GitHub.)
- **Last updated:** 2026-06-15.

### The mandated workflow (DO NOT REORDER) + gate status
1. ✅ Research first (two-phase, parallel agents). **DONE.**
2. ✅ Write `PLAN.md`. **DONE.**
3. ✅ **GATE A — PLAN.md greenlit by Adam.**
4. ✅ Build the website (§13) — Firebase `bot-thread`, deployed to bothread.vercel.app.
   - Hero room widget rebuilt as a **live, interactive** preview (streaming msgs, lease strip, collision-prevented, real Approve/Deny prompt, pause/play). Favicon + "works with" strip added.
5. ✅ Deploy website → **GATE B PASSED** — Adam saw it live, said "blaze done. start on mcp!"
6. ✅ **Built the Bothread MCP app/hub** (§2–§8, §14 MVP) — engine + MCP server + room UI + skill, 23 tests green, live demo captured.

### MCP build deviations from PLAN (noted)
- **npm workspaces** instead of pnpm (pnpm not installed; corepack shim not on PATH; npm 10.9 workspaces suffice and match the website's npm setup). Workspace scoped to `packages/*` + `apps/*`; `website/` stays standalone (already deployed — don't disturb).
- **SQLite:** trying `better-sqlite3` (prebuilds; no MSVC on this box). Fallback = Node built-in `node:sqlite` (`--experimental-sqlite`) or `sql.js` if prebuild unavailable.

### Website deploy facts (so I don't relearn them)
- SSO/Deployment Protection was ON by default → disabled via `PATCH /v9/projects/{id}` `{ssoProtection:null}` so the site is public.
- Node was auto-set to 24.x (Vercel rejects) → set to `22.x` via project API.
- 6 `VITE_FIREBASE_*` env vars added to the Vercel project (production+preview).
- `bothread.vercel.app` is a **manual alias** → after each `vercel --prod`, re-point it: `vercel alias set <new-deployment-url> bothread.vercel.app --token=… --scope=adams-projects-28e38c4e`.
- ✅ **Waitlist + feedback WORK** (fixed 2026-06-15). Root cause was NOT billing — the `(default)` Firestore DB existed but was locked (deny-all); writes returned HTTP 200 but rules rejected → client showed "Submission was blocked". Fix: `cd website && firebase deploy --only firestore:rules` (compiled + released fine). Verified live: real waitlist + feedback docs persisted (then deleted the 2 test docs). The client code was already correct (serverTimestamp, valid fields).

---

## TODO / CHECKLIST

### Stage 0 — Research ✅
- [x] Phase 1 broad landscape (6 agents): MCP TS server, client configs, skill files, premium UI/Three.js, Firebase+Vercel, coordination landscape.
- [x] Phase 2 deep repo dives (5 agents): swarm-protocol, Concord, mcp_agent_mail, task-graph-mcp, Coral Protocol (+ each discovered one more: mcp_agent_mail, MACP, wit, etc.).
- [x] Synthesize into PLAN.md.

### Stage 1 — Website ✅ (DONE + LIVE)
- [x] Scaffold `website/` (Vite + React + TS; pure-CSS Loom theme, not Tailwind).
- [x] Visual system per PLAN §11. Fonts, OKLCH-ish warm-ink tokens, motion, grain.
- [x] Three.js interactive woven-thread background (lazy-loaded) + reduced-motion fallback.
- [x] Sections: hero, problem, how-it-works, why-different, waitlist, feedback, footer.
- [x] Hero room widget upgraded to **live + interactive** (streaming, lease strip, collision, Approve/Deny, pause/play); favicon + "works with" strip.
- [x] Firebase init (`bot-thread`); waitlist + feedback submit (lazy); Firestore rules (write-only).
- [x] Firebase web config obtained (created "Bothread Web" app via CLI).
- [x] Tested in real browser (Chrome DevTools MCP) + screenshots.
- [x] Deployed to Vercel; **bothread.vercel.app live** (SSO off, Node 22, env vars set).
- [x] **GATE B passed** — Adam saw it live, said "blaze done. start on mcp!"
- [ ] ⚠️ Firestore writes blocked until **billing enabled on `bot-thread`** (then `firebase deploy --only firestore:rules`).

### Stage 2 — MCP app/hub 🔨 (in progress)
- [x] Monorepo: `packages/shared`, `packages/server`. (`apps/room-ui` scaffolding now; `skill/` pending.) npm workspaces.
- [x] Shared zod types (rooms, participants, messages, leases, approvals, audit, tool I/O, RoomSnapshot).
- [x] MCP Streamable HTTP server (SDK 1.29), per-connection McpServer, session/credential model, ~10-tool surface.
- [x] Coordination engine: messages + advisory leases (exclusive/shared, glob, TTL, atomic grant) on SQLite (WAL).
- [x] Human-in-command: pause/mute/revoke/approve + HumanOverseer + append-only audit log (engine + REST done).
- [x] Room UI (`apps/room-ui`) — live thread + participants rail + lock map + command bar + approval dock + pause/mute/revoke/approve, over REST + WS. Builds (49 kB gz), typechecks, hub serves its `dist/`.
- [x] Skill file + AGENTS.md + per-agent mcp-config snippets (`skill/`). Session ID stays out of all of them.
- [x] **Thesis milestone:** 2 different-brand MCP clients talk + collision PREVENTED over HTTP (integration test green).
- [x] **§14 MVP reached (scripted-client demo):** 4 participants (You + Claude Code + Cursor + Gemini) in one live room, collision prevented, locks visible, approval approved via UI — captured in `room-ui-live.png`. Real-brand run (Claude Code + Cursor + Antigravity) is the remaining real-agent capture.
- [x] Evidence: 23 automated tests green (engine + MCP integration); live room screenshot.
- [x] README + MIT LICENSE.

### MCP app — DONE state (2026-06-15)
- All 3 packages typecheck clean; `npm test` = **23 green**; UI builds; hub boots + serves UI + drives 3 live MCP clients end-to-end (join → claim → collision prevented → message → blocking approval → overseer approves in UI → resolves).
- **Global CLI `bothread start`** (runs from ANY dir): root `bin/bothread.mjs` (start/help/version) → builds UI first run → spawns hub via node+tsx → **auto-opens browser**. Install once in the folder: `npm install && npm link` (→ global `bothread` shim; later `npm i -g bothread`). `npm start` delegates to the same bin. Hub persists a **stable install token** to `<dataDir>/install-token`. `BOTHREAD_NO_OPEN=1` skips browser; `BOTHREAD_AUTH=off` for no token. Verified running from `C:\Users`.
- **In-UI "Connect an agent" panel** (`apps/room-ui/src/ConnectPanel.tsx` + `GET /api/connect-info`): copy-paste setup per agent (Claude Code one-liner, Cursor/Gemini/Codex configs) with the MCP URL + token pre-filled, plus the session ID to paste. This is how the user connects agents.
- **Verified clean-state (2026-06-15):** deleted `apps/room-ui/dist`, ran `npm start` → it rebuilt UI + booted + served; 3 real MCP clients connected WITH the bearer token (auth on), collision prevented, approval pending; real screenshots `evidence-room.png` + `evidence-connect.png`. Demo room cleared from local DB afterward (token kept).
- **Remaining (optional polish):** real-brand agent demo (user is doing this); `requireApprovalFor` enforcement is advisory (skill-taught, no syscall interception, by design for MVP); symbol-level locks + git pre-commit guard are post-MVP (PLAN §15).

---

## KEY FACTS / CONFIG
- **Firebase project ID:** `bot-thread` (waitlist + feedback in Firestore). Web config = public by design.
- **Vercel target:** `bothread.vercel.app` (project name `bothread`). Token saved in `.env.local` (gitignored).
- **GitHub:** Adam handles it himself. Do NOT create/push repos or look for GitHub access.
- **Only credential needed from Adam:** Vercel token (already provided + saved).
- **Local hub (planned):** binds `127.0.0.1` only; MCP endpoint `http://127.0.0.1:<port>/mcp`; UI on same host.
- **Repo root:** `C:\Users\Adam Ahmed Danish\OneDrive\Adamcodingstuff\Bothread` (note: git root is the home dir).

## LOCKED DECISIONS (see PLAN.md for rationale)
- TypeScript end-to-end; pnpm workspaces monorepo; shared zod types.
- MCP: **stable `@modelcontextprotocol/sdk` 1.x** (NOT 2.0-alpha), **Streamable HTTP**, one McpServer per connection, room state in app layer.
- Credential model: session ID pasted live → `join_session` binds it to the MCP session; re-validated each request; revoke invalidates.
- Coordination: durable message thread + **advisory file leases** (exclusive/shared, glob, TTL, atomic grant under serialized txn). Exclusive-claim collisions **denied + shown** at claim time for the MVP demo; git pre-commit guard = later.
- Storage: `better-sqlite3` (WAL) store-of-record + append-only audit; WebSocket push to UI.
- Server HTTP: Express + `ws`. Tests: Vitest (engine/integration) + Playwright (UI evidence).
- Website + UI: Vite + React + TS, Tailwind v4 with custom OKLCH theme, Motion (motion/react), r3f+three for backgrounds. Use `frontend-design` skill.
- **Visual direction:** recommending **"Loom"** (warm ink canvas, copper/saffron thread accent, teal "live", editorial serif + grotesque + mono, woven-filament interactive background). PENDING Adam confirm.

## OPEN QUESTIONS FOR ADAM
1. Confirm/veto the **"Loom"** visual direction (the one taste call).
2. App packaging: MVP = local server + browser at 127.0.0.1 (recommended); Tauri/Electron later. (Proceeding unless vetoed.)
3. Firebase web config — will fetch via Firebase MCP first; may ask if MCP isn't authenticated.

## RESEARCH AGENT IDS (to continue via SendMessage if a follow-up is needed)
- MCP TS server: `aabf10969f2be199c` · Client configs: `a43e1ff8e12177b52` · Skill files: `a20960877ea80ad7b`
- UI/Three.js: `a872087c2a20fa3bd` · Firebase/Vercel: `a9d5cf3ee5c83f307` · Landscape: `a818e1406b21e4582`
- swarm-protocol+mail: `a07447f18b8782f51` · Concord+mail: `ac411c57e94fd9414` · agent_mail+MACP: `a54803f7eac37ea1e`
- task-graph+wit: `add40ee0fb83ca349` · Coral+mail: `ac3b55f03a90298fa`

## EVIDENCE LOG (fill as we go)
- **Website live:** https://bothread.vercel.app (Vercel `bothread`, prod). Screenshots: `hero-live-final.png`, `hero-approval.png`.
- **MCP monorepo built (Phase 2 + 3 DONE):** `packages/shared` (zod types) + `packages/server` (engine, MCP Streamable-HTTP, REST, WS).
  - `npm install` clean (210 pkgs, 0 vuln). `better-sqlite3` 12 prebuild loads on Node 22 win-x64 (no MSVC needed).
  - `packages/server` → `npx tsc --noEmit` exit 0.
  - **Tests: 23 passed** (`npx vitest run`): 20 engine units (glob-overlap, collision deny, all-or-nothing, shared coexist, TTL sweep, msg seq/cursor, blocking approval, pause/mute/revoke, snapshot) + **3 MCP-over-HTTP integration** (tool list; two-brand `claim_files` collision PREVENTED over the wire; blocking `request_approval` decided via REST).
  - Hub CLI boots: `BOTHREAD_PORT=4890 BOTHREAD_AUTH=off npm run hub` → `/api/health` ok, `POST /api/rooms` returns room + sessionId.
- **Server design notes:** `tsx` runs TS directly (no build step); shared package exports `src/index.ts`. Atomic lease grant via synchronous `better-sqlite3` txn. Approval = blocking promise resolved by overseer decision (REST/UI). Auth = Bearer install-token on `/mcp` (set `BOTHREAD_AUTH=off` for tests). Per-connection McpServer; `Mcp-Session-Id` → participant binding; revoke clears binding + releases leases.

## NEXT (resume here)
- ⬜ Phase 4: room UI (`apps/room-ui`) — live thread + participants rail + lock map + command bar + approval dock, over REST + WS. Hub serves its `dist/` in prod.
- ⬜ Phase 5: `skill/SKILL.md` + `AGENTS.md` + per-agent mcp-config snippets; reach 4-brand MVP demo.
- ⬜ Phase 6: README + MIT LICENSE + polish.
