import { createInterface } from "node:readline";
import { createConnection } from "node:net";
import { contextTools, readContextTools } from "./context-rpc.js";
import {
  referenceToolProperties,
  referenceToolRequired,
  referenceToolDescriptions,
} from "../shared/reference-tools.js";
import {
  planToolProperties,
  planToolRequired,
  planToolDescriptions,
} from "../shared/scene-plans.js";
const availableTools: readonly string[] =
  process.env.SCENE_CRAFT_READ_ONLY === "1" ? readContextTools : contextTools;

// Dedicated stdio adapter: no DB, filesystem updates, shell or production process.
const socketPath = process.env.SCENE_CRAFT_RPC_SOCKET;
const credential = process.env.SCENE_CRAFT_RPC_CREDENTIAL;
if (!socketPath || !credential) process.exit(1);
const lines = createInterface({ input: process.stdin });
async function invoke(tool: string, args: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath!);
    socket.setTimeout(60000, () =>
      socket.destroy(new Error("RPC_UNAVAILABLE")),
    );
    socket.once("error", () => reject(new Error("RPC_UNAVAILABLE")));
    socket.once("connect", () =>
      socket.write(JSON.stringify({ credential, tool, args }) + "\n"),
    );
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (data) => {
      buffer += data;
      if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) {
        socket.destroy();
        reject(new Error("RPC_UNAVAILABLE"));
        return;
      }
      if (buffer.includes("\n")) {
        socket.end();
        try {
          resolve(JSON.parse(buffer.split("\n")[0]));
        } catch {
          reject(new Error("RPC_UNAVAILABLE"));
        }
      }
    });
    socket.once("close", () => reject(new Error("RPC_UNAVAILABLE")));
  });
}
lines.on("line", async (line) => {
  let id: unknown = null;
  try {
    const message = JSON.parse(line);
    id = message.id;
    if (id === undefined) return;
    let result: unknown;
    if (message.method === "initialize")
      result = {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "scene-craft", version: "1" },
      };
    else if (message.method === "ping") result = {};
    else if (message.method === "tools/list")
      result = {
        tools: availableTools.map((name) => ({
          name,
          description:
            planToolDescriptions[name] ??
            referenceToolDescriptions[name] ??
            (name === "record_human_decision"
              ? "Unavailable: downstream decision handling is not implemented."
              : `${name}. ${name.startsWith("create_") ? "CREATE: new complete text, or replace the complete text of an explicitly identified existing target." : name.startsWith("update_") ? "UPDATE: start from existing text and append or edit according to the human instruction." : ""} Use the current contextRef. Writes require the current sourceRequestId and an explicit human instruction, including ordinary natural language; the backend resolves it from the original message. Never provide a replacement text or target as tool arguments. If needsClarification is returned, ask its question without claiming a save. Production/protection changes are unavailable.`),
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: [
              "contextRef",
              "operationId",
              ...(planToolRequired[name] ?? referenceToolRequired[name] ?? []),
            ],
            properties: {
              contextRef: { type: "string" },
              operationId: {
                type: "string",
                description: "Stable UUID for retransmission",
              },
              ...(planToolProperties[name] ??
                referenceToolProperties[name] ??
                ([
                  "get_execution_context",
                  "find_records",
                  "read_records",
                ].includes(name)
                  ? name === "get_execution_context"
                    ? {}
                    : {
                        after: { type: "integer", minimum: 0 },
                        afterRequests: { type: "integer", minimum: 0 },
                      }
                  : { sourceRequestId: { type: "string" } })),
            },
          },
        })),
      };
    else if (
      message.method === "tools/call" &&
      availableTools.includes(message.params?.name)
    ) {
      const value: any = await invoke(
        message.params.name,
        message.params.arguments,
      );
      result = {
        content: [{ type: "text", text: JSON.stringify(value) }],
        isError: Boolean(value.error),
      };
    } else {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Unsupported operation" },
        }) + "\n",
      );
      return;
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  } catch {
    if (id !== undefined)
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message: "RPC_UNAVAILABLE" },
        }) + "\n",
      );
  }
});
