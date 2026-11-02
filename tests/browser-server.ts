import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "scene-browser-"));
const child = spawn(
  process.execPath,
  ["dist/server/cli.js", "--port", "4517", "--data-dir", directory],
  { stdio: "inherit" },
);
process.once("SIGTERM", () => child.kill("SIGTERM"));
process.once("SIGINT", () => child.kill("SIGINT"));
child.once("exit", async (code) => {
  await rm(directory, { recursive: true, force: true });
  process.exitCode = code ?? 0;
});
