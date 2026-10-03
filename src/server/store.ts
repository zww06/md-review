import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { CommentInput, CommentRecord, MarkReviewedResult } from "../shared/types.js";

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    canonical_path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
    original_quote TEXT NOT NULL,
    section_label TEXT NOT NULL,
    source_start_line INTEGER NOT NULL,
    source_end_line INTEGER NOT NULL,
    source_start_offset INTEGER NOT NULL,
    source_end_offset INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    commit_ref TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS comments_document
    ON comments(workspace_id, file_path, source_start_offset);

  CREATE TABLE IF NOT EXISTS reviewed_documents (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    commit_id TEXT NOT NULL,
    reviewed_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, file_path)
  );
`;

export function workspaceId(root: string): string {
  return createHash("sha256").update(root.toLocaleLowerCase()).digest("hex").slice(0, 24);
}

function defaultDatabasePath(root: string): string {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "md-review", workspaceId(root), "review.sqlite");
}

export class ReviewStore {
  readonly workspaceId: string;
  readonly databasePath: string;
  private readonly database: Database.Database;

  constructor(root: string, databasePath = defaultDatabasePath(root)) {
    this.workspaceId = workspaceId(root);
    this.databasePath = databasePath;
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.exec(SCHEMA);
    this.database
      .prepare("INSERT OR IGNORE INTO workspaces (id, canonical_path, created_at) VALUES (?, ?, ?)")
      .run(this.workspaceId, root, new Date().toISOString());
  }

  close(): void {
    this.database.close();
  }

  listComments(filePath: string): CommentRecord[] {
    const rows = this.database
      .prepare(`SELECT id, workspace_id, file_path, body, status, original_quote, section_label,
        source_start_line, source_end_line, source_start_offset, source_end_offset, content_hash,
        commit_ref, created_at, updated_at FROM comments
        WHERE workspace_id = ? AND file_path = ? ORDER BY source_start_offset, created_at`)
      .all(this.workspaceId, filePath) as CommentRow[];
    return rows.map(toCommentRecord);
  }

  saveComment(input: CommentInput): CommentRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.database.prepare(`INSERT INTO comments (
      id, workspace_id, file_path, body, status, original_quote, section_label,
      source_start_line, source_end_line, source_start_offset, source_end_offset,
      content_hash, commit_ref, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, this.workspaceId, input.filePath, input.body, input.originalQuote, input.sectionLabel,
      input.sourceStartLine, input.sourceEndLine, input.sourceStartOffset, input.sourceEndOffset,
      input.contentHash, input.commitRef, now, now,
    );
    return this.getComment(id);
  }

  updateComment(id: string, changes: { body?: string; status?: "open" | "resolved" }): CommentRecord | undefined {
    const existing = this.findComment(id);
    if (!existing) return undefined;
    const body = changes.body ?? existing.body;
    const status = changes.status ?? existing.status;
    this.database.prepare(
      "UPDATE comments SET body = ?, status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
    ).run(body, status, new Date().toISOString(), id, this.workspaceId);
    return this.getComment(id);
  }

  deleteComment(id: string): boolean {
    return this.database.prepare("DELETE FROM comments WHERE id = ? AND workspace_id = ?")
      .run(id, this.workspaceId).changes > 0;
  }

  getReviewedCommit(filePath: string): MarkReviewedResult | undefined {
    const row = this.database.prepare(
      "SELECT commit_id, reviewed_at FROM reviewed_documents WHERE workspace_id = ? AND file_path = ?",
    ).get(this.workspaceId, filePath) as { commit_id: string; reviewed_at: string } | undefined;
    return row ? { commitId: row.commit_id, reviewedAt: row.reviewed_at } : undefined;
  }

  markReviewed(filePath: string, commitId: string): MarkReviewedResult {
    const reviewedAt = new Date().toISOString();
    this.database.prepare(`INSERT INTO reviewed_documents (workspace_id, file_path, commit_id, reviewed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id, file_path) DO UPDATE SET commit_id = excluded.commit_id, reviewed_at = excluded.reviewed_at`)
      .run(this.workspaceId, filePath, commitId, reviewedAt);
    return { commitId, reviewedAt };
  }

  private findComment(id: string): CommentRecord | undefined {
    const row = this.database.prepare(`SELECT id, workspace_id, file_path, body, status, original_quote,
      section_label, source_start_line, source_end_line, source_start_offset, source_end_offset,
      content_hash, commit_ref, created_at, updated_at FROM comments WHERE id = ? AND workspace_id = ?`)
      .get(id, this.workspaceId) as CommentRow | undefined;
    return row ? toCommentRecord(row) : undefined;
  }

  private getComment(id: string): CommentRecord {
    const comment = this.findComment(id);
    if (!comment) throw new Error("Saved comment could not be read back.");
    return comment;
  }
}

interface CommentRow {
  id: string;
  workspace_id: string;
  file_path: string;
  body: string;
  status: "open" | "resolved";
  original_quote: string;
  section_label: string;
  source_start_line: number;
  source_end_line: number;
  source_start_offset: number;
  source_end_offset: number;
  content_hash: string;
  commit_ref: string | null;
  created_at: string;
  updated_at: string;
}

function toCommentRecord(row: CommentRow): CommentRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    filePath: row.file_path,
    body: row.body,
    status: row.status,
    originalQuote: row.original_quote,
    sectionLabel: row.section_label,
    sourceStartLine: row.source_start_line,
    sourceEndLine: row.source_end_line,
    sourceStartOffset: row.source_start_offset,
    sourceEndOffset: row.source_end_offset,
    contentHash: row.content_hash,
    commitRef: row.commit_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
