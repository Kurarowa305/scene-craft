import { versionReason } from "./version-errors";
export class SaveError extends Error {
  constructor(
    public status: number | undefined,
    code?: string,
  ) {
    super(
      code?.startsWith("GIT_")
        ? versionReason(code)
        : "保存結果を確認できません。入力は保持しています。同じ内容で再送すると、保存済みの記録を確認できます。",
    );
  }
}
let csrfToken: string | undefined;
const receipts = new Map<string, string>();

export async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok) {
    const code = ((await response.json()) as { error?: string }).error;
    throw new Error(
      code?.startsWith("GIT_")
        ? versionReason(code)
        : "記録を取得できません。接続を確認して、再読み込みしてください。",
    );
  }
  return response.json() as Promise<T>;
}

export async function write<T>(
  path: string,
  content: Record<string, unknown>,
  idempotent = true,
): Promise<T> {
  const signature = JSON.stringify([path, content]);
  const requestKey = receipts.get(signature) ?? crypto.randomUUID();
  receipts.set(signature, requestKey);
  let status: number | undefined;
  let code: string | undefined;
  try {
    if (!csrfToken)
      csrfToken = (await read<{ csrfToken: string }>("/api/session")).csrfToken;
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify(idempotent ? { ...content, requestKey } : content),
    });
    status = response.status;
    if (!response.ok) {
      code = ((await response.json()) as { error?: string }).error;
      if (response.status === 403) csrfToken = undefined;
      throw new Error();
    }
    const result = (await response.json()) as T;
    receipts.delete(signature);
    return result;
  } catch {
    throw new SaveError(status, code);
  }
}

/** Browser File bytes are streamed separately from the JSON record/import contract. */
export async function uploadFile(
  conversationId: string,
  id: string,
  file: File,
): Promise<{
  file: import("../shared/files").SourceFile;
  size: number;
  sha256: string;
}> {
  if (!csrfToken)
    csrfToken = (await read<{ csrfToken: string }>("/api/session")).csrfToken;
  const response = await fetch(
    `/api/conversations/${conversationId}/attachments/${id}?name=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/octet-stream",
        "x-csrf-token": csrfToken,
      },
      body: file,
    },
  );
  if (!response.ok) {
    if (response.status === 403) csrfToken = undefined;
    throw new Error(
      response.status === 413
        ? "添付できるファイルは1件8GiBまでです。"
        : "ファイルを受け渡しできません。選択内容は保持しています。同じファイルで再送してください。",
    );
  }
  return response.json();
}
