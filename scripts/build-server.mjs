#!/usr/bin/env node
/**
 * Bundles the Bothread server (TypeScript) into a single self-contained ESM file.
 * Externals: only better-sqlite3 (native bindings) and fsevents (macOS optional).
 * The banner injects a `require` shim so CJS deps (express/debug/ws) work in ESM.
 */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist-server", { recursive: true });

await build({
  entryPoints: ["packages/server/src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist-server/server.js",
  external: ["better-sqlite3", "fsevents"],
  banner: {
    js: `import { createRequire } from "module"; const require = createRequire(import.meta.url);`,
  },
  logLevel: "info",
});
