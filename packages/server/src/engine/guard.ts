/**
 * Pure helpers for the commit guard (`Engine.guardCheck`, `bothread guard`).
 *
 * The pre-commit hook reports staged files relative to the git top-level, while
 * rooms store a `projectPath` that may be spelled differently (symlinks, trailing
 * slashes, a different drive-letter case on Windows) or point at a subfolder of
 * the repo. These helpers reconcile the two so a lease pattern (relative to the
 * room's projectPath, exactly as `claim_files` stored it) can be compared to a
 * staged file.
 */
import fs from "node:fs";
import path from "node:path";

const isWin = process.platform === "win32";

/** Canonical, comparable form of a directory: absolute, symlinks resolved, no trailing slash. */
export function canonicalDir(p: string): string {
  let abs = path.resolve(p);
  try {
    abs = fs.realpathSync.native(abs);
  } catch {
    /* missing folder — compare the resolved spelling */
  }
  abs = abs.replace(/[\\/]+$/, "") || abs;
  return isWin ? abs.replace(/\\/g, "/").toLowerCase() : abs;
}

/** Repo-relative, forward-slash form of a path (`./src\\a.ts` → `src/a.ts`). */
export function toPosixRel(p: string): string {
  return p.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}

/**
 * Where does a room's folder sit inside the committing repo?
 * → "" (same folder), "sub/dir" (room is a subfolder of the repo), or null (unrelated).
 */
export function roomPrefixWithin(repoCanon: string, roomProjectPath: string): string | null {
  const roomCanon = canonicalDir(roomProjectPath);
  if (roomCanon === repoCanon) return "";
  const rel = path.relative(repoCanon, roomCanon);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return toPosixRel(rel);
}

/** Staged-file path → the same file relative to the room's folder (null if outside it). */
export function fileInRoom(file: string, prefix: string): string | null {
  if (!prefix) return file;
  const cmpFile = isWin ? file.toLowerCase() : file;
  const cmpPrefix = isWin ? prefix.toLowerCase() : prefix;
  return cmpFile.startsWith(cmpPrefix + "/") ? file.slice(prefix.length + 1) : null;
}

/**
 * A lease pattern as a room-relative pattern. Agents sometimes claim absolute
 * paths; those are made relative to the room folder (or left alone if outside it).
 */
export function leasePatternInRoom(pattern: string, roomProjectPath: string): string {
  if (!path.isAbsolute(pattern) && !/^[a-zA-Z]:[\\/]/.test(pattern)) return toPosixRel(pattern);
  for (const base of [path.resolve(roomProjectPath), canonicalDir(roomProjectPath)]) {
    const rel = path.relative(base, pattern);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return toPosixRel(rel);
  }
  return toPosixRel(pattern);
}

/** Bothread's own scratch folder is never guarded. */
export function isBothreadPath(file: string): boolean {
  return file === ".bothread" || file.startsWith(".bothread/");
}
