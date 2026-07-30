/**
 * Anonymous, opt-out usage telemetry. Fires a handful of counters (which
 * event, which OS, which install channel, package version) to a Firestore
 * collection nobody but the admin dashboard can read. No file paths, no room
 * names/content, no IP capture on our side, no identifiers of any kind.
 *
 * Set BOTHREAD_NO_TELEMETRY=1 to disable entirely. Also a no-op under the test
 * runner (Vitest sets process.env.VITEST) so `npm test` never pollutes real
 * usage data with the dozens of rooms/hub-starts the suite creates.
 */
import os from "node:os";

const PROJECT_ID = "bot-thread";
const ENDPOINT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/telemetry`;

function platformName(): string {
  const p = os.platform();
  if (p === "win32") return "windows";
  if (p === "darwin") return "mac";
  if (p === "linux") return "linux";
  return "other";
}

export type TelemetryEvent = "bothread_start" | "room_created";

export function sendTelemetry(event: TelemetryEvent, extra: Record<string, string | undefined> = {}): void {
  if (process.env.BOTHREAD_NO_TELEMETRY || process.env.VITEST) return;

  const fields: Record<string, unknown> = {
    event: { stringValue: event },
    platform: { stringValue: platformName() },
    ts: { timestampValue: new Date().toISOString() },
  };
  for (const [key, value] of Object.entries(extra)) {
    if (value) fields[key] = { stringValue: value };
  }

  // Fire-and-forget with a short timeout — must never delay or fail startup.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields }),
    signal: controller.signal,
  })
    .catch(() => {})
    .finally(() => clearTimeout(timer));
}
