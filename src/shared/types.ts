export interface SourceRange {
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

export interface CourseHeading extends SourceRange {
  id: string;
  depth: number;
  text: string;
  sectionId: string;
}

export interface CourseSubsection extends SourceRange {
  id: string;
  depth: number;
  title: string;
  leadMarkdown: string;
  children: CourseSubsection[];
}

export interface CourseSection extends SourceRange {
  id: string;
  title: string;
  leadMarkdown: string;
  subsections: CourseSubsection[];
}

export interface CourseDocument {
  title: string;
  sections: CourseSection[];
  headings: CourseHeading[];
}

export interface FileEntry {
  path: string;
}

export interface WorkspaceSummary {
  name: string;
  root: string;
  files: FileEntry[];
  sessionToken: string;
}

export interface LoadedDocument {
  path: string;
  text: string;
  contentHash: string;
  loadedAt: string;
  course: CourseDocument;
}

export interface CommentRecord {
  id: string;
  workspaceId: string;
  filePath: string;
  body: string;
  status: "open" | "resolved";
  originalQuote: string;
  sectionLabel: string;
  sourceStartLine: number;
  sourceEndLine: number;
  sourceStartOffset: number;
  sourceEndOffset: number;
  contentHash: string;
  commitRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommentInput {
  filePath: string;
  body: string;
  originalQuote: string;
  sectionLabel: string;
  sourceStartLine: number;
  sourceEndLine: number;
  sourceStartOffset: number;
  sourceEndOffset: number;
  contentHash: string;
  commitRef: string | null;
}

export interface CommentAnchor {
  state: "attached" | "missing" | "ambiguous";
  startOffset?: number;
  endOffset?: number;
}

export interface FeedbackInput {
  filePath: string;
  overallInstruction: string;
  comments: CommentRecord[];
  anchorStates?: Record<string, CommentAnchor["state"]>;
}

export interface ComparisonResult {
  available: boolean;
  baselineCommit: string | null;
  baselineLabel: string;
  loadedHash: string;
  loadedLabel: string;
  lines: DiffLine[];
  deletions: RenderedDeletion[];
  reason?: string;
}

export interface RenderedDeletion {
  sectionId: string;
  ownerId: string;
  beforeLine: number | null;
  lines: DiffLine[];
}

export interface DiffLine {
  kind: "context" | "added" | "deleted";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface MarkReviewedResult {
  commitId: string;
  reviewedAt: string;
}
