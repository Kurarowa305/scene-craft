// Real app-server contract check, without inference or copied credentials.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { openStore } from "../dist/server/store.js";
import {
  startContextRpc,
  readContextTools,
  contextTools,
} from "../dist/server/context-rpc.js";
import { connectCodex } from "../dist/server/codex.js";

const [binary, output] = process.argv.slice(2);
if (!binary || !output)
  throw new Error("Usage: probe-side-chat.ts <binary> <output>");
const directory = await mkdtemp(join(tmpdir(), "scene-side-probe-"));
const store = openStore(directory);
const rpc = await startContextRpc(store);
let connection;
let stage = "connect";
try {
  connection = await connectCodex(binary, directory, rpc.endpoint);
  const start = (id: string, readOnly: boolean, threadId?: string) =>
    connection!.rpc(threadId ? "thread/resume" : "thread/start", {
      config: rpc.configuration(id, readOnly),
      baseInstructions:
        "Use only the available scene_craft reference tools and text answers.",
      sandbox: "read-only",
      approvalPolicy: "never",
      modelProvider: "openai",
      environments: [],
      runtimeWorkspaceRoots: [],
      ...(threadId
        ? { threadId, excludeTurns: true }
        : { historyMode: "paginated", allowProviderModelFallback: false }),
    });
  stage = "main thread/start";
  const main = await start("main-probe", false);
  stage = "side thread/start";
  const side = await start("side-probe", true);
  assert.notEqual(main.thread.id, side.thread.id);
  async function tools(threadId: string) {
    const status = await connection!.rpc("mcpServerStatus/list", {
      threadId,
      limit: 50,
    });
    assert.equal(status.data.length, 1);
    assert.equal(status.data[0].name, "scene_craft");
    return Object.keys(status.data[0].tools).sort();
  }
  stage = "main mcpServerStatus/list";
  const mainTools = await tools(main.thread.id);
  stage = "side mcpServerStatus/list";
  const sideTools = await tools(side.thread.id);
  assert.deepEqual(mainTools, [...contextTools].sort());
  assert.deepEqual(sideTools, [...readContextTools].sort());
  // Empty threads have no persisted rollout to cold-resume. Verify a real turn
  // and restart separately in the authenticated Windows acceptance flow.
  stage = "effective configuration";
  const effective = await connection.rpc("config/read", {
    includeLayers: false,
  });
  for (const feature of [
    "shell_tool",
    "unified_exec",
    "apps",
    "plugins",
    "hooks",
    "computer_use",
    "browser_use",
    "multi_agent",
    "image_generation",
  ])
    assert.equal(effective.config.features[feature], false);
  assert.equal(effective.config.web_search, "disabled");
  assert.equal(effective.config.approval_policy, "never");
  const result = {
    targetCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    checkedAt: new Date().toISOString(),
    runtime: connection.runtime,
    expected:
      "distinct threads; main 8 tools; side 3 reference tools; execution bypass features disabled",
    actual: {
      distinctThreads: true,
      mainTools,
      sideTools,
      coldResume: "not_run: requires persisted real turn",
      executionBypass: "disabled",
    },
    status: "passed",
    inference: "not_run",
    windowsHumanVerification: "not_run",
  };
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} catch (error) {
  console.error("Contract check failed at: " + stage);
  throw error;
} finally {
  await connection?.close();
  await rpc.close();
  store.close();
  await rm(directory, { recursive: true, force: true });
}
