import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { deletionAnnotations } from "./annotations";
import type { RenderedDeletion } from "../shared/types";
import type { ComparisonResult, DiffLine, LoadedDocument } from "../shared/types";
import { parseCourse } from "../shared/markdown";
import { placeDeletions } from "../shared/rendered-diff";
import { Markdown, Subsection } from "./App";

function render(markdown: string, lines: RenderedDeletion[], baseLine = 1) {
  return renderToStaticMarkup(<ReactMarkdown rehypePlugins={[deletionAnnotations(lines, baseLine)]}>{markdown}</ReactMarkdown>);
}

const deleted = (text: string, newLine: number): RenderedDeletion => ({ sectionId: "test", ownerId: "test", beforeLine: newLine, lines: [{ kind: "deleted", text, newLine, oldLine: 7 }] });

describe("rendered deletion placement", () => {
  it("keeps unchanged paragraphs before the deletion and its replacement", () => {
    const html = render("Unchanged paragraph.\n\nReplacement paragraph.", [deleted("Old paragraph.", 7)], 5);
    expect(html.indexOf("Unchanged paragraph.")).toBeLessThan(html.indexOf("Deleted since baseline"));
    expect(html.indexOf("Old paragraph.")).toBeLessThan(html.indexOf("<p>Replacement paragraph."));
    expect(html.match(/rendered-deletions/g)).toHaveLength(1);
  });

  it("places separate deletions at their own blocks and retains trailing deletions", () => {
    const html = render("First.\n\nSecond.", [deleted("Before first", 1), deleted("Before second", 3), deleted("At end", 4)]);
    expect(html.indexOf("Before first")).toBeLessThan(html.indexOf("<p>First."));
    expect(html.indexOf("<p>First.")).toBeLessThan(html.indexOf("Before second"));
    expect(html.indexOf("Before second")).toBeLessThan(html.indexOf("<p>Second."));
    expect(html.indexOf("<p>Second.")).toBeLessThan(html.indexOf("At end"));
    expect(html.match(/rendered-deletions/g)).toHaveLength(3);
  });

  it("keeps multiline blocks intact and treats deleted HTML as source text", () => {
    const html = render("First line\nsecond line.", [deleted("<script>bad()</script>", 2)]);
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).toContain("<p>First line\nsecond line.</p>");
    expect(html.indexOf("rendered-deletions")).toBeLessThan(html.indexOf("<p>"));
  });

  it("retains deletions when a heading has no remaining body", () => {
    expect(render("", [deleted("Removed body", 4)], 3)).toContain("Removed body");
  });
});

function replacement(before: string, after: string) {
  const lines: DiffLine[] = [
    ...before.split("\n").map((text, index): DiffLine => ({ kind: "deleted", text, oldLine: index + 1, newLine: 1 })),
    ...after.split("\n").map((text, index): DiffLine => ({ kind: "added", text, oldLine: null, newLine: index + 1 })),
  ];
  const document: LoadedDocument = { path: "guide.md", text: after, contentHash: "test", loadedAt: "test", course: parseCourse(after, "guide.md") };
  const comparison: ComparisonResult = {
    available: true, baselineCommit: "test", baselineLabel: "Latest commit", loadedHash: "test", loadedLabel: "Loaded document",
    lines, deletions: placeDeletions(before, after, lines),
  };
  return { document, comparison };
}

function renderSection(fixture: ReturnType<typeof replacement>, index: number, openIds = new Set<string>()) {
  const { document, comparison } = fixture;
  const section = document.course.sections[index];
  return renderToStaticMarkup(<>
    <Markdown documentPath={document.path} sourceText={document.text} startHint={section.startOffset} sectionId={section.id} ownerId={section.id} comparison={comparison} attached={[]} onOpenComment={() => {}}>{section.leadMarkdown}</Markdown>
    {section.subsections.map((subsection) => <Subsection key={subsection.id} subsection={subsection} sectionId={section.id} document={document} comparison={comparison} attached={[]} changedLines={new Set()} openIds={openIds} onToggle={() => {}} onOpenComment={() => {}} />)}
  </>);
}

describe("deletions in the course reader", () => {
  it("splits a whole-document replacement into paragraphs owned by the selected H2", () => {
    const before = "# Guide\n\n## Alpha\n\nOld alpha one.\n\nOld alpha two.\n\n## Beta\n\nOld beta.";
    const after = before.replaceAll("Old", "New");
    const fixture = replacement(before, after);
    const alpha = renderSection(fixture, 0);
    expect(alpha).toMatch(/Old alpha one\.[\s\S]*?<\/aside>\s*<p[^>]*>New alpha one\./);
    expect(alpha).toMatch(/Old alpha two\.[\s\S]*?<\/aside>\s*<p[^>]*>New alpha two\./);
    expect(alpha.indexOf("New alpha one.")).toBeLessThan(alpha.indexOf("Old alpha two."));
    expect(alpha).not.toContain("Old beta");
    expect(alpha).not.toContain("# Guide");
    const beta = renderSection(fixture, 1);
    expect(beta).toContain("Old beta.");
    expect(beta).not.toContain("Old alpha");
  });

  it("places nested H3–H6 deletions inside their own fold, including repeated heading names", () => {
    const before = "## Alpha\n\nOld lead.\n\n### Details\n\nOld alpha details.\n\n#### Deep\n\nOld deep.\n\n##### Deeper\n\nOld deeper.\n\n###### Deepest\n\nOld deepest.\n\n## Beta\n\n### Details\n\nOld beta details.";
    const fixture = replacement(before, before.replaceAll("Old", "New"));
    const alpha = renderSection(fixture, 0, new Set(["details"]));
    expect(alpha).toMatch(/<details id="details"[^>]*open=""[^>]*>[\s\S]*?Old alpha details\./);
    expect(alpha).toMatch(/<details id="deep"[^>]*><summary>Deep<\/summary>[\s\S]*?Old deep\./);
    expect(alpha.indexOf('id="deep"')).toBeLessThan(alpha.indexOf("Old deep."));
    expect(alpha.indexOf('id="deeper"')).toBeLessThan(alpha.indexOf("Old deeper."));
    expect(alpha.indexOf('id="deepest"')).toBeLessThan(alpha.indexOf("Old deepest."));
    expect(alpha).not.toContain("Old beta");
    const beta = renderSection(fixture, 1);
    expect(beta).toContain('id="details-2"');
    expect(beta).toContain("Old beta details.");
    expect(beta).not.toContain("Old alpha");
    expect(fixture.comparison.deletions.map((item) => item.ownerId)).toEqual(["alpha", "details", "deep", "deeper", "deepest", "details-2"]);
  });

  it("keeps a trailing deletion in its H2 before the next H2 boundary", () => {
    const before = "## Alpha\n\nKeep.\n\nRemoved tail.\n\n## Beta\n\nOther.";
    const fixture = replacement(before, before.replace("\n\nRemoved tail.", ""));
    const alpha = renderSection(fixture, 0);
    expect(alpha.indexOf("<p")).toBeLessThan(alpha.indexOf("Removed tail."));
    expect(fixture.comparison.deletions).toMatchObject([{ ownerId: "alpha", beforeLine: null }]);
    expect(renderSection(fixture, 1)).not.toContain("Removed tail.");
  });

  it("does not attach a wholly deleted subsection to its sibling", () => {
    const before = "## Alpha\n\n### Removed\n\nRemoved body.\n\n### Kept\n\nKeep body.";
    const fixture = replacement(before, "## Alpha\n\n### Kept\n\nKeep body.");
    expect(renderSection(fixture, 0)).not.toContain("Removed body.");
    expect(fixture.comparison.lines.some((line) => line.kind === "deleted" && line.text === "Removed body.")).toBe(true);
  });

  it("keeps duplicate H2 sections separate and pairs a renamed heading within its change run", () => {
    const before = "## Same\n\nOld first.\n\n## Same\n\nOld second.\n\n### Before\n\nOld nested.";
    const fixture = replacement(before, before.replaceAll("Old", "New").replace("### Before", "### After"));
    expect(renderSection(fixture, 0)).not.toContain("Old second.");
    expect(renderSection(fixture, 1)).toContain("Old second.");
    expect(fixture.comparison.deletions.find((item) => item.lines.some((line) => line.text === "Old nested."))).toMatchObject({ sectionId: "same-2", ownerId: "after" });
  });

  it("handles setext headings and ignores heading syntax in fenced code", () => {
    const before = "Alpha\n-----\n\nOld text.\n\n```md\n## Fake heading\nOld code\n```\n\n## Beta\n\nOther.";
    const fixture = replacement(before, before.replaceAll("Old", "New"));
    expect(fixture.comparison.deletions.every((item) => item.ownerId === "alpha")).toBe(true);
    expect(renderSection(fixture, 1)).not.toContain("Old code");
  });
});
