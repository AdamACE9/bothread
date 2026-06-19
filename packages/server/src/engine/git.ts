/**
 * Thin synchronous wrapper around git CLI for Bothread's micro-branching feature.
 * All operations are best-effort: if git isn't installed, the room isn't a repo,
 * or any command fails, we return a safe fallback rather than crashing the hub.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function runGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: env ?? process.env,
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
 * Returns a unified diff of `paths` (glob patterns or literal paths) between
 * `baseSha` and the current working tree, or an empty string on failure.
 */
export function diffWorkingTree(dir: string, baseSha: string, paths: string[]): string {
  if (!paths.length) return "";
  try {
    // --diff-filter=ACM: Added, Copied, Modified (skip deletions of unrelated files)
    return runGit(dir, ["diff", baseSha, "--", ...paths]);
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
 * Restore `paths` to their state at `sha` in the working tree (the human's
 * "discard this" action).  Returns true on success.
 */
export function restoreFilesToSha(dir: string, sha: string, paths: string[]): boolean {
  if (!paths.length) return false;
  try {
    runGit(dir, ["checkout", sha, "--", ...paths]);
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
