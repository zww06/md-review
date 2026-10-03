import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewStore } from "./store";

const cleanup: string[] = [];

afterEach(() => {
  while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

describe("ReviewStore", () => {
  it("opens SQLite, creates the schema, and writes the workspace row", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "md-review-store-"));
    cleanup.push(directory);
    const databasePath = path.join(directory, "review.sqlite");
    const store = new ReviewStore("C:\\example\\workspace", databasePath);

    expect(store.workspaceId).toHaveLength(24);
    store.close();
    expect(existsSync(databasePath)).toBe(true);
  });

  it("saves, lists, edits, resolves, reopens, and deletes comments", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "md-review-store-"));
    cleanup.push(directory);
    const store = new ReviewStore("C:\\example\\workspace", path.join(directory, "review.sqlite"));
    const saved = store.saveComment({
      filePath: "guide.md",
      body: "First request",
      originalQuote: "Original words",
      sectionLabel: "Overview",
      sourceStartLine: 3,
      sourceEndLine: 3,
      sourceStartOffset: 12,
      sourceEndOffset: 26,
      contentHash: "hash",
      commitRef: null,
    });

    expect(store.listComments("guide.md")).toHaveLength(1);
    expect(store.updateComment(saved.id, { body: "Edited", status: "resolved" })).toMatchObject({
      body: "Edited",
      status: "resolved",
      originalQuote: "Original words",
    });
    expect(store.updateComment(saved.id, { status: "open" })?.status).toBe("open");
    expect(store.deleteComment(saved.id)).toBe(true);
    expect(store.listComments("guide.md")).toEqual([]);
    store.close();
  });

  it("persists and replaces a reviewed commit per document", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "md-review-store-"));
    cleanup.push(directory);
    const store = new ReviewStore("C:\\example\\workspace", path.join(directory, "review.sqlite"));

    expect(store.getReviewedCommit("guide.md")).toBeUndefined();
    expect(store.markReviewed("guide.md", "a".repeat(40))).toMatchObject({ commitId: "a".repeat(40) });
    expect(store.getReviewedCommit("guide.md")).toMatchObject({ commitId: "a".repeat(40) });
    store.markReviewed("guide.md", "b".repeat(40));
    expect(store.getReviewedCommit("guide.md")).toMatchObject({ commitId: "b".repeat(40) });
    store.close();
  });
});
