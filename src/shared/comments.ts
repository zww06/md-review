import type { CommentAnchor, CommentRecord, FeedbackInput } from "./types.js";

export function lineAtOffset(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < Math.min(Math.max(0, offset), text.length); index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

export function resolveCommentAnchor(comment: CommentRecord, text: string, contentHash: string): CommentAnchor {
  if (
    comment.contentHash === contentHash &&
    text.slice(comment.sourceStartOffset, comment.sourceEndOffset) === comment.originalQuote
  ) {
    return { state: "attached", startOffset: comment.sourceStartOffset, endOffset: comment.sourceEndOffset };
  }

  if (!comment.originalQuote) return { state: "missing" };
  const first = text.indexOf(comment.originalQuote);
  if (first < 0) return { state: "missing" };
  if (text.indexOf(comment.originalQuote, first + 1) >= 0) return { state: "ambiguous" };
  return { state: "attached", startOffset: first, endOffset: first + comment.originalQuote.length };
}

export function buildFeedback(input: FeedbackInput): string {
  const comments = [...input.comments]
    .filter((comment) => comment.status === "open")
    .sort((left, right) => left.sourceStartOffset - right.sourceStartOffset);
  const header = input.overallInstruction.trim() || "Please address the following review feedback.";
  const items = comments.map((comment, index) => {
    const revision = comment.commitRef ? ` (commit ${comment.commitRef})` : "";
    const anchorState = input.anchorStates?.[comment.id];
    return [
      `## ${index + 1}. ${comment.sectionLabel}`,
      `File: ${comment.filePath}`,
      `Original lines ${comment.sourceStartLine}-${comment.sourceEndLine}${revision}`,
      ...(anchorState && anchorState !== "attached" ? [`Target: Needs review (${anchorState} exact quote in current content)`] : []),
      "",
      "> Quoted source",
      ...comment.originalQuote.split("\n").map((line) => `> ${line}`),
      "",
      "Request:",
      comment.body,
    ].join("\n");
  });
  return [header, ...items].join("\n\n");
}
