import type { Element, Root, RootContent } from "hast";
import type { RenderedDeletion } from "../shared/types";

export function deletionAnnotations(deletions: RenderedDeletion[], baseLine: number) {
  return () => (tree: Root) => {
    const pending = [...deletions].sort((a, b) => (a.beforeLine ?? Infinity) - (b.beforeLine ?? Infinity));
    const output: RootContent[] = [];
    const insert = (until: number) => {
      const next = pending.findIndex((deletion) => (deletion.beforeLine ?? Infinity) > until);
      const groups = pending.splice(0, next < 0 ? pending.length : next);
      const element = (tagName: string, className: string, children: Element["children"]): Element =>
        ({ type: "element", tagName, properties: { className: [className] }, children });
      for (const group of groups) output.push(element("aside", "rendered-deletions", [
        element("span", "eyebrow", [{ type: "text", value: "Deleted since baseline" }]),
        ...group.lines.map((line) => element("div", "change-deleted", [element("code", "", [{ type: "text", value: line.text || " " }])])),
      ]));
    };
    for (const node of tree.children) {
      if (node.type === "element" && node.position) insert(baseLine + node.position.end.line - 1);
      output.push(node);
    }
    insert(Infinity);
    tree.children = output;
  };
}

export interface SelectionBookmark { sourceStart: string; start: number; end: number }

export function bookmarkSelection(target: HTMLElement, range: Range): SelectionBookmark {
  const prefix = range.cloneRange();
  prefix.selectNodeContents(target);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  return { sourceStart: target.dataset.sourceStart!, start, end: start + range.toString().length };
}

export function restoreSelection(bookmark: SelectionBookmark): Range | undefined {
  const target = document.querySelector(`.reader [data-source-start="${bookmark.sourceStart}"]`);
  if (!target) return;
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const end = offset + node.textContent!.length;
    if (!started && bookmark.start <= end) { range.setStart(node, bookmark.start - offset); started = true; }
    if (started && bookmark.end <= end) { range.setEnd(node, bookmark.end - offset); return range; }
    offset = end;
  }
}
