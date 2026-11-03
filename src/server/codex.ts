import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { OperationError } from "./store.js";

// JSON is decoded only at this external protocol boundary. Raw errors never leave it.
export interface CodexConnection {
  rpc(method: string, params: Record<string, unknown>): Promise<any>;
  onEvent(listener: (method: string, params: any) => void): () => void;
  runtime: string | null;
  available?: boolean;
  close(): Promise<void>;
}
export async function connectCodex(
  binary: string,
  directory: string,
): Promise<CodexConnection> {
  const home = join(directory, "codex");
  const cwd = join(directory, "chat-workspace");
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  // Own this configuration. Never inherit user's providers, MCP servers or hooks.
  const config = `forced_login_method = "chatgpt"\ncli_auth_credentials_store = "file"\nmodel_provider = "openai"\nweb_search = "disabled"\napproval_policy = "never"\nsandbox_mode = "read-only"\n[features]\nshell_tool = false\nunified_exec = false\napps = false\nplugins = false\nhooks = false\ncomputer_use = false\nbrowser_use = false\nmulti_agent = false\nimage_generation = false\n`;
  await writeFile(join(home, "config.toml"), config, { mode: 0o600 });
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    "HOME",
    "USER",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ])
    if (process.env[key]) environment[key] = process.env[key];
  environment.PATH = `${dirname(process.execPath)}:/usr/bin:/bin`;
  environment.CODEX_HOME = home;
  const child: ChildProcessWithoutNullStreams = spawn(
    binary,
    ["app-server", "--listen", "stdio://"],
    { cwd, env: environment, stdio: "pipe" },
  );
  child.stderr.resume(); // May contain credentials or paths. Never log it.
  let sequence = 0;
  let exited = false;
  const listeners = new Set<(method: string, params: any) => void>();
  const pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  function lost() {
    connection.available = false;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new OperationError(409, "CODEX_DISCONNECTED"));
    }
    pending.clear();
    for (const listener of listeners) listener("connection/lost", {});
  }
  child.once("error", () => {
    exited = true;
    lost();
  });
  child.once("exit", () => {
    exited = true;
    lost();
  });
  child.stdin.on("error", () => {});
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (typeof message.id === "number" && !message.method) {
        const p = pending.get(message.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(message.id);
        if (message.error)
          p.reject(new OperationError(409, "CODEX_RPC_REJECTED"));
        else p.resolve(message.result);
      } else if (message.method && message.id !== undefined) {
        // No tool/approval requests are authorized by this chat-only implementation.
        child.stdin.write(
          JSON.stringify({
            id: message.id,
            error: { code: -32601, message: "Unsupported operation" },
          }) + "\n",
        );
        for (const listener of listeners)
          listener("permission/denied", message.params ?? {});
      } else if (message.method)
        for (const listener of listeners)
          listener(message.method, message.params ?? {});
    } catch {
      lost();
    }
  });
  const connection: CodexConnection = {
    available: true,
    runtime: null,
    rpc(method, params) {
      if (
        exited ||
        child.exitCode !== null ||
        child.signalCode !== null ||
        child.killed ||
        connection.available === false
      )
        return Promise.reject(new OperationError(409, "CODEX_DISCONNECTED"));
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new OperationError(409, "CODEX_RESPONSE_UNKNOWN"));
        }, 30_000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      });
    },
    onEvent(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async close() {
      listeners.clear();
      lost();
      lines.close();
      if (exited || child.exitCode !== null || child.signalCode !== null)
        return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill("SIGTERM");
      });
    },
  };
  try {
    const result = await connection.rpc("initialize", {
      clientInfo: { name: "scene_craft", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    connection.runtime = result.userAgent ?? null;
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    return connection;
  } catch (error) {
    await connection.close();
    throw error;
  }
}
