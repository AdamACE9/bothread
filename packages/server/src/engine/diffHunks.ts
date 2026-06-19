/**
 * Minimal unified-diff parser + patch rebuilder for hunk-level review.
 *
 * `git diff` output → a list of files, each with its header lines and hunks.
 * Rebuilding a patch from a subset of hunk ids gives a valid patch `git apply`
 * accepts, because we keep whole hunks verbatim (their @@ counts already match)
 * and re-emit each file's header. This powers "keep these changes, drop those."
 */

export interface DiffHunk {
  /** Stable id within one diff: `f{fileIndex}h{hunkIndex}`. */
  id: string;
  file: string;
  /** The `@@ -a,b +c,d @@ …` header line. */
  header: string;
  /** Full hunk text (the @@ line + body lines). */
  lines: string[];
  additions: number;
  deletions: number;
}

export interface DiffFileView {
  file: string;
  /** Lines from `diff --git` up to (not including) the first `@@`. */
  headerLines: string[];
  binary: boolean;
  hunks: DiffHunk[];
}

export function parseDiff(diff: string): DiffFileView[] {
  const lines = diff.split("\n");
  const files: DiffFileView[] = [];
  let cur: DiffFileView | null = null;
  let curHunk: DiffHunk | null = null;
  let fileIdx = -1;
  let hunkIdx = 0;

  const flushHunk = () => {
    if (cur && curHunk) cur.hunks.push(curHunk);
    curHunk = null;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      flushHunk();
      fileIdx += 1;
      hunkIdx = 0;
      cur = { file: "", headerLines: [line], binary: false, hunks: [] };
      files.push(cur);
    } else if (cur && line.startsWith("@@")) {
      flushHunk();
      curHunk = {
        id: `f${fileIdx}h${hunkIdx}`,
        file: cur.file,
        header: line,
        lines: [line],
        additions: 0,
        deletions: 0,
      };
      hunkIdx += 1;
    } else if (curHunk) {
      curHunk.lines.push(line);
      if (line.startsWith("+")) curHunk.additions += 1;
      else if (line.startsWith("-")) curHunk.deletions += 1;
    } else if (cur) {
      cur.headerLines.push(line);
      if (line.startsWith("+++ ")) {
        const p = line.slice(4).replace(/^b\//, "").trim();
        if (p && p !== "/dev/null") cur.file = p;
      } else if (line.startsWith("--- ") && !cur.file) {
        const p = line.slice(4).replace(/^a\//, "").trim();
        if (p && p !== "/dev/null") cur.file = p;
      } else if (line.startsWith("Binary files")) {
        cur.binary = true;
      }
    }
  }
  flushHunk();
  for (const f of files) for (const h of f.hunks) h.file = f.file;
  return files;
}

/** Flatten to just the reviewable hunks (UI list). */
export function listHunks(diff: string): DiffHunk[] {
  return parseDiff(diff).flatMap((f) => f.hunks);
}

/**
 * Rebuild a patch containing only the selected hunk ids. Files with no selected
 * hunk are omitted entirely (so they stay at their baseline). The result is a
 * valid unified diff for `git apply`.
 */
export function buildPatch(diff: string, selectedIds: Set<string>): string {
  const files = parseDiff(diff);
  const out: string[] = [];
  for (const f of files) {
    const selected = f.hunks.filter((h) => selectedIds.has(h.id));
    if (selected.length === 0) continue;
    out.push(...f.headerLines);
    for (const h of selected) out.push(...h.lines);
  }
  let patch = out.join("\n");
  if (patch.length > 0 && !patch.endsWith("\n")) patch += "\n";
  return patch;
}
