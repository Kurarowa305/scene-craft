import type { FastifyInstance } from "fastify";
import type { Readable } from "node:stream";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SourceFile } from "../shared/files.js";
import { idParams, text } from "./http-schema.js";
import { OperationError } from "./store.js";

export const attachmentRoute = "/api/conversations/:id/attachments/:fileId";
export const attachmentRootId = "browser_uploads";
export const attachmentLimit = 8 * 1024 ** 3;
interface Attachment {
  file: SourceFile;
  size: number;
  sha256: string;
}
/** Stage browser-selected bytes without trusting a client-supplied filesystem path. */
export async function registerAttachments(
  app: FastifyInstance,
  directory: string,
  requireMain: (id: string) => void,
) {
  const root = join(directory, "browser-uploads");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const active = new Set<string>();
  app.addContentTypeParser(
    "application/octet-stream",
    (_request, stream, done) => done(null, stream),
  );
  app.post<{
    Params: { id: string; fileId: string };
    Querystring: { name: string };
    Body: Readable;
  }>(
    attachmentRoute,
    {
      schema: {
        params: {
          ...idParams,
          required: ["id", "fileId"],
          properties: {
            ...idParams.properties,
            fileId: { type: "string", format: "uuid" },
          },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: {
              ...text,
              maxLength: 240,
              pattern: "^[^\\\\/\\u0000-\\u001f]+$",
            },
          },
        },
      },
    },
    async (request) => {
      requireMain(request.params.id);
      const length = request.headers["content-length"];
      if (length && Number(length) > attachmentLimit)
        throw new OperationError(413, "ATTACHMENT_TOO_LARGE");
      const { name } = request.query;
      if (
        Buffer.byteLength(name) > 240 ||
        name === "." ||
        name === ".." ||
        /[\\/:\u0000-\u001f]/.test(name) ||
        !/\.(blend|psd|psb|png|jpe?g|webp|exr|tiff?)$/i.test(name)
      )
        throw new OperationError(400, "INVALID_FILE_TYPE");
      const role: SourceFile["role"] = /\.blend$/i.test(name)
        ? "blend"
        : /\.ps[db]$/i.test(name)
          ? "psd"
          : /\.(exr|tiff?)$/i.test(name)
            ? "render"
            : "preview";
      const relative = `${request.params.id}/${request.params.fileId}`;
      if (active.has(relative))
        throw new OperationError(409, "UPLOAD_IN_PROGRESS");
      active.add(relative);
      const parent = join(root, request.params.id);
      const target = join(root, relative);
      const temporary = join(parent, `.upload-${randomUUID()}`);
      let output: Awaited<ReturnType<typeof open>> | undefined;
      try {
        await mkdir(temporary, { recursive: true, mode: 0o700 });
        output = await open(join(temporary, name), "wx", 0o400);
        const hash = createHash("sha256");
        let size = 0;
        for await (const chunk of request.body) {
          size += chunk.length;
          if (size > attachmentLimit)
            throw new OperationError(413, "ATTACHMENT_TOO_LARGE");
          hash.update(chunk);
          await output.writeFile(chunk);
        }
        if (!size) throw new OperationError(400, "EMPTY_ATTACHMENT");
        await output.sync();
        await output.close();
        output = undefined;
        const next: Attachment = {
          file: {
            rootId: attachmentRootId,
            relativePath: `${relative}/${name}`,
            role,
          },
          size,
          sha256: hash.digest("hex"),
        };
        let previous: Attachment | undefined;
        try {
          previous = JSON.parse(
            await readFile(join(target, "receipt.json"), "utf8"),
          );
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        if (previous) {
          if (JSON.stringify(previous) !== JSON.stringify(next))
            throw new OperationError(409, "UPLOAD_CONTENT_MISMATCH");
          return previous;
        }
        const receipt = await open(
          join(temporary, "receipt.json"),
          "wx",
          0o400,
        );
        try {
          await receipt.writeFile(JSON.stringify(next));
          await receipt.sync();
        } finally {
          await receipt.close();
        }
        await rename(temporary, target);
        return next;
      } finally {
        await output?.close();
        await rm(temporary, { recursive: true, force: true });
        active.delete(relative);
      }
    },
  );
  async function authorize(conversationId: string, files: SourceFile[]) {
    for (const source of files.filter((f) => f.rootId === attachmentRootId)) {
      const parts = source.relativePath.split("/");
      if (
        parts.length !== 3 ||
        parts[0] !== conversationId ||
        !/^[a-f0-9-]{36}$/i.test(parts[1] ?? "")
      )
        throw new OperationError(403, "ATTACHMENT_NOT_OWNED");
      let receipt: Attachment;
      try {
        receipt = JSON.parse(
          await readFile(
            join(root, parts[0]!, parts[1]!, "receipt.json"),
            "utf8",
          ),
        );
      } catch {
        throw new OperationError(409, "ATTACHMENT_UNAVAILABLE");
      }
      if (
        receipt.file.rootId !== source.rootId ||
        receipt.file.relativePath !== source.relativePath ||
        receipt.file.role !== source.role
      )
        throw new OperationError(403, "ATTACHMENT_NOT_OWNED");
    }
  }
  return {
    root,
    authorize,
    async release(files: SourceFile[]) {
      for (const source of files.filter((f) => f.rootId === attachmentRootId))
        await rm(join(root, source.relativePath), { force: true }).catch(
          () => {},
        );
    },
  };
}
