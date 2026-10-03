import { describe, expect, it } from "vitest";
import { parseCourse } from "./markdown";

describe("parseCourse", () => {
  it("preserves introductory content and creates distinct duplicate heading ids", () => {
    const source = `# Course title

Introductory paragraph.

## Read this

First section.

### Detail

One.

### Detail

Two.

\`\`\`md
## Not a heading
\`\`\`
`;

    const course = parseCourse(source, "course.md");

    expect(course.title).toBe("Course title");
    expect(course.sections.map((section) => section.title)).toEqual(["Introduction", "Read this"]);
    expect(course.sections[0].leadMarkdown).toBe("Introductory paragraph.");
    expect(course.sections[1].subsections.map((subsection) => subsection.id)).toEqual(["detail", "detail-2"]);
    expect(course.headings.map((heading) => heading.text)).not.toContain("Not a heading");
    expect(course.sections[1].subsections[1].leadMarkdown).toContain("## Not a heading");
  });

  it("uses the filename and one overview section when headings are absent", () => {
    const course = parseCourse("Plain content only.", "notes/example.markdown");
    expect(course.title).toBe("example");
    expect(course.sections).toHaveLength(1);
    expect(course.sections[0].leadMarkdown).toBe("Plain content only.");
  });

  it("recognizes setext headings", () => {
    const course = parseCourse("Course\n======\n\nPart\n----\n\nText", "setext.md");
    expect(course.title).toBe("Course");
    expect(course.sections.map((section) => section.title)).toEqual(["Part"]);
  });

  it("does not create an empty introduction for hidden HTML comments", () => {
    const course = parseCourse("# Rules\n\n<!-- hidden -->\n\n## First visible section\n\nText", "rules.md");
    expect(course.sections.map((section) => section.title)).toEqual(["First visible section"]);
  });

  it("maps heading boundaries to exact CRLF source offsets", () => {
    const source = "# Course\r\n\r\n## Included features\r\n\r\n### Discovery\r\n\r\nProvide details.\r\n";
    const course = parseCourse(source, "windows.md");

    expect(course.sections[0].leadMarkdown).toBe("");
    expect(course.sections[0].subsections[0].leadMarkdown).toBe("Provide details.");
  });

  it("does not create an H1 letter or phantom introduction around CRLF blank lines", () => {
    const source = "\r\n\r\n# Course title\r\n\r\n## First section\r\n\r\nBody.\r\n";
    const course = parseCourse(source, "windows-h1.md");

    expect(course.title).toBe("Course title");
    expect(course.sections.map((section) => section.title)).toEqual(["First section"]);
    expect(course.sections[0].leadMarkdown).toBe("Body.");
  });
});
