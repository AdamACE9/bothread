import { describe, expect, it } from "vitest";
import { buildPatch, listHunks, parseDiff } from "../src/engine/diffHunks";

const SAMPLE = `diff --git a/app.js b/app.js
index 1111111..2222222 100644
--- a/app.js
+++ b/app.js
@@ -1,3 +1,3 @@
 a1
-a2
+A2
 a3
@@ -9,3 +9,3 @@
 a9
-a10
+A10
 a11
diff --git a/util.js b/util.js
index 3333333..4444444 100644
--- a/util.js
+++ b/util.js
@@ -1,1 +1,1 @@
-old
+new
`;

describe("parseDiff", () => {
  it("splits into files and hunks with stable ids", () => {
    const files = parseDiff(SAMPLE);
    expect(files.length).toBe(2);
    expect(files[0]!.file).toBe("app.js");
    expect(files[0]!.hunks.map((h) => h.id)).toEqual(["f0h0", "f0h1"]);
    expect(files[1]!.file).toBe("util.js");
    expect(files[1]!.hunks.map((h) => h.id)).toEqual(["f1h0"]);
  });

  it("counts additions and deletions per hunk", () => {
    const hunks = listHunks(SAMPLE);
    expect(hunks.length).toBe(3);
    expect(hunks[0]!.additions).toBe(1);
    expect(hunks[0]!.deletions).toBe(1);
  });
});

describe("buildPatch", () => {
  it("rebuilds a patch with only the selected hunks, keeping file headers", () => {
    const patch = buildPatch(SAMPLE, new Set(["f0h1"]));
    expect(patch).toContain("diff --git a/app.js b/app.js");
    expect(patch).toContain("+A10");
    expect(patch).not.toContain("+A2"); // f0h0 excluded
    expect(patch).not.toContain("util.js"); // file with no selected hunk omitted
    expect(patch.endsWith("\n")).toBe(true);
  });

  it("returns empty string when nothing is selected", () => {
    expect(buildPatch(SAMPLE, new Set())).toBe("");
  });

  it("includes a whole file when all its hunks are selected", () => {
    const patch = buildPatch(SAMPLE, new Set(["f0h0", "f0h1"]));
    expect(patch).toContain("+A2");
    expect(patch).toContain("+A10");
  });
});
