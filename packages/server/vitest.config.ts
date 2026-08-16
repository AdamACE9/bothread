import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // This suite is integration-heavy: real HTTP servers, real MCP sessions over
    // the wire, and real `git` subprocesses. Run in parallel on a slow or
    // sync-backed disk (OneDrive, network home dirs), individual tests routinely
    // pass 5s — Vitest's default — and fail as flakes rather than regressions.
    // Generous enough to absorb that, still tight enough to catch a true hang.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
