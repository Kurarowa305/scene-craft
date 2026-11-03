// Non-inference contract probe. Dedicated empty home; no credential copying.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../dist/server/store.js";
import { startContextRpc } from "../dist/server/context-rpc.js";
import { connectCodex } from "../dist/server/codex.js";
import { commonInstructions } from "../dist/server/chat.js";
const [binary, output] = process.argv.slice(2);
if (!binary || !output)
  throw new Error("Usage: probe-context.ts <binary> <output>");
const directory = await mkdtemp(join(tmpdir(), "scene-context-probe-"));
const store = openStore(directory);
const rpc = await startContextRpc(store);
const connection = await connectCodex(binary, directory, rpc.endpoint);
try {
  const thread = await connection.rpc("thread/start", {
    config: rpc.configuration("probe-conversation"),
    baseInstructions: commonInstructions,
    sandbox: "read-only",
    approvalPolicy: "never",
    modelProvider: "openai",
    historyMode: "paginated",
    allowProviderModelFallback: false,
    environments: [],
    runtimeWorkspaceRoots: [],
  });
  const status = await connection.rpc("mcpServerStatus/list", {
    threadId: thread.thread.id,
    limit: 50,
  });
  const skills = await connection.rpc("skills/list", { forceReload: true });
  const result = {
    checkedAt: new Date().toISOString(),
    runtime: connection.runtime,
    instructionSourceCount: thread.instructionSources?.length ?? null,
    skillCounts: skills.data.map((entry: any) => ({
      count: entry.skills?.length ?? 0,
      enabled:
        entry.skills?.filter((skill: any) => skill.enabled !== false).length ??
        0,
    })),
    mcp: status.data.map((server: any) => ({
      name: server.name,
      tools: Object.keys(server.tools ?? {}),
    })),
    inference: "not run",
    roleSwitchAndColdResume: "Windows manual verification pending",
  };
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  await connection.close();
  await rpc.close();
  store.close();
  await rm(directory, { recursive: true, force: true });
}
