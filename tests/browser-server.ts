import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitFixture, cleanGitFixture } from "./git-fixture.js";
const directory = await mkdtemp(join(tmpdir(), "scene-browser-"));
const source = join(directory, "source");
const managed = join(directory, "managed");
const git = await gitFixture(directory);
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/git-fixture.json",
  JSON.stringify({ definition: git.definition, style: git.style }),
);
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
    "--git-repository",
    git.repository,
  ],
  { stdio: "inherit" },
);
process.once("SIGTERM", () => child.kill("SIGTERM"));
process.once("SIGINT", () => child.kill("SIGINT"));
child.once("exit", async (code) => {
  await cleanGitFixture(directory);
  process.exitCode = code ?? 0;
});
