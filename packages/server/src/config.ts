import os from "node:os";
import path from "node:path";

export interface HubConfig {
  host: string;
  port: number;
  dbPath: string;
  /** If null, a token is generated at boot and shown in the console/UI. */
  installToken: string | null;
  authRequired: boolean;
  /** Built room-UI dir to serve in production (optional). */
  uiDir?: string;
}

/**
 * Is this host reachable only from this machine?
 *
 * Anything else puts the hub on the network, where "auth off" means
 * unauthenticated. Covers all of 127.0.0.0/8, not just 127.0.0.1.
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h === "::1" || h === "::ffff:127.0.0.1") return true;
  return /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(h);
}

/** Cross-platform per-user data dir for the local hub's SQLite store. */
export function dataDir(): string {
  if (process.env.BOTHREAD_HOME) return process.env.BOTHREAD_HOME;
  const base =
    process.platform === "win32"
      ? process.env.APPDATA ?? os.homedir()
      : path.join(os.homedir(), ".local", "share");
  return path.join(base, "bothread");
}

export function loadConfig(): HubConfig {
  return {
    host: process.env.BOTHREAD_HOST ?? "127.0.0.1",
    port: Number(process.env.BOTHREAD_PORT ?? 4889),
    dbPath: process.env.BOTHREAD_DB ?? path.join(dataDir(), "bothread.sqlite"),
    installToken: process.env.BOTHREAD_TOKEN ?? null,
    // Local hub on 127.0.0.1 → no token by default (simplest, and avoids client
    // header quirks). Opt into a bearer token with BOTHREAD_AUTH=on.
    authRequired: (process.env.BOTHREAD_AUTH ?? "off") === "on",
  };
}
