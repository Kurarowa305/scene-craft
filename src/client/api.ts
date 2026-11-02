let csrfToken: string | undefined;
const receipts = new Map<string, string>();

export async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok)
    throw new Error(
      "記録を取得できません。接続を確認して、再読み込みしてください。",
    );
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
    if (!response.ok) {
      if (response.status === 403) csrfToken = undefined;
      throw new Error();
    }
    const result = (await response.json()) as T;
    receipts.delete(signature);
    return result;
  } catch {
    throw new Error(
      "保存結果を確認できません。入力は保持しています。同じ内容で再送すると、保存済みの記録を確認できます。",
    );
  }
}
