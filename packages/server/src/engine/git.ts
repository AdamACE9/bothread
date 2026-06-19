/**
 * Thin synchronous wrapper around git CLI for Bothread's micro-branching feature.
 * All operations are best-effort: if git isn't installed, the room isn't a repo,
 * or any command fails, we return a safe fallback rather than crashing the hub.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function runGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv, input?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: env ?? process.env,
    input,
  }).trim();
}

/** Returns true if `dir` is inside a git repository. */
export function isGitRepo(dir: string): boolean {
  try {
    runGit(dir, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/** Returns the current HEAD commit SHA, or undefined if not a git repo. */
export function currentSha(dir: string): string | undefined {
  try {
    return runGit(dir, ["rev-parse", "HEAD"]);
  } catch {
    return undefined;
  }
}

/**
 * Snapshot the *current working-tree state* of `paths` as a git tree object,
 * layered over `startRef` (a commit/tree-ish). Returns the tree SHA.
 *
 * This is the claim-time baseline: it captures whatever is on disk for the
 * claimed paths at the moment of the claim — INCLUDING the human's own
 * uncommitted edits — so a later diff/discard is scoped to what the AGENT
 * changed since the claim, and never reverts the human's pre-existing work.
 */
export function snapshotPaths(dir: string, startRef: string, paths: string[]): string | undefined {
  if (!paths.length) return undefined;
  const gitDir = (() => {
    try {
      return runGit(dir, ["rev-parse", "--git-dir"]);
    } catch {
      return path.join(dir, ".git");
    }
  })();
  const tmpIdx = path.join(
    path.isAbsolute(gitDir) ? gitDir : path.join(dir, gitDir),
    `bothread-snap-${Date.now()}.idx`
  );
  try {
    const env = { ...process.env, GIT_INDEX_FILE: tmpIdx };
    runGit(dir, ["read-tree", startRef], env);
    runGit(dir, ["add", "--", ...paths], env);
    return runGit(dir, ["write-tree"], env);
  } catch {
    return undefined;
  } finally {
    try {
      fs.unlinkSync(tmpIdx);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Returns a unified diff of `paths` between `baseRef` (a commit OR tree-ish —
 * we pass the claim-time snapshot tree) and the current working tree, or an
 * empty string on failure.
 */
export function diffWorkingTree(dir: string, baseRef: string, paths: string[]): string {
  if (!paths.length) return "";
  try {
    return runGit(dir, ["diff", baseRef, "--", ...paths]);
  } catch {
    return "";
  }
}

/**
 * Creates a git commit on `branchName` containing only the changes in `paths`
 * relative to `baseSha`, WITHOUT touching the current working tree or HEAD.
 *
 * Uses git plumbing (read-tree + add + write-tree + commit-tree + update-ref)
 * with a temporary index file so the main index is never disturbed.
 *
 * Returns the new commit SHA, or undefined on failure.
 */
export function createBranchCommit(
  dir: string,
  branchName: string,
  baseSha: string,
  paths: string[],
  message: string
): string | undefined {
  if (!paths.length) return undefined;
  const gitDir = (() => {
    try {
      return runGit(dir, ["rev-parse", "--git-dir"]);
    } catch {
      return path.join(dir, ".git");
    }
  })();
  const tmpIdx = path.join(
    path.isAbsolute(gitDir) ? gitDir : path.join(dir, gitDir),
    `bothread-${Date.now()}.idx`
  );
  try {
    const env = { ...process.env, GIT_INDEX_FILE: tmpIdx };
    // Populate temp index from the base commit's tree.
    runGit(dir, ["read-tree", baseSha], env);
    // Stage the agent's current working-tree state for the claimed paths.
    runGit(dir, ["add", "--", ...paths], env);
    // Write a tree object from the temp index.
    const treeSha = runGit(dir, ["write-tree"], env);
    // Check if any files actually changed vs the base.
    let parentDiff = "";
    try {
      parentDiff = runGit(dir, ["diff-tree", "--stat", baseSha, treeSha]);
    } catch {
      parentDiff = "";
    }
    if (!parentDiff) return undefined; // nothing actually changed
    // Create a commit object (doesn't update any ref or working tree).
    const commitSha = runGit(dir, [
      "commit-tree",
      treeSha,
      "-p",
      baseSha,
      "-m",
      message,
    ]);
    // Point the tracking branch at this commit.
    runGit(dir, ["update-ref", `refs/heads/${branchName}`, commitSha]);
    return commitSha;
  } catch {
    return undefined;
  } finally {
    try {
      fs.unlinkSync(tmpIdx);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Commit the agent's working-tree changes for `paths` onto the current branch
 * (the human's "merge this" action). Scoped to exactly `paths` via pathspec, so
 * it never sweeps in unrelated changes the human may have staged elsewhere.
 * Returns true on success.
 */
export function commitToCurrentBranch(dir: string, message: string, paths: string[]): boolean {
  if (!paths.length) return false;
  try {
    // Stage just these paths, then commit only these paths (pathspec-limited).
    runGit(dir, ["add", "--", ...paths]);
    runGit(dir, ["commit", "-m", message, "--", ...paths]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Restore `paths` in the working tree to their state at `treeish` — the
 * claim-time snapshot (the human's "discard this" action). Because the baseline
 * is the snapshot (not HEAD), this restores to what was on disk when the agent
 * claimed, preserving the human's pre-existing uncommitted edits.
 * Returns true on success.
 */
export function restoreFilesToSha(dir: string, treeish: string, paths: string[]): boolean {
  if (!paths.length) return false;
  try {
    runGit(dir, ["checkout", treeish, "--", ...paths]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Partial accept: reset `paths` to the claim-time `baselineTree`, then apply
 * only `patchText` (a unified diff containing the human-selected hunks) on top,
 * and commit. Powers line/hunk-level "keep some, discard the rest" review.
 * If `patchText` is empty, this is a full discard-to-baseline + commit (which
 * commits nothing new — handled by the caller). Returns true on success.
 */
export function applySelectedHunks(
  dir: string,
  baselineTree: string,
  paths: string[],
  patchText: string,
  message: string
): boolean {
  if (!paths.length) return false;
  try {
    // 1) Revert the claimed paths to their claim-time baseline.
    runGit(dir, ["checkout", baselineTree, "--", ...paths]);
    // 2) Re-apply only the selected hunks (exact context → clean apply).
    if (patchText.trim()) {
      runGit(dir, ["apply", "--whitespace=nowarn"], undefined, patchText);
    }
    // 3) Commit exactly these paths.
    runGit(dir, ["add", "--", ...paths]);
    runGit(dir, ["commit", "-m", message, "--", ...paths]);
    return true;
  } catch {
    return false;
  }
}

/** Delete a local tracking branch (best-effort cleanup). */
export function deleteTrackingBranch(dir: string, branchName: string): void {
  try {
    runGit(dir, ["branch", "-D", branchName]);
  } catch {
    /* ignore */
  }
}

/** Sanitize an agent name into a valid git ref component. */
export function sanitizeBranchSegment(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "agent";
}
