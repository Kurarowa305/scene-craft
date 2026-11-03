// Authenticated regression at the real HTTP -> Codex model -> MCP -> SQLite seam.
// Creates a labelled diagnostic work; never copies credentials or modifies other works.
const origin = process.argv[2] ?? "http://localhost:4317";
const address = new URL(origin);
if (address.protocol !== "http:" || address.hostname !== "localhost")
  throw new Error("LOCAL_ORIGIN_REQUIRED");
const response = await fetch(origin + "/api/session");
const session = await response.json();
const cookie = response.headers.get("set-cookie")!.split(";")[0];
const headers = {
  "content-type": "application/json",
  origin,
  cookie,
  "x-csrf-token": session.csrfToken,
};
async function read(path: string) {
  const result = await fetch(origin + path);
  if (!result.ok) throw new Error(`HTTP_${result.status}`);
  return result.json();
}
async function post(path: string, input: Record<string, unknown>) {
  const result = await fetch(origin + path, {
    method: "POST",
    headers,
    body: JSON.stringify({ requestKey: crypto.randomUUID(), ...input }),
  });
  if (!result.ok) throw new Error(`HTTP_${result.status}`);
  return result.json();
}
let conversationId = process.argv[3];
let workId: string;
let previousThread: string | null = null;
if (conversationId) {
  const view = await read(`/api/conversations/${conversationId}/chat`);
  workId = view.requests[0]?.workId;
  const context = await read(`/api/works/${workId}/context`);
  if (!context.work.name.startsWith("接続診断 #62"))
    throw new Error("DIAGNOSTIC_WORK_REQUIRED");
  previousThread = view.session.threadId;
} else {
  const work = await post("/api/works", { name: "接続診断 #62 承認判定" });
  workId = work.id;
  const conversation = await post(`/api/works/${workId}/conversations`, {});
  conversationId = conversation.id;
}
const request = await post(`/api/conversations/${conversationId}/messages`, {
  body: "制作意図を更新: 接続診断の制作意図",
  role: "none",
});
console.log(
  JSON.stringify({
    diagnosticWorkId: workId,
    conversationId,
    requestId: request.id,
  }),
);
let settled = false;
for (let attempt = 0; attempt < 120; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const view = await read(`/api/conversations/${conversationId}/chat`);
  const latest = view.requests.find(
    (entry: { id: string }) => entry.id === request.id,
  );
  if (!latest.terminal) continue;
  const context = await read(`/api/works/${workId}/context`);
  const output = latest.items
    .filter((item: { type: string }) => item.type === "agentMessage")
    .map((item: { text: string }) => item.text)
    .join("");
  const recorded = context.revisions.some(
    (revision: { sourceRequestId: string }) =>
      revision.sourceRequestId === request.id,
  );
  const updated = context.work.intent === "接続診断の制作意図";
  const sameThread =
    !previousThread || previousThread === view.session.threadId;
  console.log(
    JSON.stringify({
      phase: latest.phase,
      approvalMention: /承認|approval/i.test(output),
      updated,
      recorded,
      sameThread,
      revisionCount: context.revisions.length,
    }),
  );
  if (!updated || !recorded || !sameThread) process.exitCode = 1;
  settled = true;
  break;
}
if (!settled) throw new Error("TURN_NOT_SETTLED");
