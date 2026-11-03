import { request as http } from "node:http";
import { request as https } from "node:https";
import { lookup } from "node:dns";
import { BlockList, isIP } from "node:net";
import { OperationError } from "./store.js";
export interface ReferenceResponse {
  url: string;
  status: number;
  mime: string;
  bytes: Buffer;
}
export type ReferenceFetcher = (
  url: string,
  signal: AbortSignal,
) => Promise<ReferenceResponse>;
export function publicReferenceUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4000)
    throw new OperationError(400, "INVALID_REFERENCE_URL");
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new OperationError(400, "INVALID_REFERENCE_URL");
  }
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port))
  )
    throw new OperationError(400, "INVALID_REFERENCE_URL");
  if (
    u.hostname === "localhost" ||
    u.hostname.endsWith(".localhost") ||
    u.hostname.endsWith(".local")
  )
    throw new OperationError(400, "INVALID_REFERENCE_URL");
  if (
    isIP(u.hostname.replace(/^\[|\]$/g, "")) &&
    !publicAddress(u.hostname.replace(/^\[|\]$/g, ""))
  )
    throw new OperationError(400, "INVALID_REFERENCE_URL");
  u.hash = "";
  return u.href;
}
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["192.0.0.0", 24],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
function publicAddress(address: string) {
  const family = isIP(address);
  // IPv6 global unicast only. IPv4-mapped and local ranges are excluded.
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        /^[23][0-9a-f]{3}:/i.test(address) &&
        !address.toLowerCase().startsWith("2001:db8:");
}
export const fetchReference: ReferenceFetcher = async (input, signal) => {
  let url = publicReferenceUrl(input);
  for (let redirect = 0; redirect <= 5; redirect++) {
    const result = await new Promise<ReferenceResponse & { location?: string }>(
      (resolve, reject) => {
        const target = new URL(url);
        const req = (target.protocol === "https:" ? https : http)(
          target,
          {
            signal,
            headers: {
              "user-agent": "scene-craft reference research",
              accept: "text/html,text/plain,image/png,image/jpeg,image/webp",
            },
            lookup: (host, options, callback) => {
              lookup(host, { ...options, all: true }, (error, addresses) => {
                if (error) return callback(error, []);
                if (
                  !addresses.length ||
                  addresses.some((a) => !publicAddress(a.address))
                )
                  return callback(new Error("REFERENCE_ADDRESS_DENIED"), []);
                // Supply checked addresses to this very connection, preventing DNS rebinding.
                if (options.all) callback(null, addresses);
                else callback(null, addresses[0].address, addresses[0].family);
              });
            },
          },
          (res) => {
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400) {
              res.resume();
              resolve({
                url,
                status,
                mime: "",
                bytes: Buffer.alloc(0),
                location: res.headers.location,
              });
              return;
            }
            const parts: Buffer[] = [];
            let size = 0;
            res.on("data", (data: Buffer) => {
              size += data.length;
              if (size > 8 * 1024 * 1024) {
                res.destroy(new Error("REFERENCE_TOO_LARGE"));
                return;
              }
              parts.push(data);
            });
            res.on("error", reject);
            res.on("end", () =>
              resolve({
                url,
                status,
                mime: (res.headers["content-type"] ?? "")
                  .split(";")[0]
                  .trim()
                  .toLowerCase(),
                bytes: Buffer.concat(parts),
              }),
            );
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    if (result.status >= 300 && result.status < 400) {
      if (!result.location) throw new Error("REFERENCE_REDIRECT_FAILED");
      url = publicReferenceUrl(new URL(result.location, url).href);
      continue;
    }
    return result;
  }
  throw new Error("REFERENCE_REDIRECT_FAILED");
};
export function referenceText(bytes: Buffer, mime: string) {
  if (
    !["text/html", "text/plain", "application/xhtml+xml"].includes(mime) ||
    bytes.length > 1024 * 1024
  )
    throw new Error("REFERENCE_PAGE_UNSUPPORTED");
  const text = bytes.toString("utf8");
  return (
    mime === "text/plain"
      ? text
      : text
          .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
          .replace(/<[^>]*>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100000);
}
export function imageMime(bytes: Buffer) {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}
