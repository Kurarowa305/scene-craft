import { useEffect, useState, type FormEvent } from "react";
import type {
  GitReference,
  VersionPlan,
  VersionStatus,
} from "../shared/versions";
import { read, write } from "./api";

import { versionReason } from "./version-errors";
function Reference({
  reference,
  label,
}: {
  reference: GitReference | null;
  label: string;
}) {
  return (
    <details>
      <summary>
        {label}: {reference ? reference.commit : "なし"}
      </summary>
      {reference && (
        <>
          <p>リポジトリID: {reference.repositoryId}</p>
          <p>
            形式: {reference.objectFormat} / tree: {reference.tree}
          </p>
          <p>保持タグ: {reference.tag}</p>
          <ul>
            {reference.files.map((file) => (
              <li key={file.path}>
                {file.path} / blob: {file.blob}
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}

export function VersionSettings({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState<
    (VersionStatus & { configured: boolean }) | null
  >(null);
  const [commit, setCommit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    read<VersionStatus & { configured: boolean }>("/api/versions")
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await write("/api/versions/default", { commit });
      setStatus(await read("/api/versions"));
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="version-settings">
      <h3>定義の設定</h3>
      <Reference
        label="新規依頼の既定定義"
        reference={status?.definition ?? null}
      />
      {status && !status.configured && (
        <p className="hint">Gitリポジトリ未設定</p>
      )}
      {status?.configured && !status.availability.available && (
        <p className="hint">{versionReason(status.availability.reason)}</p>
      )}
      <form onSubmit={save}>
        <label>
          定義のフルコミット
          <input
            aria-label="定義のフルコミット"
            value={commit}
            onChange={(e) => setCommit(e.target.value)}
            pattern="([a-f0-9]{40}|[a-f0-9]{64})"
            required
            disabled={busy || !status?.configured}
          />
        </label>
        <button disabled={busy || !status?.configured || !commit}>
          既定定義を保存
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      <p className="hint">
        明示して保存した版を使います。ブランチの進行では変わりません。
      </p>
    </section>
  );
}

export function WorkVersions({
  workId,
  revision,
}: {
  workId: string;
  revision: number;
}) {
  const [status, setStatus] = useState<VersionStatus | null>(null);
  const [plans, setPlans] = useState<VersionPlan[]>([]);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setStatus(null);
    setPlans([]);
    setContent("");
    setError("");
    Promise.all([
      read<VersionStatus>(`/api/works/${workId}/versions`),
      read<VersionPlan[]>(`/api/works/${workId}/version-plans`),
    ])
      .then(([next, saved]) => {
        if (active) {
          setStatus(next);
          setPlans(saved);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [workId, revision]);
  async function freeze() {
    setBusy(true);
    setError("");
    try {
      await write(`/api/works/${workId}/version-plans`, {});
      setPlans(await read(`/api/works/${workId}/version-plans`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="work-versions">
      <details>
        <summary>定義・作風の固定内容</summary>
        {status && (
          <>
            <Reference label="次の依頼の定義" reference={status.definition} />
            <Reference label="作品の作風" reference={status.style} />
            <p>
              {status.availability.available
                ? "固定内容の検査: 利用可能"
                : versionReason(status.availability.reason)}
            </p>
            <p className="hint">
              リモート保存は未確認です。制作機能は準備中です。本文・手作業の記録は続けられます。
            </p>
          </>
        )}
        <button
          disabled={busy || !status?.availability.available}
          onClick={() => void freeze()}
        >
          依頼用の参照を固定
        </button>
        <p className="hint">参照だけを保存し、制作は開始しません。</p>
        {plans.map((plan, index) => (
          <details key={plan.id}>
            <summary>固定済み参照 {index + 1}</summary>
            <Reference label="定義" reference={plan.definition} />
            <Reference label="作風" reference={plan.style} />
            {(["definition", "style"] as const).flatMap(
              (kind) =>
                plan[kind]?.files.map((file) => (
                  <button
                    key={`${kind}/${file.path}`}
                    onClick={() => {
                      void read<{ content: string }>(
                        `/api/version-plans/${plan.id}/content?kind=${kind}&path=${encodeURIComponent(file.path)}`,
                      )
                        .then((result) => setContent(result.content))
                        .catch((e) => setError(e.message));
                    }}
                  >
                    {kind}: {file.path} を読む
                  </button>
                )) ?? [],
            )}
          </details>
        ))}
        {content && <pre className="fixed-content">{content}</pre>}
        {error && <p role="alert">{error}</p>}
      </details>
    </section>
  );
}
