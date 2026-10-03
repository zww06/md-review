import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareDocument, reviewableHead } from "./git";

const cleanup: string[] = [];

afterEach(() => {
  while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8", windowsHide: true }).trim();
}

describe("Git document baselines", () => {
  it("ignores mixed line endings while assigning actual edits to their H2 and H3 owners", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "md-review-git-"));
    cleanup.push(directory);
    git(directory, "init");
    git(directory, "config", "core.autocrlf", "false");
    git(directory, "config", "user.name", "MD Review Test");
    git(directory, "config", "user.email", "md-review@example.invalid");
    const before = "# Guide\n\n## Alpha\n\nOld alpha.\n\n### Detail\n\nOld detail.\n\n## Beta\n\nOld beta.\n";
    writeFileSync(path.join(directory, "guide.md"), before, "utf8");
    git(directory, "add", "guide.md");
    git(directory, "commit", "-m", "baseline");
    const mixed = before.split("\n").map((line, index, all) => line + (index % 2 && index < all.length - 1 ? "\r" : "")).join("\n");
    const unchanged = await compareDocument(directory, "guide.md", mixed);
    expect(unchanged.available).toBe(true);
    expect(unchanged.lines).toEqual([]);
    expect(unchanged.deletions).toEqual([]);
    const loaded = mixed.replaceAll("Old", "New");
    const comparison = await compareDocument(directory, "guide.md", loaded);
    expect(comparison.available).toBe(true);
    expect(comparison.deletions.map(({ sectionId, ownerId, beforeLine }) => ({ sectionId, ownerId, beforeLine }))).toEqual([
      { sectionId: "alpha", ownerId: "alpha", beforeLine: 5 },
      { sectionId: "alpha", ownerId: "detail", beforeLine: 9 },
      { sectionId: "beta", ownerId: "beta", beforeLine: 13 },
    ]);
    expect(comparison.lines.filter((line) => line.kind === "deleted").map((line) => line.text)).toEqual(["Old alpha.", "Old detail.", "Old beta."]);
    expect(comparison.loadedHash).toBe(createHash("sha256").update(loaded).digest("hex"));
  });

  it("keeps commit A fixed across commit B and an uncommitted loaded edit", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "md-review-git-"));
    cleanup.push(directory);
    git(directory, "init");
    git(directory, "config", "user.name", "MD Review Test");
    git(directory, "config", "user.email", "md-review@example.invalid");

    writeFileSync(path.join(directory, "guide.md"), "# Guide\n\nVersion A\n", "utf8");
    git(directory, "add", "guide.md");
    git(directory, "commit", "-m", "commit A");
    const commitA = git(directory, "rev-parse", "HEAD");

    writeFileSync(path.join(directory, "guide.md"), "# Guide\n\nVersion B\n", "utf8");
    git(directory, "add", "guide.md");
    git(directory, "commit", "-m", "commit B");
    const commitB = git(directory, "rev-parse", "HEAD");
    const loaded = "# Guide\n\nVersion B\n\nUncommitted note\n";
    writeFileSync(path.join(directory, "guide.md"), loaded, "utf8");

    const comparison = await compareDocument(directory, "guide.md", loaded, commitA);
    expect(comparison).toMatchObject({ available: true, baselineCommit: commitA, baselineLabel: "Last reviewed commit" });
    expect(comparison.lines.some((line) => line.kind === "deleted" && line.text === "Version A")).toBe(true);
    expect(comparison.lines.some((line) => line.kind === "added" && line.text === "Version B")).toBe(true);
    expect(comparison.lines.some((line) => line.kind === "added" && line.text === "Uncommitted note")).toBe(true);
    await expect(reviewableHead(directory, "guide.md", createHash("sha256").update(loaded).digest("hex")))
      .rejects.toThrow("uncommitted changes");

    writeFileSync(path.join(directory, "guide.md"), "# Guide\n\nVersion B\n", "utf8");
    const committedHash = createHash("sha256").update("# Guide\n\nVersion B\n").digest("hex");
    await expect(reviewableHead(directory, "guide.md", committedHash)).resolves.toBe(commitB);
  });
});
