import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { bookmarkSelection, restoreSelection, deletionAnnotations, type SelectionBookmark } from "./annotations";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { buildFeedback, lineAtOffset, resolveCommentAnchor } from "../shared/comments";
import { sourceOffsetAtPoint } from "../shared/markdown";
import type { CommentRecord, ComparisonResult, CourseHeading, CourseSubsection, LoadedDocument, WorkspaceSummary } from "../shared/types";
import { compareDocument as requestComparison, deleteComment as removeComment, listComments, loadDocument, loadWorkspace, localAssetUrl, markReviewed as requestMarkReviewed, saveComment, updateComment } from "./api";

interface TreeNode { name: string; path?: string; children: Map<string, TreeNode> }
interface TargetDraft { quote: string; startOffset: number; endOffset: number; startLine: number; endLine: number; kind: "selection" | "block"; x: number; y: number; body: string }

function buildFileTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: "", children: new Map() };
  for (const filePath of paths) {
    let node = root;
    filePath.split("/").forEach((part, index, parts) => {
      if (!node.children.has(part)) node.children.set(part, { name: part, children: new Map() });
      node = node.children.get(part)!;
      if (index === parts.length - 1) node.path = filePath;
    });
  }
  return root;
}

function FileNodes({ node, selected, onSelect }: { node: TreeNode; selected?: string; onSelect: (path: string) => void }) {
  return <ul className="file-list">{[...node.children.values()].map((child) => <li key={child.path ?? child.name}>
    {child.path ? <button className={child.path === selected ? "is-selected" : ""} onClick={() => onSelect(child.path!)}>{child.name}</button> :
      <details open><summary>{child.name}</summary><FileNodes node={child} selected={selected} onSelect={onSelect} /></details>}
  </li>)}</ul>;
}

function descendantIds(subsection: CourseSubsection): string[] { return [subsection.id, ...subsection.children.flatMap(descendantIds)]; }
function ancestorIds(subsections: CourseSubsection[], target: string, parents: string[] = []): string[] {
  for (const subsection of subsections) {
    if (subsection.id === target) return parents;
    const nested = ancestorIds(subsection.children, target, [...parents, subsection.id]);
    if (nested.length) return nested;
  }
  return [];
}

function positioned(markdown: string, baseOffset: number, position?: { start: { line: number; column: number }; end: { line: number; column: number } }) {
  return {
    "data-source-start": baseOffset + (position ? sourceOffsetAtPoint(markdown, position.start) : 0),
    "data-source-end": baseOffset + (position ? sourceOffsetAtPoint(markdown, position.end) : 0),
  };
}

const draftHighlightName = "md-review-draft-selection";

function setDraftHighlight(range?: Range) {
  if (typeof Highlight === "undefined" || !("highlights" in CSS)) return;
  if (range) CSS.highlights.set(draftHighlightName, new Highlight(range.cloneRange()));
  else CSS.highlights.delete(draftHighlightName);
}

export function Markdown({ children, documentPath, sourceText, startHint, sectionId, ownerId, comparison, attached, changedLines = new Set(), onOpenComment }: {
  children: string; documentPath: string; sourceText: string; startHint: number; sectionId: string; ownerId: string; comparison?: ComparisonResult;
  attached: Array<{ comment: CommentRecord; startOffset: number; endOffset: number }>;
  changedLines?: Set<number>;
  onOpenComment: (comment: CommentRecord, element: HTMLElement) => void;
}) {
  const found = sourceText.indexOf(children, startHint);
  const baseOffset = found >= 0 ? found : startHint;
  const targetProps = (node: { position?: { start: { line: number; column: number }; end: { line: number; column: number } } } | undefined, kind: string) => {
    const range = positioned(children, baseOffset, node?.position);
    const comments = attached.filter(({ startOffset, endOffset }) => startOffset < range["data-source-end"] && endOffset > range["data-source-start"]);
    const startLine = lineAtOffset(sourceText, range["data-source-start"]);
    const endLine = lineAtOffset(sourceText, Math.max(range["data-source-start"], range["data-source-end"] - 1));
    const changed = Array.from({ length: endLine - startLine + 1 }, (_, index) => startLine + index).some((line) => changedLines.has(line));
    return { ...range, "data-target-kind": kind, className: [comments.length ? "comment-highlight" : "", changed ? "change-added" : ""].filter(Boolean).join(" ") || undefined,
      onClick: (event: ReactMouseEvent<HTMLElement>) => comments[0] && window.getSelection()?.isCollapsed && onOpenComment(comments[0].comment, event.currentTarget) };
  };
  const components: Components = {
    p: ({ node, children: content }) => <p {...targetProps(node, "paragraph")}>{content}</p>,
    pre: ({ node, children: content }) => <pre {...targetProps(node, "block")}>{content}</pre>,
    table: ({ node, children: content }) => <table {...targetProps(node, "block")}>{content}</table>,
    blockquote: ({ node, children: content }) => <blockquote {...targetProps(node, "block")}>{content}</blockquote>,
    ul: ({ node, children: content }) => <ul {...targetProps(node, "block")}>{content}</ul>,
    ol: ({ node, children: content }) => <ol {...targetProps(node, "block")}>{content}</ol>,
    img: ({ src, alt }) => !src ? null : /^(?:https?:)?\/\//i.test(src)
      ? <a className="remote-image" href={src} target="_blank" rel="noreferrer">Remote image: {alt || src}</a>
      : <img src={localAssetUrl(documentPath, src)} alt={alt ?? ""} loading="lazy" />,
    a: ({ href, children: label }) => {
      const external = Boolean(href && /^(?:https?:)?\/\//i.test(href));
      return <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{label}</a>;
    },
  };
  const deletions = comparison?.available ? (comparison.deletions ?? []).filter((deletion) => deletion.sectionId === sectionId && deletion.ownerId === ownerId) : [];
  return <ReactMarkdown rehypePlugins={[deletionAnnotations(deletions, lineAtOffset(sourceText, baseOffset))]} remarkPlugins={[remarkGfm]} components={components} skipHtml>{children}</ReactMarkdown>;
}

export function Subsection({ subsection, sectionId, document, openIds, onToggle, attached, changedLines, comparison, onOpenComment }: {
  subsection: CourseSubsection; sectionId: string; document: LoadedDocument; openIds: Set<string>; onToggle: (id: string, open: boolean) => void;
  attached: Array<{ comment: CommentRecord; startOffset: number; endOffset: number }>;
  changedLines: Set<number>; comparison?: ComparisonResult;
  onOpenComment: (comment: CommentRecord, element: HTMLElement) => void;
}) {
  return <details id={subsection.id} className={`subsection depth-${subsection.depth}`} open={openIds.has(subsection.id)} onToggle={(event) => onToggle(subsection.id, event.currentTarget.open)}>
    <summary>{subsection.title}</summary><div className="subsection-content">
      <Markdown documentPath={document.path} sourceText={document.text} startHint={subsection.startOffset} sectionId={sectionId} ownerId={subsection.id} comparison={comparison} attached={attached} changedLines={changedLines} onOpenComment={onOpenComment}>{subsection.leadMarkdown}</Markdown>
      {subsection.children.map((child) => <Subsection key={child.id} subsection={child} sectionId={sectionId} document={document} openIds={openIds} onToggle={onToggle} attached={attached} changedLines={changedLines} comparison={comparison} onOpenComment={onOpenComment} />)}
    </div>
  </details>;
}

function SourceView({ text }: { text: string }) {
  return <ol className="source-lines" aria-label="Exact loaded Markdown source">{text.split("\n").map((line, index) => <li key={index}><code>{line || " "}</code></li>)}</ol>;
}

function ChangesView({ comparison, busy, status, onMarkReviewed }: { comparison?: ComparisonResult; busy: boolean; status: string; onMarkReviewed: () => void }) {
  if (!comparison) return <div className="status" role="status">Loading Git comparison…</div>;
  return <section className="changes-view">
    <header className="changes-header"><div><span className="eyebrow">{comparison.baselineLabel}</span><h1>Changes</h1><p>{comparison.baselineCommit ? comparison.baselineCommit.slice(0, 12) : "No commit"} → {comparison.loadedLabel}</p></div><button className="primary" disabled={busy} onClick={onMarkReviewed}>{busy ? "Checking…" : "Mark reviewed"}</button></header>
    <p className="changes-note">Compared with the exact loaded document. Reload files/content to include newer external edits.</p>
    {status && <p className="copy-status" role="status">{status}</p>}
    {!comparison.available ? <div className="status error"><strong>Comparison unavailable.</strong><span>{comparison.reason}</span></div> : comparison.lines.length === 0 ? <div className="status"><strong>No changes in the loaded document.</strong><span>This does not mark it reviewed.</span></div> :
      <ol className="diff-lines" aria-label="Source line changes">{comparison.lines.map((line, index) => <li key={`${index}-${line.kind}`} className={`change-${line.kind}`}><span className="diff-number">{line.kind === "deleted" ? line.oldLine : line.newLine}</span><code>{line.text || " "}</code></li>)}</ol>}
  </section>;
}

function floatingPosition(rect: DOMRect): { x: number; y: number } {
  const width = Math.min(360, window.innerWidth - 24);
  return { x: Math.max(12, Math.min(rect.right + 12, window.innerWidth - width - 12)), y: Math.max(68, Math.min(rect.top, window.innerHeight - 330)) };
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSummary>();
  const [document, setDocument] = useState<LoadedDocument>();
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>();
  const [sectionId, setSectionId] = useState<string>();
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [comparison, setComparison] = useState<ComparisonResult>();
  const [gitStatus, setGitStatus] = useState("");
  const [gitBusy, setGitBusy] = useState(false);
  const [panel, setPanel] = useState<"comments" | "feedback" | null>(null);
  const [draft, setDraft] = useState<TargetDraft>();
  const [activeComment, setActiveComment] = useState<{ comment: CommentRecord; x: number; y: number }>();
  const [editDraft, setEditDraft] = useState<{ id: string; body: string }>();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [instruction, setInstruction] = useState("Please revise the document to address each request while preserving its intent and structure.");
  const [preview, setPreview] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const draftSelectionBookmark = useRef<SelectionBookmark | null>(null);

  const fileTree = useMemo(() => buildFileTree(workspace?.files.map((file) => file.path) ?? []), [workspace]);
  const sectionIndex = Math.max(0, document?.course.sections.findIndex((item) => item.id === sectionId) ?? 0);
  const section = document?.course.sections[sectionIndex];
  const anchored = useMemo(() => document ? comments.map((comment) => ({ comment, anchor: resolveCommentAnchor(comment, document.text, document.contentHash) })) : [], [comments, document]);
  const attached = anchored.flatMap(({ comment, anchor }) => anchor.state === "attached" ? [{ comment, startOffset: anchor.startOffset!, endOffset: anchor.endOffset! }] : []);
  const changedLines = useMemo(() => new Set(comparison?.available ? comparison.lines.filter((line) => line.kind === "added" && line.newLine !== null).map((line) => line.newLine!) : []), [comparison]);
  const hasUnsavedDraft = Boolean(draft?.body.trim() || (editDraft && editDraft.body !== comments.find((item) => item.id === editDraft.id)?.body));
  useLayoutEffect(() => {
    if (draft && draftSelectionBookmark.current) setDraftHighlight(restoreSelection(draftSelectionBookmark.current));
    else {
      draftSelectionBookmark.current = null;
      setDraftHighlight();
    }
  });

  useEffect(() => () => setDraftHighlight(), []);

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (hasUnsavedDraft) event.preventDefault(); };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [hasUnsavedDraft]);

  function mayDiscardDraft(): boolean { return !hasUnsavedDraft || window.confirm("Discard the unsaved comment draft?"); }

  async function openDocument(filePath: string, force = false) {
    if (!force && filePath !== selectedPath && !mayDiscardDraft()) return;
    setLoading(true); setError(undefined);
    try {
      const [next, nextComments] = await Promise.all([loadDocument(filePath), listComments(filePath)]);
      setDocument(next); setComments(nextComments); setChecked(new Set(nextComments.filter((comment) => comment.status === "open").map((comment) => comment.id)));
      setSelectedPath(filePath); setSectionId(next.course.sections[0]?.id);
      setOpenIds(new Set(next.course.sections.flatMap((item) => item.subsections.flatMap(descendantIds))));
      setSourceOpen(false); setChangesOpen(false); setComparison(undefined); setGitStatus(""); setDraft(undefined); setEditDraft(undefined); setActiveComment(undefined); setPreview("");
      try { setComparison(await requestComparison(next.path, next.text)); }
      catch (cause) {
        setComparison({ available: false, baselineCommit: null, baselineLabel: "Latest commit", loadedHash: next.contentHash, loadedLabel: "Loaded document", lines: [], deletions: [], reason: cause instanceof Error ? cause.message : "Git comparison is unavailable." });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to open the document."); }
    finally { setLoading(false); }
  }

  async function reload() {
    if (!mayDiscardDraft()) return;
    setLoading(true); setError(undefined);
    try {
      const nextWorkspace = await loadWorkspace(); setWorkspace(nextWorkspace);
      const nextPath = nextWorkspace.files.some((file) => file.path === selectedPath) ? selectedPath : nextWorkspace.files[0]?.path;
      if (nextPath) await openDocument(nextPath, true); else { setDocument(undefined); setSelectedPath(undefined); setComments([]); setLoading(false); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to reload the workspace."); setLoading(false); }
  }

  useEffect(() => { void (async () => {
    try { const initialWorkspace = await loadWorkspace(); setWorkspace(initialWorkspace); if (initialWorkspace.files[0]) await openDocument(initialWorkspace.files[0].path, true); else setLoading(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load the workspace."); setLoading(false); }
  })(); }, []);

  function openHeading(heading: CourseHeading) {
    setSectionId(heading.sectionId);
    const targetSection = document?.course.sections.find((item) => item.id === heading.sectionId);
    if (heading.depth >= 3 && targetSection) {
      setOpenIds((current) => new Set([...current, ...ancestorIds(targetSection.subsections, heading.id), heading.id]));
      requestAnimationFrame(() => globalThis.document.getElementById(heading.id)?.scrollIntoView({ block: "start" }));
    }
  }
  function moveSection(offset: number) {
    const next = document?.course.sections[sectionIndex + offset];
    if (next) { setSectionId(next.id); globalThis.document.querySelector(".content-scroll")?.scrollTo({ top: 0, behavior: "smooth" }); }
  }

  function captureSelection() {
    if (!document || sourceOpen) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const origin = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer as Element : range.commonAncestorContainer.parentElement;
    const target = origin?.closest<HTMLElement>("[data-source-start][data-source-end]");
    if (!target || !target.closest(".reader")) return;
    let start = Number(target.dataset.sourceStart); let end = Number(target.dataset.sourceEnd);
    const raw = document.text.slice(start, end); const selected = selection.toString().trim(); let kind: TargetDraft["kind"] = "block";
    if (target.dataset.targetKind === "paragraph" && selected) {
      const found = raw.indexOf(selected);
      if (found >= 0 && raw.indexOf(selected, found + 1) < 0) { start += found; end = start + selected.length; kind = "selection"; }
    }
    if (kind === "block") { const leading = raw.length - raw.trimStart().length; const quote = raw.trim(); start += leading; end = start + quote.length; }
    const quote = document.text.slice(start, end); if (!quote) return;
    draftSelectionBookmark.current = bookmarkSelection(target, range);
    setDraft({ quote, startOffset: start, endOffset: end, startLine: lineAtOffset(document.text, start), endLine: lineAtOffset(document.text, end), kind, ...floatingPosition(range.getBoundingClientRect()), body: "" });
    setActiveComment(undefined);
  }

  function openSavedComment(comment: CommentRecord, element: HTMLElement) { setActiveComment({ comment, ...floatingPosition(element.getBoundingClientRect()) }); setDraft(undefined); }

  async function submitDraft() {
    if (!draft || !document || !section || !draft.body.trim()) return;
    setSaving(true); setError(undefined);
    try {
      const saved = await saveComment({ filePath: document.path, body: draft.body, originalQuote: draft.quote, sectionLabel: section.title, sourceStartLine: draft.startLine, sourceEndLine: draft.endLine, sourceStartOffset: draft.startOffset, sourceEndOffset: draft.endOffset, contentHash: document.contentHash, commitRef: null });
      setComments((current) => [...current, saved].sort((a, b) => a.sourceStartOffset - b.sourceStartOffset)); setChecked((current) => new Set(current).add(saved.id)); setDraft(undefined); window.getSelection()?.removeAllRanges();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save the comment."); }
    finally { setSaving(false); }
  }

  async function patchComment(id: string, changes: { body?: string; status?: "open" | "resolved" }) {
    setSaving(true); setError(undefined);
    try {
      const updated = await updateComment(id, changes); setComments((current) => current.map((item) => item.id === id ? updated : item));
      setActiveComment((current) => current?.comment.id === id ? { ...current, comment: updated } : current); setEditDraft(undefined);
      setChecked((current) => { const next = new Set(current); if (updated.status === "resolved") next.delete(id); else next.add(id); return next; });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update the comment."); }
    finally { setSaving(false); }
  }

  async function deleteComment(id: string) {
    if (!window.confirm("Delete this comment? This cannot be undone.")) return;
    setSaving(true); setError(undefined);
    try { await removeComment(id); setComments((current) => current.filter((item) => item.id !== id)); setActiveComment(undefined); setEditDraft(undefined); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete the comment."); }
    finally { setSaving(false); }
  }

  function rebuildFeedback() {
    if (!document) return;
    setPreview(buildFeedback({
      filePath: document.path,
      overallInstruction: instruction,
      comments: comments.filter((comment) => checked.has(comment.id)),
      anchorStates: Object.fromEntries(anchored.map(({ comment, anchor }) => [comment.id, anchor.state])),
    })); setCopyStatus("");
  }
  async function copyFeedback() {
    try { await navigator.clipboard.writeText(preview); setCopyStatus("Copied to clipboard."); }
    catch { setCopyStatus("Clipboard access failed. Select the preview text and copy it manually."); globalThis.document.querySelector<HTMLTextAreaElement>(".feedback-preview")?.select(); }
  }

  async function showChanges() {
    if (!document) return;
    if (changesOpen) { setChangesOpen(false); return; }
    setChangesOpen(true); setSourceOpen(false); setGitStatus("");
    if (!comparison || comparison.loadedHash !== document.contentHash) setComparison(await requestComparison(document.path, document.text));
  }

  async function markReviewed() {
    if (!document) return;
    setGitBusy(true); setGitStatus("");
    try {
      const result = await requestMarkReviewed(document.path, document.contentHash);
      setComparison(await requestComparison(document.path, document.text));
      setGitStatus(`Reviewed at ${result.commitId.slice(0, 12)}.`);
    } catch (cause) { setGitStatus(cause instanceof Error ? cause.message : "Unable to mark the document reviewed."); }
    finally { setGitBusy(false); }
  }

  const commentList = <div className="comments-list">{anchored.length === 0 ? <p className="empty-note">No comments on this document yet.</p> : anchored.map(({ comment, anchor }) => <article className="comment-card" key={comment.id}>
    <div className="comment-card-meta"><span>{comment.sectionLabel} · lines {comment.sourceStartLine}–{comment.sourceEndLine}</span><span className={`anchor-state ${anchor.state}`}>{anchor.state === "attached" ? comment.status : `${anchor.state}; needs review`}</span></div>
    <blockquote>{comment.originalQuote}</blockquote>
    {editDraft?.id === comment.id ? <textarea value={editDraft.body} onChange={(event) => setEditDraft({ id: comment.id, body: event.target.value })} /> : <p>{comment.body}</p>}
    <div className="comment-actions">{editDraft?.id === comment.id ? <><button className="primary" disabled={saving || !editDraft.body.trim()} onClick={() => void patchComment(comment.id, { body: editDraft.body })}>Save edit</button><button onClick={() => setEditDraft(undefined)}>Cancel</button></> : <button onClick={() => setEditDraft({ id: comment.id, body: comment.body })}>Edit</button>}<button onClick={() => void patchComment(comment.id, { status: comment.status === "open" ? "resolved" : "open" })}>{comment.status === "open" ? "Resolve" : "Reopen"}</button><button className="danger" onClick={() => void deleteComment(comment.id)}>Delete</button></div>
  </article>)}</div>;

  return <div className={`app-shell ${sidebarOpen ? "" : "sidebar-collapsed"} ${panel ? "panel-open" : ""}`}>
    <header className="topbar">
      <button className="icon-button" onClick={() => setSidebarOpen((current) => !current)} aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} aria-expanded={sidebarOpen}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M9 4v16"/></svg></button>
      <div className="document-location"><strong>{document?.course.title ?? workspace?.name ?? "Markdown Review"}</strong>{selectedPath && <span>{selectedPath}</span>}</div>
      <div className="topbar-actions"><button onClick={() => setPanel(panel === "comments" ? null : "comments")} aria-pressed={panel === "comments"} disabled={!document}>Comments {comments.length || ""}</button><button onClick={() => setPanel(panel === "feedback" ? null : "feedback")} aria-pressed={panel === "feedback"} disabled={!document}>Feedback</button><button onClick={() => { setChangesOpen(false); setSourceOpen((current) => !current); }} aria-pressed={sourceOpen && !changesOpen} disabled={!document}>{sourceOpen && !changesOpen ? "Read" : "Source"}</button><button onClick={() => void showChanges()} aria-pressed={changesOpen} disabled={!document}>Changes</button><button onClick={() => void reload()} disabled={loading}>Reload files/content</button></div>
    </header>
    <aside className="sidebar" aria-hidden={!sidebarOpen} inert={!sidebarOpen ? true : undefined}>
      <section><h2>{workspace?.name ?? "Workspace"}</h2><FileNodes node={fileTree} selected={selectedPath} onSelect={(path) => void openDocument(path)} /></section>
      {document && <nav aria-label="Document outline"><h2>On this page</h2><ul className="outline-list">{document.course.headings.filter((heading) => heading.depth >= 2).map((heading) => <li key={heading.id} style={{ "--heading-depth": heading.depth } as CSSProperties}><button className={heading.sectionId === section?.id ? "in-current-section" : ""} onClick={() => openHeading(heading)}>{heading.text}</button></li>)}</ul></nav>}
    </aside>
    <main className="content-scroll" onMouseUp={captureSelection}>
      {loading && !document && <div className="status" role="status">Opening workspace…</div>}
      {error && <div className="status error" role="alert"><strong>Something needs attention.</strong><span>{error}</span></div>}
      {!loading && !error && workspace?.files.length === 0 && <div className="status"><strong>No Markdown files found.</strong><span>Add a .md or .markdown file, then reload.</span></div>}
      {document && changesOpen && <ChangesView comparison={comparison} busy={gitBusy} status={gitStatus} onMarkReviewed={() => void markReviewed()} />}
      {document && !changesOpen && sourceOpen && <SourceView text={document.text} />}
      {document && !changesOpen && !sourceOpen && section && <article className="reader"><div className="section-meta"><span>{sectionIndex + 1} of {document.course.sections.length}</span><span>Lines {section.startLine}–{section.endLine}</span></div><h1>{document.course.title}</h1><h2>{section.title}</h2>
        <Markdown documentPath={document.path} sourceText={document.text} startHint={sectionIndex === 0 ? 0 : section.startOffset} sectionId={section.id} ownerId={section.id} comparison={comparison} attached={attached} changedLines={changedLines} onOpenComment={openSavedComment}>{section.leadMarkdown}</Markdown>
        {section.subsections.map((subsection) => <Subsection key={subsection.id} subsection={subsection} sectionId={section.id} document={document} openIds={openIds} onToggle={(id, open) => setOpenIds((current) => { const next = new Set(current); if (open) next.add(id); else next.delete(id); return next; })} attached={attached} changedLines={changedLines} comparison={comparison} onOpenComment={openSavedComment} />)}
        <nav className="section-navigation" aria-label="Section navigation"><button onClick={() => moveSection(-1)} disabled={sectionIndex === 0}>Previous</button><button onClick={() => moveSection(1)} disabled={sectionIndex === document.course.sections.length - 1}>Next</button></nav></article>}
    </main>
    {panel && <aside className="review-panel" aria-label={panel === "comments" ? "Document comments" : "Feedback builder"}><div className="panel-heading"><div><span className="eyebrow">Current document</span><h2>{panel === "comments" ? "Comments" : "Build feedback"}</h2></div><button className="icon-button" aria-label="Close panel" onClick={() => setPanel(null)}>×</button></div>
      {panel === "comments" ? commentList : <div className="feedback-builder"><label>Overall instruction<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} /></label><fieldset><legend>Include unresolved comments</legend>{comments.filter((comment) => comment.status === "open").map((comment) => <label className="check-row" key={comment.id}><input type="checkbox" checked={checked.has(comment.id)} onChange={(event) => setChecked((current) => { const next = new Set(current); if (event.target.checked) next.add(comment.id); else next.delete(comment.id); return next; })} /><span><strong>{comment.sectionLabel}</strong>{comment.body}</span></label>)}</fieldset><button className="primary" disabled={!comments.some((comment) => comment.status === "open" && checked.has(comment.id))} onClick={rebuildFeedback}>Build preview</button><label>Editable preview<textarea className="feedback-preview" value={preview} onChange={(event) => setPreview(event.target.value)} placeholder="Choose comments and build a preview." /></label><button disabled={!preview} onClick={() => void copyFeedback()}>Copy feedback</button>{copyStatus && <p className="copy-status" role="status">{copyStatus}</p>}</div>}
    </aside>}
    {draft && <aside className="comment-popover" style={{ left: draft.x, top: draft.y }} aria-label="New comment"><span className="eyebrow">{draft.kind === "selection" ? "Selected passage" : `Block fallback · lines ${draft.startLine}–${draft.endLine}`}</span><blockquote>{draft.quote}</blockquote><label>Comment<textarea autoFocus value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label><div className="comment-actions"><button className="primary" disabled={saving || !draft.body.trim()} onClick={() => void submitDraft()}>Save comment</button><button onClick={() => setDraft(undefined)}>Cancel</button></div></aside>}
    {activeComment && <aside className="comment-popover saved" style={{ left: activeComment.x, top: activeComment.y }} aria-label="Saved comment"><span className="eyebrow">{activeComment.comment.status} · {activeComment.comment.sectionLabel}</span><blockquote>{activeComment.comment.originalQuote}</blockquote><p>{activeComment.comment.body}</p><div className="comment-actions"><button onClick={() => void patchComment(activeComment.comment.id, { status: activeComment.comment.status === "open" ? "resolved" : "open" })}>{activeComment.comment.status === "open" ? "Resolve" : "Reopen"}</button><button onClick={() => setActiveComment(undefined)}>Close</button></div></aside>}
  </div>;
}
