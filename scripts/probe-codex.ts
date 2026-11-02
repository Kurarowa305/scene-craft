// No credentials copied and no turn/start. This only checks the installed protocol.
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCodex } from "../src/server/codex.js";
const binary = process.argv[2];
const output = process.argv[3];
if (!binary || !output)
  throw new Error("Usage: probe-codex.ts <absolute binary> <output>");
const directory = await mkdtemp(join(tmpdir(), "scene-contract-61-"));
const c = await connectCodex(binary, directory);
try {
  const original = c.rpc.bind(c);
  c.rpc = async (method, params) => {
    try {
      return await original(method, params);
    } catch {
      return { probeError: "RPC_REJECTED", data: [] };
    }
  };
  const account = await c.rpc("account/read", { refreshToken: false });
  const catalog = await c.rpc("model/list", { limit: 2 });
  const start = await c.rpc("thread/start", {
    sandbox: "read-only",
    approvalPolicy: "never",
    historyMode: "paginated",
    allowProviderModelFallback: false,
    modelProvider: "openai",
    baseInstructions: "Text conversation only.",
    runtimeWorkspaceRoots: [],
    environments: [],
  });
  const turns = await c.rpc("thread/turns/list", {
    threadId: start.thread.id,
    limit: 2,
    itemsView: "full",
    sortDirection: "asc",
  });
  const items = await c.rpc("thread/items/list", {
    threadId: start.thread.id,
    limit: 2,
    sortDirection: "asc",
  });
  const resume = await c.rpc("thread/resume", {
    threadId: start.thread.id,
    excludeTurns: true,
    sandbox: "read-only",
    approvalPolicy: "never",
    model: start.model,
    modelProvider: "openai",
    runtimeWorkspaceRoots: [],
    environments: [],
  });
  const result = {
    checkedAt: new Date().toISOString(),
    runtime: c.runtime,
    authEmpty: account.account === null,
    modelCatalog: catalog.data.length,
    paginated: start.thread.historyMode ?? null,
    startModel: start.model,
    startProvider: start.modelProvider,
    turnPage: turns.probeError ?? "ok",
    itemPage: items.probeError ?? "ok",
    resume: resume.probeError ?? "ok",
    coldResumeSameThread: resume.thread?.id === start.thread.id,
    instructionSourceCount: start.instructionSources?.length ?? null,
    inference: "not run",
    emptyThreadLimitation:
      "Before the first turn, durable history and cold resume may be unavailable. Authenticated turn/start and post-turn pagination require Windows manual verification.",
    authExpirationAndLimits: "simulated only",
  };
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  await c.close();
  await rm(directory, { recursive: true, force: true });
}
