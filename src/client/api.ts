import type { CommentInput, CommentRecord, ComparisonResult, LoadedDocument, MarkReviewedResult, WorkspaceSummary } from "../shared/types";

let sessionToken = "";

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const payload = (await response.json()) as T | { error?: string };
  const message = typeof payload === "object" && payload !== null && "error" in payload ? payload.error : undefined;
  if (!response.ok) throw new Error(message || "Request failed.");
  return payload as T;
}

export function loadWorkspace(): Promise<WorkspaceSummary> {
  return request<WorkspaceSummary>("/api/bootstrap").then((workspace) => {
    sessionToken = workspace.sessionToken;
    return workspace;
  });
}

async function mutate<T>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-MD-Review-Token": sessionToken,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json()) as T | { error?: string };
  const message = typeof payload === "object" && payload !== null && "error" in payload ? payload.error : undefined;
  if (!response.ok) throw new Error(message || "Request failed.");
  return payload as T;
}

export function listComments(path: string): Promise<CommentRecord[]> {
  return request<CommentRecord[]>(`/api/comments?path=${encodeURIComponent(path)}`);
}

export function saveComment(input: CommentInput): Promise<CommentRecord> {
  return mutate<CommentRecord>("/api/comments", "POST", input);
}

export function updateComment(id: string, changes: { body?: string; status?: "open" | "resolved" }): Promise<CommentRecord> {
  return mutate<CommentRecord>(`/api/comments/${encodeURIComponent(id)}`, "PATCH", changes);
}

export function deleteComment(id: string): Promise<void> {
  return mutate<void>(`/api/comments/${encodeURIComponent(id)}`, "DELETE");
}

export function compareDocument(filePath: string, loadedText: string): Promise<ComparisonResult> {
  return mutate<ComparisonResult>("/api/compare", "POST", { filePath, loadedText });
}

export function markReviewed(filePath: string, loadedHash: string): Promise<MarkReviewedResult> {
  return mutate<MarkReviewedResult>("/api/mark-reviewed", "POST", { filePath, loadedHash });
}

export function loadDocument(path: string): Promise<LoadedDocument> {
  return request<LoadedDocument>(`/api/document?path=${encodeURIComponent(path)}`);
}

export function localAssetUrl(documentPath: string, assetPath: string): string {
  const query = new URLSearchParams({ document: documentPath, path: assetPath });
  return `/api/asset?${query.toString()}`;
}
