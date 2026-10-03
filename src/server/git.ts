import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ComparisonResult, DiffLine } from "../shared/types.js";
import { placeDeletions } from "../shared/rendered-diff.js";
import { resolveInsideWorkspace } from "./workspace.js";

const runFile = promisify(execFile);
const GIT_ENV = { ...process.env, GIT_EXTERNAL_DIFF: "", GIT_PAGER: "cat" };

class GitUnavailableError extends Error {}

async function git(cwd: string, args: string[], allowDifference = false): Promise<string> {
  try {
    const result = await runFile("git", ["-c", "core.autocrlf=false", "-c", "diff.external=", ...args], {
      cwd,
      env: GIT_ENV,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    return result.stdout;
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException & { code?: string | number; stdout?: string; stderr?: string };
    if (allowDifference && Number(error.code) === 1) return error.stdout ?? "";
    if (error.code === "ENOENT") throw new GitUnavailableError("Git is not installed or is not available on PATH.");
    throw new GitUnavailableError((error.stderr || "Git history is unavailable for this document.").trim());
  }
}

async function repositoryContext(workspaceRoot: string, filePath: string) {
  const absolute = resolveInsideWorkspace(workspaceRoot, filePath);
  const workspaceRepository = path.resolve((await git(workspaceRoot, ["rev-parse", "--show-toplevel"])).trim());
  const fileRepository = path.resolve((await git(path.dirname(absolute), ["rev-parse", "--show-toplevel"])).trim());
  if (workspaceRepository.toLocaleLowerCase() !== fileRepository.toLocaleLowerCase()) {
    throw new GitUnavailableError("Comparison is unavailable for files inside a nested Git repository.");
  }
  const relative = path.relative(workspaceRepository, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new GitUnavailableError("The document is outside the workspace Git repository.");
  return { repository: workspaceRepository, relativePath: relative.split(path.sep).join("/") };
}

async function head(repository: string): Promise<string> {
  const commit = (await git(repository, ["rev-parse", "--verify", "HEAD"])).trim();
  if (!/^[0-9a-f]{40,64}$/i.test(commit)) throw new GitUnavailableError("The current Git commit could not be resolved.");
  return commit;
}

async function committedText(repository: string, commitId: string, relativePath: string): Promise<string> {
  if (!/^[0-9a-f]{40,64}$/i.test(commitId)) throw new GitUnavailableError("The saved reviewed commit is invalid.");
  try {
    return await git(repository, ["show", "--no-ext-diff", "--no-textconv", `${commitId}:${relativePath}`]);
  } catch {
    throw new GitUnavailableError("The document or saved commit is unavailable in Git history.");
  }
}

function parseUnifiedDiff(output: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of output.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || raw === "\\ No newline at end of file") continue;
    if (raw.startsWith("+")) lines.push({ kind: "added", text: raw.slice(1), oldLine: null, newLine: newLine++ });
    else if (raw.startsWith("-")) lines.push({ kind: "deleted", text: raw.slice(1), oldLine: oldLine++, newLine });
    else if (raw.startsWith(" ")) lines.push({ kind: "context", text: raw.slice(1), oldLine: oldLine++, newLine: newLine++ });
  }
  return lines;
}

async function diffTexts(repository: string, before: string, after: string): Promise<DiffLine[]> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "md-review-diff-"));
  const beforePath = path.join(directory, "baseline.md");
  const afterPath = path.join(directory, "loaded.md");
  try {
    await Promise.all([writeFile(beforePath, before, "utf8"), writeFile(afterPath, after, "utf8")]);
    const output = await git(repository, ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--ignore-cr-at-eol", "--unified=3", "--", beforePath, afterPath], true);
    return parseUnifiedDiff(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function compareDocument(workspaceRoot: string, filePath: string, loadedText: string, savedBaseline?: string): Promise<ComparisonResult> {
  const loadedHash = createHash("sha256").update(loadedText).digest("hex");
  try {
    const context = await repositoryContext(workspaceRoot, filePath);
    const baselineCommit = savedBaseline ?? await head(context.repository);
    const baselineText = await committedText(context.repository, baselineCommit, context.relativePath);
    const lines = await diffTexts(context.repository, baselineText, loadedText);
    return {
      available: true,
      baselineCommit,
      baselineLabel: savedBaseline ? "Last reviewed commit" : "Latest commit",
      loadedHash,
      loadedLabel: "Loaded document",
      lines,
      deletions: placeDeletions(baselineText, loadedText, lines),
    };
  } catch (cause) {
    return {
      available: false,
      baselineCommit: savedBaseline ?? null,
      baselineLabel: savedBaseline ? "Last reviewed commit" : "Latest commit",
      loadedHash,
      loadedLabel: "Loaded document",
      lines: [],
      deletions: [],
      reason: cause instanceof Error ? cause.message : "Git comparison is unavailable.",
    };
  }
}

export async function reviewableHead(workspaceRoot: string, filePath: string, loadedHash: string): Promise<string> {
  const context = await repositoryContext(workspaceRoot, filePath);
  const commitId = await head(context.repository);
  const [diskText, headText] = await Promise.all([
    readFile(resolveInsideWorkspace(workspaceRoot, filePath), "utf8"),
    committedText(context.repository, commitId, context.relativePath),
  ]);
  const diskHash = createHash("sha256").update(diskText).digest("hex");
  if (diskHash !== loadedHash) throw new GitUnavailableError("The loaded document differs from disk. Reload files/content before marking it reviewed.");
  if (diskText !== headText) throw new GitUnavailableError("The document has uncommitted changes. Commit it externally before marking it reviewed.");
  return commitId;
}
