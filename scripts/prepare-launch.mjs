// Build from the checkout before the Windows manager starts a new backend.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
for (const [script, args] of [
  ["../node_modules/typescript/bin/tsc", ["-p", "tsconfig.server.json"]],
  ["../node_modules/vite/bin/vite.js", ["build"]],
]) {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL(script, import.meta.url)), ...args],
    { cwd: root, stdio: "ignore" },
  );
  if (result.error || result.status !== 0) {
    process.stderr.write("BUILD_FAILED\n");
    process.exit(1);
  }
}
