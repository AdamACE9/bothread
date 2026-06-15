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
