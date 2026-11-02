import { DatabaseSync } from "node:sqlite";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  writeFile,
  rename,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { FileRoots } from "../shared/files.js";
import { createApp } from "./app.js";

interface Instance {
  port: number;
  secret: string;
}
async function existing(directory: string) {
  try {
    const instance = JSON.parse(
      await readFile(join(directory, "instance.json"), "utf8"),
    ) as Instance;
    if (!Number.isInteger(instance.port) || typeof instance.secret !== "string")
      throw new Error();
    const challenge = randomBytes(32).toString("hex");
    const response = await fetch(
      `http://localhost:${instance.port}/api/instance`,
      {
        headers: { "x-scene-craft-challenge": challenge },
        signal: AbortSignal.timeout(500),
        redirect: "error",
      },
    );
    const result = (await response.json()) as { app: string; proof: string };
    const expected = createHmac("sha256", instance.secret)
      .update(challenge)
      .digest("hex");
    if (
      result.app !== "scene-craft" ||
      typeof result.proof !== "string" ||
      result.proof.length !== expected.length ||
      !timingSafeEqual(Buffer.from(result.proof), Buffer.from(expected))
    )
      throw new Error();
    return `http://localhost:${instance.port}`;
  } catch {
    throw new Error("OWNER_NOT_READY");
  }
}

async function main() {
  process.umask(0o077);
  const { values } = parseArgs({
    options: {
      "data-dir": { type: "string" },
      "file-roots": { type: "string" },
      "probe-only": { type: "boolean" },
      port: { type: "string", default: "4317" },
    },
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("INVALID_PORT");
  const path = resolve(
    values["data-dir"] ?? join(homedir(), ".local/share/scene-craft"),
  );
  await mkdir(path, { recursive: true, mode: 0o700 });
  const directory = await realpath(path);
  async function reportExisting() {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const url = await existing(directory);
        console.log(JSON.stringify({ status: "existing", url }));
        return;
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
    }
    throw new Error("OWNER_NOT_READY");
  }
  if (values["probe-only"]) return reportExisting();
  // Separate from records.sqlite: this OS-released lock is held for the whole process.
  // A crash cannot leave a stale PID lock. Contenders never open the production DB.
  const owner = new DatabaseSync(join(directory, "owner.sqlite"));
  owner.exec("PRAGMA busy_timeout = 0");
  try {
    owner.exec("BEGIN EXCLUSIVE");
  } catch {
    owner.close();
    // The owner may still be binding its port and writing its readiness descriptor.
    return reportExisting();
  }

  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    await app?.close();
    await unlink(join(directory, "instance.json")).catch(() => {});
    owner.close();
  };
  try {
    const secret = randomBytes(32).toString("hex");
    app = await createApp({
      directory,
      port,
      instanceSecret: secret,
      fileRoots: values["file-roots"]
        ? (JSON.parse(
            (await readFile(values["file-roots"], "utf8")).replace(
              /^\uFEFF/,
              "",
            ),
          ) as FileRoots)
        : undefined,
      staticRoot: fileURLToPath(new URL("../client", import.meta.url)),
      onShutdown: () => {
        void stop();
      },
    });
    await app.listen({ host: "127.0.0.1", port });
    await writeFile(
      join(directory, "instance.json.tmp"),
      JSON.stringify({ port, secret }),
      { mode: 0o600 },
    );
    await rename(
      join(directory, "instance.json.tmp"),
      join(directory, "instance.json"),
    );
    process.once("SIGINT", () => {
      void stop();
    });
    process.once("SIGTERM", () => {
      void stop();
    });
    console.log(
      JSON.stringify({ status: "started", url: `http://localhost:${port}` }),
    );
  } catch (error) {
    await stop();
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EADDRINUSE"
    )
      throw new Error("PORT_IN_USE");
    throw new Error("START_FAILED");
  }
}
main().catch((error) => {
  const known = [
    "PORT_IN_USE",
    "OWNER_NOT_READY",
    "INVALID_PORT",
    "START_FAILED",
  ];
  console.error(known.includes(error.message) ? error.message : "START_FAILED");
  process.exitCode = 1;
});
