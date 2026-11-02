import { execFileSync } from "node:child_process";
import { mkdir, writeFile, chmod, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

export const definitionManifest = {
  schema: "scene-craft.definition.v1",
  runtime: "scene-craft.v1",
  roles: [
    {
      id: "reference",
      description: "参考調査",
      instructions: ["instructions.md"],
      procedures: [],
      code: [],
      context: ["work.intent"],
      tools: [],
      operations: [],
      outputs: ["text"],
    },
  ],
  style: { required: false, formats: ["scene-craft.style.v1"] },
};
export async function gitFixture(directory: string) {
  const repository = join(directory, "repo");
  await mkdir(repository);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  await writeFile(
    join(repository, "definition.json"),
    JSON.stringify(definitionManifest),
  );
  await writeFile(join(repository, "instructions.md"), "固定された指示");
  git("add", ".");
  git("commit", "-m", "definition");
  const definition = git("rev-parse", "HEAD");
  await writeFile(
    join(repository, "style.json"),
    JSON.stringify({
      schema: "scene-craft.style.v1",
      tendencies: ["静けさ"],
      policies: ["余白を残す"],
    }),
  );
  git("add", ".");
  git("commit", "-m", "style");
  const style = git("rev-parse", "HEAD");
  return { repository, git, definition, style };
}
export async function cleanGitFixture(directory: string) {
  await chmod(directory, 0o700);
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (entry.isDirectory()) await cleanGitFixture(join(directory, entry.name));
  await rm(directory, { recursive: true, force: true });
}
