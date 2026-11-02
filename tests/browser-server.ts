import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "scene-browser-"));
const source = join(directory, "source");
const managed = join(directory, "managed");
await mkdir(source);
await mkdir(managed);
await writeFile(join(source, "drawing.psd"), "browser fixture");
await writeFile(join(source, "after.psb"), "browser retouch");
const roots = join(directory, "roots.json");
await writeFile(
  roots,
  JSON.stringify({
    sources: [{ id: "source", path: source }],
    managed: { id: "production", path: managed },
  }),
);
const child = spawn(
  process.execPath,
  [
    "dist/server/cli.js",
    "--port",
    "4517",
    "--data-dir",
    directory,
    "--file-roots",
    roots,
  ],
  { stdio: "inherit" },
);
process.once("SIGTERM", () => child.kill("SIGTERM"));
process.once("SIGINT", () => child.kill("SIGINT"));
child.once("exit", async (code) => {
  await rm(directory, { recursive: true, force: true });
  process.exitCode = code ?? 0;
});
