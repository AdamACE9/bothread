import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const EVENT_TYPES = ["package_installed", "bothread_start", "room_created"] as const;
const PLATFORMS = ["windows", "mac", "linux", "other"] as const;
const CHANNELS = ["npx", "global", "dev-clone", "other"] as const;

function admin() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");
    initializeApp({ credential: cert(JSON.parse(raw)) });
  }
  return getFirestore();
}

function emptyCounter<T extends readonly string[]>(keys: T): Record<T[number], number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<T[number], number>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const password = (req.body ?? {})["password"];
  if (typeof password !== "string" || password !== process.env.ADMIN_DASHBOARD_PASSWORD) {
    res.status(401).json({ error: "wrong password" });
    return;
  }

  try {
    const db = admin();
    // Small dataset for now; a straight fetch + in-memory aggregation is
    // plenty fast. 20k is a generous ceiling before this needs pagination.
    const snap = await db.collection("telemetry").orderBy("ts", "desc").limit(20000).get();

    const totals = emptyCounter(EVENT_TYPES);
    const byPlatform = emptyCounter(PLATFORMS);
    const byChannel = emptyCounter(CHANNELS);
    const byDay: Record<string, Record<(typeof EVENT_TYPES)[number], number>> = {};
    const byHourUtc: number[] = Array.from({ length: 24 }, () => 0);

    let oldest: Date | undefined;
    let newest: Date | undefined;

    snap.forEach((doc) => {
      const d = doc.data();
      const event = d.event as (typeof EVENT_TYPES)[number];
      const platform = (d.platform as (typeof PLATFORMS)[number]) ?? "other";
      const channel = (d.channel as (typeof CHANNELS)[number]) ?? "other";
      const ts = d.ts?.toDate ? (d.ts.toDate() as Date) : undefined;
      if (!event || !EVENT_TYPES.includes(event) || !ts) return;

      totals[event] += 1;
      if (platform in byPlatform) byPlatform[platform] += 1;
      if (channel in byChannel) byChannel[channel] += 1;
      byHourUtc[ts.getUTCHours()] += 1;

      const day = ts.toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = emptyCounter(EVENT_TYPES);
      byDay[day][event] += 1;

      if (!oldest || ts < oldest) oldest = ts;
      if (!newest || ts > newest) newest = ts;
    });

    const byDayArray = Object.entries(byDay)
      .map(([date, counts]) => ({ date, ...counts }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.status(200).json({
      totals,
      byPlatform,
      byChannel,
      byDayUtc: byDayArray,
      byHourUtc,
      sampleSize: snap.size,
      oldestEvent: oldest?.toISOString() ?? null,
      newestEvent: newest?.toISOString() ?? null,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
