import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const EVENT_TYPES = ["package_installed", "bothread_start", "room_created"] as const;
const PLATFORMS = ["windows", "mac", "linux", "other"] as const;
const CHANNELS = ["npx", "global", "dev-clone", "local", "other"] as const;

type EventType = (typeof EVENT_TYPES)[number];
type Platform = (typeof PLATFORMS)[number];
type Channel = (typeof CHANNELS)[number];

const GITHUB_REPO = "AdamACE9/bothread";
const NPM_PACKAGE = "bothread";
const DAY_MS = 86_400_000;

function admin() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");
    initializeApp({ credential: cert(JSON.parse(raw)) });
  }
  return getFirestore();
}

const counter = <T extends readonly string[]>(keys: T): Record<T[number], number> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<T[number], number>;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * One row per UTC day, carrying every dimension. The client filters a range by
 * summing rows, so changing the time window never needs another round trip.
 */
interface DayRow {
  date: string;
  events: Record<EventType, number>;
  platforms: Record<Platform, number>;
  channels: Record<Channel, number>;
  versions: Record<string, number>;
  /** Automated (CI/scanner) vs everything else. `unknown` = pre-0.2.5 clients. */
  sources: { ci: number; direct: number; unknown: number };
}

async function telemetryStats(db: FirebaseFirestore.Firestore) {
  const snap = await db.collection("telemetry").orderBy("ts", "desc").limit(20000).get();

  const byDay = new Map<string, DayRow>();
  const byHourUtc = Array.from({ length: 24 }, () => 0);
  let oldest: Date | undefined;
  let newest: Date | undefined;

  const blankRow = (date: string): DayRow => ({
    date,
    events: counter(EVENT_TYPES),
    platforms: counter(PLATFORMS),
    channels: counter(CHANNELS),
    versions: {},
    sources: { ci: 0, direct: 0, unknown: 0 },
  });

  snap.forEach((doc) => {
    const d = doc.data();
    const event = d.event as EventType;
    const ts: Date | undefined = d.ts?.toDate ? d.ts.toDate() : undefined;
    if (!ts || !EVENT_TYPES.includes(event)) return;

    const platform = (PLATFORMS as readonly string[]).includes(d.platform)
      ? (d.platform as Platform)
      : "other";
    const channel = (CHANNELS as readonly string[]).includes(d.channel)
      ? (d.channel as Channel)
      : "other";
    const version = typeof d.version === "string" && d.version ? d.version : "unknown";

    const key = isoDay(ts);
    const row = byDay.get(key) ?? blankRow(key);
    row.events[event] += 1;
    row.platforms[platform] += 1;
    row.channels[channel] += 1;
    row.versions[version] = (row.versions[version] ?? 0) + 1;
    row.sources[typeof d.ci === "boolean" ? (d.ci ? "ci" : "direct") : "unknown"] += 1;
    byDay.set(key, row);

    byHourUtc[ts.getUTCHours()] += 1;
    if (!oldest || ts < oldest) oldest = ts;
    if (!newest || ts > newest) newest = ts;
  });

  // Fill gaps so a sparse series doesn't render as a misleading straight line.
  const days: DayRow[] = [];
  if (oldest && newest) {
    for (let t = Date.parse(isoDay(oldest)); t <= Date.parse(isoDay(newest)); t += DAY_MS) {
      const key = isoDay(new Date(t));
      days.push(byDay.get(key) ?? blankRow(key));
    }
  }

  return {
    days,
    byHourUtc,
    sampleSize: snap.size,
    oldestEvent: oldest?.toISOString() ?? null,
    newestEvent: newest?.toISOString() ?? null,
    truncated: snap.size >= 20000,
  };
}

async function waitlistStats(db: FirebaseFirestore.Firestore) {
  const snap = await db.collection("waitlist").get();
  const entries = snap.docs
    .map((doc) => {
      const d = doc.data();
      return {
        email: d.email as string | undefined,
        source: (d.source as string | undefined) ?? null,
        createdAt: d.createdAt?.toDate ? (d.createdAt.toDate() as Date).toISOString() : null,
      };
    })
    .filter((e) => !!e.email)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return { count: entries.length, entries };
}

/** The feedback collection was being collected but never surfaced anywhere. */
async function feedbackStats(db: FirebaseFirestore.Firestore) {
  const snap = await db.collection("feedback").orderBy("createdAt", "desc").limit(200).get();
  const entries = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      category: (d.category as string | undefined) ?? "other",
      message: typeof d.message === "string" ? d.message.slice(0, 4000) : "",
      email: (d.email as string | null | undefined) ?? null,
      page: (d.page as string | undefined) ?? null,
      createdAt: d.createdAt?.toDate ? (d.createdAt.toDate() as Date).toISOString() : null,
    };
  });
  const byCategory: Record<string, number> = {};
  for (const e of entries) byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
  return { count: entries.length, byCategory, entries };
}

async function githubStats() {
  try {
    const headers = { accept: "application/vnd.github+json", "user-agent": "bothread-admin" };
    const [repoRes, relRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${GITHUB_REPO}`, { headers }),
      fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`, { headers }),
    ]);
    if (repoRes.status === 403) return { error: "rate-limited by GitHub (unauthenticated)" };
    if (!repoRes.ok) return { error: `GitHub API ${repoRes.status}` };
    const d = await repoRes.json();
    const releases = relRes.ok ? await relRes.json() : [];
    return {
      stars: d.stargazers_count as number,
      forks: d.forks_count as number,
      openIssues: d.open_issues_count as number,
      watchers: d.subscribers_count as number,
      createdAt: d.created_at as string,
      pushedAt: d.pushed_at as string,
      defaultBranch: d.default_branch as string,
      license: (d.license?.spdx_id as string) ?? null,
      topics: (d.topics ?? []) as string[],
      releases: (Array.isArray(releases) ? releases : []).slice(0, 5).map((r: any) => ({
        tag: r.tag_name as string,
        publishedAt: r.published_at as string,
      })),
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

async function npmStats() {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 89 * DAY_MS);
    const range = `${isoDay(start)}:${isoDay(end)}`;

    const [rangeRes, weekRes, monthRes, perVersionRes] = await Promise.all([
      fetch(`https://api.npmjs.org/downloads/range/${range}/${NPM_PACKAGE}`),
      fetch(`https://api.npmjs.org/downloads/point/last-week/${NPM_PACKAGE}`),
      fetch(`https://api.npmjs.org/downloads/point/last-month/${NPM_PACKAGE}`),
      fetch(`https://api.npmjs.org/versions/${NPM_PACKAGE}/last-week`),
    ]);

    const rangeJson = rangeRes.ok ? await rangeRes.json() : null;
    const week = weekRes.ok ? await weekRes.json() : null;
    const month = monthRes.ok ? await monthRes.json() : null;
    const perVersion = perVersionRes.ok ? await perVersionRes.json() : null;

    return {
      lastWeek: (week?.downloads as number) ?? null,
      lastMonth: (month?.downloads as number) ?? null,
      byDay: ((rangeJson?.downloads ?? []) as { day: string; downloads: number }[]).map((d) => ({
        day: d.day,
        downloads: d.downloads,
      })),
      byVersionLastWeek: (perVersion?.downloads ?? {}) as Record<string, number>,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
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
    const [telemetry, waitlist, feedback, github, npm] = await Promise.all([
      telemetryStats(db),
      waitlistStats(db),
      feedbackStats(db),
      githubStats(),
      npmStats(),
    ]);

    res.status(200).json({
      telemetry,
      waitlist,
      feedback,
      github,
      npm,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
