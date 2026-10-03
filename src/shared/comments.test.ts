import { describe, expect, it } from "vitest";
import { buildFeedback, resolveCommentAnchor } from "./comments";
import type { CommentRecord } from "./types";

const comment: CommentRecord = {
  id: "comment-1",
  workspaceId: "workspace",
  filePath: "guide.md",
  body: "Clarify this.",
  status: "open",
  originalQuote: "chosen words",
  sectionLabel: "Overview",
  sourceStartLine: 1,
  sourceEndLine: 1,
  sourceStartOffset: 7,
  sourceEndOffset: 19,
  contentHash: "old-hash",
  commitRef: null,
  createdAt: "2026-10-02T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
};

describe("resolveCommentAnchor", () => {
  it("reattaches one exact quote after content changes", () => {
    expect(resolveCommentAnchor(comment, "Moved chosen words here.", "new-hash")).toEqual({
      state: "attached",
      startOffset: 6,
      endOffset: 18,
    });
  });

  it("leaves missing and repeated quotes needing review", () => {
    expect(resolveCommentAnchor(comment, "Nothing matches.", "new-hash").state).toBe("missing");
    expect(resolveCommentAnchor(comment, "chosen words and chosen words", "new-hash").state).toBe("ambiguous");
  });
});

describe("buildFeedback", () => {
  it("orders open comments by source location and labels uncertain targets", () => {
    const later = { ...comment, id: "later", sourceStartOffset: 40, sourceEndOffset: 52, body: "Later" };
    const earlier = { ...comment, id: "earlier", sourceStartOffset: 3, sourceEndOffset: 15, body: "Earlier" };
    const output = buildFeedback({
      filePath: "guide.md",
      overallInstruction: "Revise carefully.",
      comments: [later, earlier],
      anchorStates: { earlier: "missing", later: "attached" },
    });

    expect(output.indexOf("Earlier")).toBeLessThan(output.indexOf("Later"));
    expect(output).toContain("Target: Needs review (missing exact quote in current content)");
    expect(output).toContain("> Quoted source");
    expect(output).toContain("Original lines 1-1");
    expect(output).not.toContain("loaded content");
    expect(output).not.toContain("old-hash");
  });

  it("retains an available commit reference without exposing a loaded-content hash", () => {
    const output = buildFeedback({
      filePath: "guide.md",
      overallInstruction: "",
      comments: [{ ...comment, commitRef: "abc123" }],
    });

    expect(output).toContain("Original lines 1-1 (commit abc123)");
  });
});
