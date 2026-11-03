import { createHash, randomUUID } from "node:crypto";
import type { openStore } from "./store.js";
import { OperationError } from "./store.js";
import type { ChatRequest } from "../shared/chat.js";
import type {
  ReferencePage,
  ReferenceCandidate,
} from "../shared/references.js";
import {
  fetchReference,
  publicReferenceUrl,
  referenceText,
  imageMime,
  type ReferenceFetcher,
} from "./reference-fetch.js";
import {
  referenceToolProperties,
  referenceToolRequired,
} from "../shared/reference-tools.js";
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export function referenceService(
  store: ReturnType<typeof openStore>,
  fetcher: ReferenceFetcher = fetchReference,
) {
  const refs = store.references;
  return async (
    r: ChatRequest,
    tool: string,
    args: Record<string, any>,
    current: () => ChatRequest,
  ) => {
    const properties = referenceToolProperties[tool];
    const allowed = ["contextRef", "operationId", ...Object.keys(properties)];
    if (
      Object.keys(args).some((k) => !allowed.includes(k)) ||
      referenceToolRequired[tool].some(
        (k) => typeof args[k] !== "string" || !args[k].trim(),
      ) ||
      Object.entries(properties).some(
        ([key, schema]: [string, any]) =>
          args[key] !== undefined &&
          (typeof args[key] !== "string" ||
            !args[key].trim() ||
            args[key].length > schema.maxLength),
      )
    )
      throw new OperationError(400, "INVALID_REFERENCE_ARGUMENTS");
    if (tool === "select_reference") {
      if (args.sourceRequestId !== r.id)
        throw new OperationError(403, "EXPLICIT_INSTRUCTION_REQUIRED");
      return () => refs.select(current(), args.referenceId);
    }
    if (r.role !== "reference")
      throw new OperationError(403, "REFERENCE_ROLE_REQUIRED");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const check = setInterval(() => {
      try {
        current();
      } catch {
        controller.abort();
      }
    }, 50);
    try {
      if (tool === "fetch_reference_page") {
        const url = publicReferenceUrl(args.url);
        const page: ReferencePage = {
          ...refs.source(r),
          id: randomUUID(),
          url,
          finalUrl: url,
          purpose: args.purpose,
          status: "failed",
          text: "",
          sha256: null,
          error: null,
        };
        try {
          const response = await fetcher(url, controller.signal);
          page.finalUrl = publicReferenceUrl(response.url);
          if (response.status < 200 || response.status >= 300) {
            page.status =
              response.status === 404 || response.status === 410
                ? "broken"
                : "failed";
            page.error = `HTTP_${response.status}`;
          } else {
            page.text = referenceText(response.bytes, response.mime);
            page.sha256 = hash(response.bytes);
            page.status = "available";
          }
        } catch {
          page.error = controller.signal.aborted
            ? "REFERENCE_FETCH_STOPPED_OR_TIMEOUT"
            : "REFERENCE_FETCH_FAILED";
        }
        try {
          current();
        } catch (error) {
          page.status = "stopped";
          page.error = "STALE_CONTEXT";
          refs.persistPage(page);
          throw error;
        }
        return () => {
          refs.persistPage(page);
          return {
            complete: page.status === "available",
            page,
            purpose: args.purpose,
          };
        };
      }
      const page = refs.page(r.workId, args.pageId);
      const c: ReferenceCandidate = {
        ...refs.source(r),
        id: randomUUID(),
        pageId: page.id,
        title: args.title,
        author: args.author ?? null,
        element: args.element,
        intentRelation: args.intentRelation,
        image: {
          status: args.imageUrl ? "not_retained" : "url_only",
          url: args.imageUrl ? publicReferenceUrl(args.imageUrl) : null,
          sha256: null,
          size: null,
          mime: null,
          permissionPageId: args.permissionPageId ?? null,
          permissionQuote: args.permissionQuote ?? null,
          error: null,
        },
      };
      let bytes: Buffer | undefined;
      if (args.permissionPageId || args.permissionQuote) {
        if (!args.imageUrl || !args.permissionPageId || !args.permissionQuote)
          throw new OperationError(400, "IMAGE_PERMISSION_REQUIRED");
        const permission = refs.page(r.workId, args.permissionPageId);
        if (
          permission.status !== "available" ||
          !permission.text.includes(args.permissionQuote)
        )
          throw new OperationError(409, "IMAGE_PERMISSION_UNVERIFIED");
        if (!refs.canStoreImage) {
          c.image.status = "not_retained";
          c.image.error = "FILE_STORAGE_NOT_CONFIGURED";
          current();
          return () => refs.save(c);
        }
        // The acting research model must verify this exact quote permits copying the image.
        try {
          const response = await fetcher(c.image.url!, controller.signal);
          const mime = imageMime(response.bytes);
          if (response.status === 404 || response.status === 410) {
            c.image.status = "broken";
            c.image.error = `HTTP_${response.status}`;
          } else if (
            response.status < 200 ||
            response.status >= 300 ||
            !mime ||
            response.mime !== mime ||
            response.bytes.length > 8 * 1024 * 1024
          ) {
            c.image.status = "failed";
            c.image.error = "REFERENCE_IMAGE_UNSUPPORTED";
          } else {
            bytes = response.bytes;
            c.image.status = "stored";
            c.image.mime = mime;
            c.image.size = bytes.length;
            c.image.sha256 = hash(bytes);
          }
        } catch {
          c.image.status = controller.signal.aborted ? "stopped" : "failed";
          c.image.error = "REFERENCE_IMAGE_FETCH_FAILED";
        }
      }
      current();
      return () => refs.save(c, bytes);
    } finally {
      clearTimeout(timer);
      clearInterval(check);
    }
  };
}
