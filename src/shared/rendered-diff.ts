import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";
import { parseCourse, sourceOffsetAtPoint } from "./markdown.js";
import type { CourseSection, CourseSubsection, DiffLine, RenderedDeletion } from "./types.js";

interface Block { type: string; text: string; startLine: number; endLine: number }
interface Owner {
  id: string;
  sectionId: string;
  title: string;
  depth: number;
  heading?: Block;
  blocks: Block[];
  children: Owner[];
}

function owners(text: string): Owner[] {
  const course = parseCourse(text, "document.md");
  const tree = unified().use(remarkParse).use(remarkGfm).parse(text) as Root;
  const blocks = tree.children.filter((node) => node.position).map((node) => ({
    type: node.type,
    text: text.slice(sourceOffsetAtPoint(text, node.position!.start), sourceOffsetAtPoint(text, node.position!.end)).replace(/\r\n/g, "\n"),
    startLine: node.position!.start.line,
    endLine: node.position!.end.line,
    offset: sourceOffsetAtPoint(text, node.position!.start),
  }));
  const firstTitle = course.headings.find((heading) => heading.depth === 1);
  const build = (item: CourseSection | CourseSubsection, sectionId: string): Owner => {
    const children = "subsections" in item ? item.subsections : item.children;
    const end = children[0]?.startOffset ?? item.endOffset;
    const heading = course.headings.find((candidate) => candidate.id === item.id && candidate.depth >= 2);
    return {
      id: item.id, sectionId, title: item.title, depth: heading?.depth ?? 0,
      heading: heading ? blocks.find((block) => block.offset === heading.startOffset) : undefined,
      blocks: blocks.filter((block) => block.offset >= item.startOffset && block.offset < end && block.offset !== heading?.startOffset && block.offset !== firstTitle?.startOffset),
      children: children.map((child) => build(child, sectionId)),
    };
  };
  return course.sections.map((section) => build(section, section.id));
}

function matchingPairs<T>(before: T[], after: T[], equal: (a: T, b: T) => boolean): Array<[number, number]> {
  const lengths = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let old = before.length - 1; old >= 0; old--) {
    for (let next = after.length - 1; next >= 0; next--) {
      lengths[old][next] = equal(before[old], after[next])
        ? lengths[old + 1][next + 1] + 1 : Math.max(lengths[old + 1][next], lengths[old][next + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let old = 0; let next = 0;
  while (old < before.length && next < after.length) {
    if (equal(before[old], after[next])) { pairs.push([old++, next++]); }
    else if (lengths[old + 1][next] >= lengths[old][next + 1]) old++;
    else next++;
  }
  return pairs;
}

export function placeDeletions(before: string, after: string, lines: DiffLine[]): RenderedDeletion[] {
  const deleted = lines.filter((line) => line.kind === "deleted");
  if (!deleted.length) return [];
  const oldRuns = new Map<number, number>();
  const newRuns = new Map<number, number>();
  let run = 0;
  for (const line of lines) {
    if (line.kind === "context") run++;
    else if (line.kind === "deleted" && line.oldLine !== null) oldRuns.set(line.oldLine, run);
    else if (line.kind === "added" && line.newLine !== null) newRuns.set(line.newLine, run);
  }
  const removed = (block: Block) => deleted.filter((line) => line.oldLine! >= block.startLine && line.oldLine! <= block.endLine);
  const added = (block: Block) => lines.some((line) => line.kind === "added" && line.newLine! >= block.startLine && line.newLine! <= block.endLine);
  const result: RenderedDeletion[] = [];
  const emit = (owner: Owner, block: Block, beforeLine: number | null) => {
    const lines = removed(block);
    if (lines.length) result.push({ sectionId: owner.sectionId, ownerId: owner.id, beforeLine, lines });
  };
  const placeBlocks = (old: Owner, next: Owner) => {
    if (old.heading && next.heading && old.heading.text !== next.heading.text) emit(next, old.heading, next.blocks[0]?.startLine ?? null);
    const exact = matchingPairs(old.blocks, next.blocks, (a, b) => a.type === b.type && a.text === b.text);
    let oldStart = 0; let newStart = 0;
    for (const [oldEnd, newEnd] of [...exact, [old.blocks.length, next.blocks.length]]) {
      let candidate = newStart;
      for (let index = oldStart; index < oldEnd; index++) {
        const block = old.blocks[index];
        if (!removed(block).length) continue;
        let replacement = candidate;
        while (replacement < newEnd && (next.blocks[replacement].type !== block.type || !added(next.blocks[replacement]))) replacement++;
        if (replacement < newEnd) {
          emit(next, block, next.blocks[replacement].startLine);
          candidate = replacement + 1;
        } else emit(next, block, next.blocks[newEnd]?.startLine ?? null);
      }
      oldStart = oldEnd + 1; newStart = newEnd + 1;
    }
  };
  const matchOwners = (old: Owner[], next: Owner[]) => {
    const exact = matchingPairs(old, next, (a, b) => a.depth === b.depth && a.title === b.title);
    const pairs = [...exact];
    let oldStart = 0; let newStart = 0;
    for (const [oldEnd, newEnd] of [...exact, [old.length, next.length]]) {
      if (oldEnd - oldStart === 1 && newEnd - newStart === 1) {
        const a = old[oldStart]; const b = next[newStart];
        const oldRun = a.heading && oldRuns.get(a.heading.startLine);
        const newRun = b.heading && newRuns.get(b.heading.startLine);
        if (a.depth === b.depth && oldRun !== undefined && oldRun === newRun) pairs.push([oldStart, newStart]);
      }
      oldStart = oldEnd + 1; newStart = newEnd + 1;
    }
    for (const [a, b] of pairs.sort((a, b) => a[0] - b[0])) {
      placeBlocks(old[a], next[b]);
      matchOwners(old[a].children, next[b].children);
    }
  };
  matchOwners(owners(before), owners(after));
  return result;
}
