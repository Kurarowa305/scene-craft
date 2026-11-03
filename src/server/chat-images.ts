import type { FastifyInstance } from "fastify";
import type { Readable } from "node:stream";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type Metadata } from "sharp";
import type { ChatImage } from "../shared/chat-image.js";
import { idParams, bodySchema } from "./http-schema.js";
import { OperationError } from "./store.js";

export const chatImageRoute = "/api/conversations/:id/images/:imageId";
export const chatImageLimit = 20 * 1024 ** 2;
const params = {
  ...idParams,
  required: ["id", "imageId"],
  properties: {
    ...idParams.properties,
    imageId: { type: "string", format: "uuid" },
  },
};

/** Immutable, conversation-scoped images are material for the model, never production artifacts. */
export async function registerChatImages(
  app: FastifyInstance,
  directory: string,
  requireConversation: (id: string) => void,
  referenced: (conversationId: string, imageId: string) => boolean,
) {
  const root = join(directory, "chat-images");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const uploading = new Set<string>();
  const pins = new Map<string, number>();
  const key = (conversationId: string, imageId: string) =>
    `${conversationId}/${imageId}`;
  const path = (conversationId: string, imageId: string) =>
    join(root, key(conversationId, imageId));
  const originalPath = (conversationId: string, image: ChatImage) =>
    join(path(conversationId, image.id), `original.${image.mime.slice(6)}`);
  const digest = (bytes: Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
  async function load(conversationId: string, imageId: string) {
    requireConversation(conversationId);
    if (!/^[0-9a-f-]{36}$/i.test(imageId))
      throw new OperationError(400, "INVALID_IMAGE");
    try {
      return JSON.parse(
        await readFile(
          join(path(conversationId, imageId), "receipt.json"),
          "utf8",
        ),
      ) as ChatImage;
    } catch {
      throw new OperationError(404, "IMAGE_NOT_FOUND");
    }
  }
  if (!app.hasContentTypeParser("application/octet-stream"))
    app.addContentTypeParser(
      "application/octet-stream",
      (_request, stream, done) => done(null, stream),
    );
  app.post<{
    Params: { id: string; imageId: string };
    Querystring: { name: string };
    Body: Readable;
  }>(
    chatImageRoute,
    {
      schema: {
        params,
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 240 },
          },
        },
      },
    },
    async (request) => {
      const { id, imageId } = request.params;
      requireConversation(id);
      const { name } = request.query;
      if (
        Buffer.byteLength(name) > 240 ||
        /[\\/:\u0000-\u001f]/.test(name) ||
        !/\.(png|jpe?g|webp)$/i.test(name)
      )
        throw new OperationError(400, "INVALID_IMAGE_TYPE");
      if (Number(request.headers["content-length"] ?? 0) > chatImageLimit)
        throw new OperationError(413, "IMAGE_TOO_LARGE");
      const identity = key(id, imageId);
      if (uploading.has(identity) || uploading.size >= 4)
        throw new OperationError(409, "IMAGE_UPLOAD_IN_PROGRESS");
      uploading.add(identity);
      const temporary = join(root, `.upload-${randomUUID()}`);
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request.body) {
          size += chunk.length;
          if (size > chatImageLimit)
            throw new OperationError(413, "IMAGE_TOO_LARGE");
          chunks.push(Buffer.from(chunk));
        }
        const bytes = Buffer.concat(chunks);
        let metadata: Metadata;
        try {
          const image = sharp(bytes, {
            limitInputPixels: 20_000_000,
            failOn: "warning",
          });
          metadata = await image.metadata();
          if (
            !metadata.width ||
            !metadata.height ||
            (metadata.pages ?? 1) !== 1 ||
            !["png", "jpeg", "webp"].includes(metadata.format ?? "")
          )
            throw new Error();
          await image.stats();
        } catch {
          throw new OperationError(400, "INVALID_IMAGE");
        }
        const format = metadata.format!;
        if (
          !(
            format === "jpeg" ? /\.jpe?g$/i : new RegExp(`\\.${format}$`, "i")
          ).test(name)
        )
          throw new OperationError(400, "INVALID_IMAGE_TYPE");
        const next: ChatImage = {
          id: imageId,
          name,
          mime: `image/${format}` as ChatImage["mime"],
          size,
          sha256: digest(bytes),
          width: metadata.width!,
          height: metadata.height!,
        };
        let previous: ChatImage | undefined;
        try {
          previous = await load(id, imageId);
        } catch (error) {
          if (!(
            error instanceof OperationError && error.code === "IMAGE_NOT_FOUND"
          ))
            throw error;
        }
        if (previous) {
          if (JSON.stringify(previous) !== JSON.stringify(next))
            throw new OperationError(409, "IMAGE_CONTENT_MISMATCH");
          const stored = await readFile(originalPath(id, next));
          if (digest(stored) !== next.sha256)
            throw new OperationError(409, "IMAGE_CONTENT_MISMATCH");
          return previous;
        }
        await mkdir(temporary, { mode: 0o700 });
        await writeFile(join(temporary, `original.${format}`), bytes, {
          mode: 0o400,
          flag: "wx",
        });
        await writeFile(join(temporary, "receipt.json"), JSON.stringify(next), {
          mode: 0o400,
          flag: "wx",
        });
        await mkdir(join(root, id), { recursive: true, mode: 0o700 });
        await rename(temporary, path(id, imageId));
        return next;
      } finally {
        uploading.delete(identity);
        await rm(temporary, { recursive: true, force: true });
      }
    },
  );
  app.get<{ Params: { id: string; imageId: string } }>(
    chatImageRoute,
    { schema: { params } },
    async (request, reply) => {
      const image = await load(request.params.id, request.params.imageId);
      const bytes = await readFile(originalPath(request.params.id, image));
      if (digest(bytes) !== image.sha256)
        throw new OperationError(409, "IMAGE_CONTENT_MISMATCH");
      return reply
        .type(image.mime)
        .header("content-disposition", "inline")
        .send(bytes);
    },
  );
  app.post<{ Params: { id: string; imageId: string } }>(
    `${chatImageRoute}/remove`,
    { schema: { params, body: bodySchema({}, []) } },
    async (request) => {
      const { id, imageId } = request.params;
      const identity = key(id, imageId);
      if (
        pins.has(identity) ||
        uploading.has(identity) ||
        referenced(id, imageId)
      )
        throw new OperationError(409, "IMAGE_IN_USE");
      pins.set(identity, -1);
      try {
        await load(id, imageId);
        await rm(path(id, imageId), { recursive: true, force: true });
      } finally {
        pins.delete(identity);
      }
      return { removed: true };
    },
  );
  return {
    async accept<T>(
      conversationId: string,
      ids: string[],
      accept: (images: ChatImage[]) => T,
    ): Promise<T> {
      if (ids.length > 5 || new Set(ids).size !== ids.length)
        throw new OperationError(400, "INVALID_IMAGES");
      if (ids.some((id) => (pins.get(key(conversationId, id)) ?? 0) < 0))
        throw new OperationError(409, "IMAGE_IN_USE");
      for (const id of ids)
        pins.set(
          key(conversationId, id),
          (pins.get(key(conversationId, id)) ?? 0) + 1,
        );
      try {
        const images = await Promise.all(
          ids.map((id) => load(conversationId, id)),
        );
        if (images.reduce((sum, image) => sum + image.size, 0) > 40 * 1024 ** 2)
          throw new OperationError(413, "IMAGES_TOO_LARGE");
        return accept(images);
      } finally {
        for (const id of ids) {
          const identity = key(conversationId, id);
          const count = pins.get(identity)! - 1;
          if (count) pins.set(identity, count);
          else pins.delete(identity);
        }
      }
    },
    async inputs(conversationId: string, images: ChatImage[]) {
      return Promise.all(
        images.map(async (image) => {
          const fixed = await load(conversationId, image.id);
          if (JSON.stringify(fixed) !== JSON.stringify(image))
            throw new OperationError(409, "IMAGE_CONTENT_MISMATCH");
          const original = originalPath(conversationId, image);
          if (digest(await readFile(original)) !== image.sha256)
            throw new OperationError(409, "IMAGE_CONTENT_MISMATCH");
          return { type: "localImage", path: original };
        }),
      );
    },
  };
}
