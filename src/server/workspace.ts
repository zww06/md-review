import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { parseCourse } from "../shared/markdown.js";
import type { FileEntry, LoadedDocument } from "../shared/types.js";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "dist-server",
  "node_modules",
  "out",
]);

export async function validateWorkspace(input: string): Promise<string> {
  const root = path.resolve(input);
  const details = await stat(root).catch(() => null);
  if (!details?.isDirectory()) throw new Error(`Workspace is not a readable directory: ${root}`);
  return realpath(root);
}

export async function resolveInsideWorkspace(root: string, relativePath: string): Promise<string> {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error("A relative workspace path is required.");
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Path leaves the workspace.");
  const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(root), realpath(resolved)]);
  const canonicalRelative = path.relative(canonicalRoot, canonicalTarget);
  if (canonicalRelative === ".." || canonicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelative)) {
    throw new Error("Path leaves the workspace.");
  }
  return canonicalTarget;
}

export async function discoverMarkdown(root: string): Promise<FileEntry[]> {
  const files: FileEntry[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) await visit(absolute);
        continue;
      }
      if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
        files.push({ path: path.relative(root, absolute).split(path.sep).join("/") });
      }
    }
  }

  await visit(root);
  return files;
}

export async function loadDocument(root: string, relativePath: string): Promise<LoadedDocument> {
  if (!/\.(md|markdown)$/i.test(relativePath)) throw new Error("Only Markdown documents can be opened.");
  const absolute = await resolveInsideWorkspace(root, relativePath);
  const text = await readFile(absolute, "utf8");
  return {
    path: relativePath.split("\\").join("/"),
    text,
    contentHash: createHash("sha256").update(text).digest("hex"),
    loadedAt: new Date().toISOString(),
    course: parseCourse(text, relativePath),
  };
}

export async function readLocalAsset(root: string, documentPath: string, assetPath: string): Promise<string> {
  if (/^(?:[a-z]+:)?\/\//i.test(assetPath) || assetPath.startsWith("data:")) {
    throw new Error("Remote assets are not loaded automatically.");
  }
  const documentDirectory = path.posix.dirname(documentPath.replaceAll("\\", "/"));
  const relativeAsset = path.posix.normalize(path.posix.join(documentDirectory, assetPath));
  const absolute = await resolveInsideWorkspace(root, relativeAsset);
  if (!/\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(relativeAsset) ||
      !/\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(absolute)) {
    throw new Error("Only raster image assets are supported.");
  }
  return absolute;
}
