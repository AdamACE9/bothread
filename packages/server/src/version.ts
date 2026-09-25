import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The published package version, for /api/health and the MCP server handshake.
 *
 * The CLI passes it down as BOTHREAD_VERSION; otherwise walk up from this file
 * to the first package.json named "bothread" (dist-server/ and src/ sit at
 * different depths, so a fixed relative path would be wrong for one of them).
 */
function resolveVersion(): string {
  if (process.env.BOTHREAD_VERSION) return process.env.BOTHREAD_VERSION;
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
      const file = path.join(dir, "package.json");
      if (fs.existsSync(file)) {
        const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as { name?: string; version?: string };
        if (pkg.name === "bothread" && pkg.version) return pkg.version;
      }
      dir = path.dirname(dir);
    }
  } catch {
    /* fall through */
  }
  return "0.0.0-dev";
}

export const VERSION = resolveVersion();
