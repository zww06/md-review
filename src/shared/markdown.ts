import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Heading, Root } from "mdast";
import type { CourseDocument, CourseHeading, CourseSection, CourseSubsection } from "./types.js";

interface ParsedHeading {
  depth: number;
  text: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  id: string;
}

interface SourcePoint {
  line: number;
  column: number;
}

/** Map a remark line/column point back into the exact, possibly CRLF, source text. */
export function sourceOffsetAtPoint(text: string, point: SourcePoint): number {
  let offset = 0;
  let line = 1;

  while (line < point.line && offset < text.length) {
    if (text[offset] === "\r") {
      offset += text[offset + 1] === "\n" ? 2 : 1;
      line += 1;
    } else if (text[offset] === "\n") {
      offset += 1;
      line += 1;
    } else {
      offset += 1;
    }
  }

  return Math.min(offset + point.column - 1, text.length);
}

function headingText(node: Heading): string {
  return node.children
    .map((child) => {
      if ("value" in child && typeof child.value === "string") return child.value;
      if (child.type === "image") return child.alt ?? "";
      return "";
    })
    .join("")
    .trim();
}

function slugBase(value: string): string {
  return (
    value
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

function uniqueId(label: string, seen: Map<string, number>): string {
  const base = slugBase(label);
  const count = (seen.get(base) ?? 0) + 1;
  seen.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}

function trimRange(text: string, start: number, end: number, removed?: ParsedHeading): string {
  if (!removed || removed.startOffset < start || removed.endOffset > end) {
    return text.slice(start, end).trim();
  }
  return `${text.slice(start, removed.startOffset)}${text.slice(removed.endOffset, end)}`.trim();
}

function buildSubsections(
  text: string,
  headings: ParsedHeading[],
  rangeEnd: number,
  parentDepth = 2,
): CourseSubsection[] {
  const result: CourseSubsection[] = [];
  let index = 0;

  while (index < headings.length) {
    const heading = headings[index];
    if (heading.depth <= parentDepth) {
      index += 1;
      continue;
    }

    let nextSibling = index + 1;
    while (nextSibling < headings.length && headings[nextSibling].depth > heading.depth) {
      nextSibling += 1;
    }
    const endOffset = nextSibling < headings.length ? headings[nextSibling].startOffset : rangeEnd;
    const childHeadings = headings.slice(index + 1, nextSibling);
    const firstChildOffset = childHeadings[0]?.startOffset ?? endOffset;

    result.push({
      id: heading.id,
      depth: heading.depth,
      title: heading.text,
      startLine: heading.startLine,
      endLine: lineAtOffset(text, endOffset),
      startOffset: heading.startOffset,
      endOffset,
      leadMarkdown: text.slice(heading.endOffset, firstChildOffset).trim(),
      children: buildSubsections(text, childHeadings, endOffset, heading.depth),
    });
    index = nextSibling;
  }

  return result;
}

function lineAtOffset(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < Math.min(offset, text.length); index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

export function parseCourse(text: string, filePath: string): CourseDocument {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(text) as Root;
  const seen = new Map<string, number>();
  const parsedHeadings: ParsedHeading[] = tree.children
    .filter((node): node is Heading => node.type === "heading" && Boolean(node.position))
    .map((node) => {
      const label = headingText(node) || "Untitled";
      return {
        depth: node.depth,
        text: label,
        startLine: node.position!.start.line,
        endLine: node.position!.end.line,
        startOffset: sourceOffsetAtPoint(text, node.position!.start),
        endOffset: sourceOffsetAtPoint(text, node.position!.end),
        id: uniqueId(label, seen),
      };
    });

  const firstH1 = parsedHeadings.find((heading) => heading.depth === 1);
  const fallbackTitle = filePath.split(/[\\/]/).pop()?.replace(/\.(md|markdown)$/i, "") || "Untitled";
  const title = firstH1?.text ?? fallbackTitle;
  const h2s = parsedHeadings.filter((heading) => heading.depth === 2);
  const ranges: Array<{ id: string; title: string; start: number; contentStart: number; end: number }> = [];

  if (h2s.length === 0) {
    ranges.push({ id: "overview", title: "Overview", start: 0, contentStart: 0, end: text.length });
  } else {
    const hasRenderableIntro = tree.children.some(
      (node) =>
        !(
          node.type === "heading" &&
          node.depth === 1 &&
          node.position &&
          sourceOffsetAtPoint(text, node.position.start) === firstH1?.startOffset
        ) &&
        node.type !== "html" &&
        Boolean(node.position && sourceOffsetAtPoint(text, node.position.start) < h2s[0].startOffset),
    );
    if (hasRenderableIntro) {
      ranges.push({ id: "introduction", title: "Introduction", start: 0, contentStart: 0, end: h2s[0].startOffset });
    }
    h2s.forEach((heading, index) => {
      ranges.push({
        id: heading.id,
        title: heading.text,
        start: heading.startOffset,
        contentStart: heading.endOffset,
        end: h2s[index + 1]?.startOffset ?? text.length,
      });
    });
  }

  const sections: CourseSection[] = ranges.map((range) => {
    const nested = parsedHeadings.filter(
      (heading) => heading.depth >= 3 && heading.startOffset >= range.contentStart && heading.startOffset < range.end,
    );
    const firstNested = nested[0]?.startOffset ?? range.end;
    return {
      id: range.id,
      title: range.title,
      startLine: lineAtOffset(text, range.start),
      endLine: lineAtOffset(text, range.end),
      startOffset: range.start,
      endOffset: range.end,
      leadMarkdown: trimRange(text, range.contentStart, firstNested, firstH1),
      subsections: buildSubsections(text, nested, range.end),
    };
  });

  const headings: CourseHeading[] = parsedHeadings.map((heading) => {
    const section =
      sections.find(
        (candidate) => heading.startOffset >= candidate.startOffset && heading.startOffset < candidate.endOffset,
      ) ?? sections[0];
    return { ...heading, sectionId: section?.id ?? "overview" };
  });

  return { title, sections, headings };
}
