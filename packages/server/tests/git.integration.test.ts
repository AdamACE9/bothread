import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database";
import { Engine } from "../src/engine/engine";
import { RoomBus } from "../src/realtime";

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

let repoDir: string;

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bothread-git-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@bothread.local"]);
  git(dir, ["config", "user.name", "Bothread Test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["config", "core.autocrlf", "false"]); // keep EOLs deterministic on Windows
  fs.writeFileSync(path.join(dir, "app.js"), "const x = 1;\n");
  fs.writeFileSync(path.join(dir, "README.md"), "# Project\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "initial"]);
  return dir;
}

function makeEngine() {
  const db = openDatabase(":memory:");
  return new Engine(db, new RoomBus());
}

describe("Git micro-branching (integration)", () => {
  beforeEach(() => {
    repoDir = makeRepo();
  });
  afterEach(() => {
    try {
      fs.rmSync(repoDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("captures an agent's diff on release and exposes it as a ready branch", () => {
    const engine = makeEngine();
    const { sessionId } = engine.createRoom({ name: "feat", projectPath: repoDir });
    engine.joinSession("mcp-A", { sessionId, agentName: "Claude Code", brand: "claude" });
    const a = engine.resolveCaller("mcp-A");

    // Claim → tracking entry created.
    const claim = engine.claimFiles(a, { paths: ["app.js"] });
    expect(claim.granted).toBe(true);

    // Agent edits the file on disk.
    fs.writeFileSync(path.join(repoDir, "app.js"), "const x = 1;\nconst y = 2;\n");

    // Release → diff captured, branch ready.
    engine.releaseFiles(a, { paths: ["app.js"] });

    const branches = engine.listBranches(a.room.id);
    expect(branches.length).toBe(1);
    const b = branches[0]!;
    expect(b.status).toBe("ready");
    expect(b.participantName).toBe("Claude Code");
    expect(b.diff).toBeTruthy();
    expect(b.diff).toContain("const y = 2;");
    expect(b.commitSha).toBeTruthy();
    // A bothread/ tracking branch ref now exists.
    const refs = git(repoDir, ["branch", "--list", "bothread/*"]);
    expect(refs).toContain("bothread/");
  });

  it("merge commits the agent's change to git history", () => {
    const engine = makeEngine();
    const { sessionId } = engine.createRoom({ name: "feat", projectPath: repoDir });
    engine.joinSession("mcp-A", { sessionId, agentName: "Cursor", brand: "cursor" });
    const a = engine.resolveCaller("mcp-A");

    engine.claimFiles(a, { paths: ["app.js"] });
    fs.writeFileSync(path.join(repoDir, "app.js"), "const merged = true;\n");
    engine.releaseFiles(a, { paths: ["app.js"] });

    const branch = engine.listBranches(a.room.id)[0]!;
    const before = git(repoDir, ["rev-list", "--count", "HEAD"]);
    const merged = engine.mergeBranch(a.room.id, branch.id);
    expect(merged.status).toBe("merged");

    const after = git(repoDir, ["rev-list", "--count", "HEAD"]);
    expect(Number(after)).toBe(Number(before) + 1);
    // The change is in HEAD now.
    expect(git(repoDir, ["show", "HEAD:app.js"])).toContain("const merged = true;");
    // No longer listed as an open branch.
    expect(engine.listBranches(a.room.id).length).toBe(0);
  });

  it("discard restores the files to their pre-session state", () => {
    const engine = makeEngine();
    const { sessionId } = engine.createRoom({ name: "feat", projectPath: repoDir });
    engine.joinSession("mcp-A", { sessionId, agentName: "Gemini", brand: "gemini" });
    const a = engine.resolveCaller("mcp-A");

    engine.claimFiles(a, { paths: ["app.js"] });
    fs.writeFileSync(path.join(repoDir, "app.js"), "const oops = 'broken';\n");
    engine.releaseFiles(a, { paths: ["app.js"] });

    const branch = engine.listBranches(a.room.id)[0]!;
    const discarded = engine.discardBranch(a.room.id, branch.id);
    expect(discarded.status).toBe("discarded");

    // File on disk restored to the original committed content.
    expect(fs.readFileSync(path.join(repoDir, "app.js"), "utf8")).toBe("const x = 1;\n");
    expect(engine.listBranches(a.room.id).length).toBe(0);
  });

  it("is a no-op (no crash, no branches) when the room has no project path", () => {
    // Deterministic no-op guard: no projectPath → git tracking never engages.
    // (We can't reliably test "a dir outside any repo" here: on machines where the
    //  home dir is itself a git repo, mkdtemp dirs resolve into it.)
    const engine = makeEngine();
    const { sessionId } = engine.createRoom({ name: "plain" });
    engine.joinSession("mcp-A", { sessionId, agentName: "Codex", brand: "codex" });
    const a = engine.resolveCaller("mcp-A");
    engine.claimFiles(a, { paths: ["app.js"] });
    engine.releaseFiles(a, { paths: ["app.js"] });
    expect(engine.listBranches(a.room.id).length).toBe(0);
  });
});
