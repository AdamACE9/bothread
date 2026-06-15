import picomatch from "picomatch";

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function scan(p: string): { base: string; isGlob: boolean } {
  const s = picomatch.scan(p);
  return { base: s.base ?? "", isGlob: Boolean(s.isGlob) };
}

/** True if `child` equals `parent` or sits beneath it (path-segment aware). */
function isPathPrefix(parent: string, child: string): boolean {
  if (parent === "") return true;
  return child === parent || child.startsWith(parent.endsWith("/") ? parent : parent + "/");
}

/**
 * Do two glob/path patterns overlap — i.e. could some real path match both?
 *
 * Ported from mcp_agent_mail's conflict idea but made robust with picomatch.
 * Deliberately a touch *conservative* (prefers flagging a maybe-conflict) since
 * the whole point is preventing collisions — a false "you can't both have this"
 * is safer than two agents silently editing the same file.
 *
 * Handles the demo case exactly: claiming `src/payments/webhook.ts` while
 * someone holds `src/payments/*` (or `**`) is detected as a conflict.
 */
export function globsOverlap(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;

  try {
    if (picomatch(na, { dot: true })(nb)) return true;
    if (picomatch(nb, { dot: true })(na)) return true;
  } catch {
    /* malformed glob — fall through to base comparison */
  }

  const sa = scan(na);
  const sb = scan(nb);

  // Two concrete (non-glob) distinct paths never overlap.
  if (!sa.isGlob && !sb.isGlob) return false;

  // glob-vs-glob: overlap if one's literal base contains the other's.
  if (sa.isGlob && sb.isGlob) {
    if (isPathPrefix(sa.base, sb.base) || isPathPrefix(sb.base, sa.base)) return true;
  }

  return false;
}

/**
 * Conflict rule between an existing active lease and a requested claim
 * (symmetric). Same participant never conflicts with itself; shared+shared
 * never conflicts; otherwise overlapping paths conflict when either side is
 * exclusive.
 */
export function leasesConflict(
  existing: { participantId: string; pathPattern: string; exclusive: boolean },
  requested: { participantId: string; pathPattern: string; exclusive: boolean }
): boolean {
  if (existing.participantId === requested.participantId) return false;
  if (!existing.exclusive && !requested.exclusive) return false;
  return globsOverlap(existing.pathPattern, requested.pathPattern);
}
