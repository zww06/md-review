#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { discoverMarkdown, loadDocument, readLocalAsset, validateWorkspace } from "./workspace.js";
import { compareDocument, reviewableHead } from "./git.js";
import { ReviewStore } from "./store.js";
import type { CommentInput } from "../shared/types.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function parseArguments(argv: string[]): { workspace: string; port: number } {
  let workspace = ".";
  let port = 4173;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--port") {
      port = Number(argv[index + 1]);
      index += 1;
    } else if (argv[index].startsWith("--")) {
      throw new Error(`Unknown option: ${argv[index]}`);
    } else {
      workspace = argv[index];
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be between 1 and 65535.");
  return { workspace, port };
}

function requestHost(hostHeader: string | undefined): string {
  if (!hostHeader) return "";
  if (hostHeader.startsWith("[")) return hostHeader.slice(0, hostHeader.indexOf("]") + 1);
  return hostHeader.split(":")[0].toLocaleLowerCase();
}

const { workspace: workspaceInput, port } = parseArguments(process.argv.slice(2));
const workspaceRoot = await validateWorkspace(workspaceInput);
const sessionToken = randomBytes(24).toString("base64url");
const store = new ReviewStore(workspaceRoot);
const app = Fastify({ logger: false });

app.addHook("onRequest", async (request, reply) => {
  const host = requestHost(request.headers.host);
  if (!LOOPBACK_HOSTS.has(host)) {
    return reply.code(403).send({ error: "Only loopback requests are accepted." });
  }

  const origin = request.headers.origin;
  if (origin) {
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      return reply.code(403).send({ error: "Invalid request origin." });
    }
    const allowedOrigin = originUrl.origin === `http://${request.headers.host?.toLowerCase()}`;
    if (!allowedOrigin) return reply.code(403).send({ error: "Cross-origin requests are not accepted." });
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    if (request.headers["x-md-review-token"] !== sessionToken) {
      return reply.code(403).send({ error: "The session credential is missing or invalid." });
    }
  }
});

app.get("/api/bootstrap", async () => ({
  name: path.basename(workspaceRoot),
  root: workspaceRoot,
  files: await discoverMarkdown(workspaceRoot),
  sessionToken,
}));

app.get<{ Querystring: { path?: string } }>("/api/document", async (request, reply) => {
  if (!request.query.path) return reply.code(400).send({ error: "A document path is required." });
  try {
    return await loadDocument(workspaceRoot, request.query.path);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Unable to load document." });
  }
});

app.get<{ Querystring: { document?: string; path?: string } }>("/api/asset", async (request, reply) => {
  if (!request.query.document || !request.query.path) {
    return reply.code(400).send({ error: "Document and asset paths are required." });
  }
  try {
    const asset = await readLocalAsset(workspaceRoot, request.query.document, request.query.path);
    await access(asset);
    reply.header("Content-Security-Policy", "sandbox; default-src 'none'");
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.sendFile(path.basename(asset), path.dirname(asset));
  } catch (error) {
    return reply.code(404).send({ error: error instanceof Error ? error.message : "Asset unavailable." });
  }
});

app.get<{ Querystring: { path?: string } }>("/api/comments", async (request, reply) => {
  if (!request.query.path) return reply.code(400).send({ error: "A document path is required." });
  return store.listComments(request.query.path);
});

app.post<{ Body: CommentInput }>("/api/comments", async (request, reply) => {
  const input = request.body;
  if (!input || !input.filePath || !input.body?.trim() || !input.originalQuote) {
    return reply.code(400).send({ error: "A file, quote, and comment body are required." });
  }
  if (
    !Number.isInteger(input.sourceStartLine) || !Number.isInteger(input.sourceEndLine) ||
    !Number.isInteger(input.sourceStartOffset) || !Number.isInteger(input.sourceEndOffset) ||
    input.sourceStartLine < 1 || input.sourceEndLine < input.sourceStartLine ||
    input.sourceStartOffset < 0 || input.sourceEndOffset <= input.sourceStartOffset
  ) {
    return reply.code(400).send({ error: "The comment source range is invalid." });
  }
  try {
    return reply.code(201).send(store.saveComment({ ...input, body: input.body.trim() }));
  } catch (error) {
    return reply.code(500).send({ error: error instanceof Error ? error.message : "Unable to save the comment." });
  }
});

app.patch<{ Params: { id: string }; Body: { body?: string; status?: "open" | "resolved" } }>(
  "/api/comments/:id",
  async (request, reply) => {
    const { body, status } = request.body ?? {};
    if (body !== undefined && !body.trim()) return reply.code(400).send({ error: "Comment body cannot be empty." });
    if (status !== undefined && status !== "open" && status !== "resolved") {
      return reply.code(400).send({ error: "Comment status is invalid." });
    }
    try {
      const comment = store.updateComment(request.params.id, { body: body?.trim(), status });
      return comment ?? reply.code(404).send({ error: "Comment not found." });
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? error.message : "Unable to update the comment." });
    }
  },
);

app.delete<{ Params: { id: string } }>("/api/comments/:id", async (request, reply) => {
  try {
    if (!store.deleteComment(request.params.id)) return reply.code(404).send({ error: "Comment not found." });
    return reply.code(204).send();
  } catch (error) {
    return reply.code(500).send({ error: error instanceof Error ? error.message : "Unable to delete the comment." });
  }
});

app.post<{ Body: { filePath?: string; loadedText?: string } }>("/api/compare", async (request, reply) => {
  const { filePath, loadedText } = request.body ?? {};
  if (!filePath || typeof loadedText !== "string") {
    return reply.code(400).send({ error: "A document path and its loaded text are required." });
  }
  const baseline = store.getReviewedCommit(filePath)?.commitId;
  return compareDocument(workspaceRoot, filePath, loadedText, baseline);
});

app.post<{ Body: { filePath?: string; loadedHash?: string } }>("/api/mark-reviewed", async (request, reply) => {
  const { filePath, loadedHash } = request.body ?? {};
  if (!filePath || !loadedHash || !/^[0-9a-f]{64}$/i.test(loadedHash)) {
    return reply.code(400).send({ error: "A document path and valid loaded-content hash are required." });
  }
  try {
    const commitId = await reviewableHead(workspaceRoot, filePath, loadedHash);
    return store.markReviewed(filePath, commitId);
  } catch (error) {
    return reply.code(409).send({ error: error instanceof Error ? error.message : "The document cannot be marked reviewed." });
  }
});

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(serverDirectory, "../../dist");
await app.register(fastifyStatic, { root: clientRoot, wildcard: false });
app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found." });
  return reply.sendFile("index.html");
});

const address = await app.listen({ host: "127.0.0.1", port });
console.log(`Markdown Review\nWorkspace: ${workspaceRoot}\nBrowser: ${address}`);

const close = async () => {
  await app.close();
  store.close();
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
