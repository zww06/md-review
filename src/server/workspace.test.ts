import { mkdtemp, mkdir, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { compareDocument, reviewableHead } from "./git.js";
import { loadDocument, readLocalAsset, validateWorkspace } from "./workspace.js";

let directory: string;
let root: string;
let link: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "md-review-security-"));
  root = path.join(directory, "workspace");
  const outside = path.join(directory, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(path.join(root, "guide.md"), "# Local document");
  await writeFile(path.join(outside, "private.md"), "Outside workspace");
  await writeFile(path.join(outside, "private.png"), "Outside image");
  link = path.join(root, "linked");
  await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
});

afterEach(async () => {
  await unlink(link);
  await rm(directory, { recursive: true, force: true });
});

test("reads normal documents and raster images, including a workspace opened through a link", async () => {
  await writeFile(path.join(root, "image.PNG"), "image bytes");
  expect((await loadDocument(root, "guide.md")).text).toBe("# Local document");
  expect(await readFile(await readLocalAsset(root, "guide.md", "image.PNG"), "utf8")).toBe("image bytes");
  expect(await validateWorkspace(link)).toBe(await realpath(path.join(directory, "outside")));
  expect((await loadDocument(link, "private.md")).text).toBe("Outside workspace");
});

test("rejects traversal and links leaving the workspace for documents and images", async () => {
  await expect(loadDocument(root, "../outside/private.md")).rejects.toThrow("Path leaves the workspace");
  await expect(loadDocument(root, "linked/private.md")).rejects.toThrow("Path leaves the workspace");
  await expect(readLocalAsset(root, "guide.md", "linked/private.png")).rejects.toThrow("Path leaves the workspace");
  await expect(readLocalAsset(root, "guide.md", "../outside/private.png")).rejects.toThrow("Path leaves the workspace");
});

test("rejects HTML, SVG, scripts, and other non-image assets", async () => {
  for (const name of ["active.html", "active.svg", "active.js", "private.sqlite"]) {
    await writeFile(path.join(root, name), "<script>alert(1)</script>");
    await expect(readLocalAsset(root, "guide.md", name)).rejects.toThrow("Only raster image assets");
  }
});

test("Git comparison and marking reviewed reject links outside the workspace", async () => {
  const comparison = await compareDocument(root, "linked/private.md", "Outside workspace");
  expect(comparison.available).toBe(false);
  expect(comparison.reason).toContain("Path leaves the workspace");
  await expect(reviewableHead(root, "linked/private.md", "0".repeat(64))).rejects.toThrow("Path leaves the workspace");
});
