import { useEffect, useState } from "react";
import { read } from "./api";
import { openReference, useReferences } from "./references";
import type {
  ScenePlan,
  ScenePlanView,
  PlanDecision,
} from "../shared/scene-plans";
export function openPlan(p: ScenePlan) {
  document.dispatchEvent(
    new CustomEvent("open-scene-plan", {
      detail: { id: p.id, title: p.title, workId: p.workId },
    }),
  );
}
export function useScenePlans(workId: string | undefined, revision: number) {
  const [view, setView] = useState<ScenePlanView>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setView(undefined);
    if (workId)
      read<ScenePlanView>(`/api/works/${workId}/scene-plans`)
        .then((v) => {
          if (active) {
            setView(v);
            setError("");
          }
        })
        .catch(() => {
          if (active) setError("シーン計画を取得できません。");
        });
    return () => {
      active = false;
    };
  }, [workId, revision]);
  return { view, error };
}
export function PlanLinks({ plans }: { plans: ScenePlan[] }) {
  return (
    <section aria-label="シーン計画のリンク">
      {plans.map((p) => (
        <button
          className="artifact-link"
          key={p.id}
          onClick={() => openPlan(p)}
        >
          {p.title} ↗
        </button>
      ))}
    </section>
  );
}
const labels = { accept: "採用", revise: "修正依頼", hold: "保留" };
function Judgment({ decisions }: { decisions: PlanDecision[] }) {
  return (
    <>
      <p>
        判断状態：
        {decisions.length ? labels[decisions.at(-1)!.action] : "未採用"}
      </p>
      {decisions.map((d) => (
        <details key={d.id}>
          <summary>
            {labels[d.action]} · 人間 ·{" "}
            {new Date(d.createdAt).toLocaleString("ja-JP")}
          </summary>
          <p className="record-body">{d.body}</p>
          <small>依頼ID：{d.requestId}</small>
        </details>
      ))}
    </>
  );
}
export function ScenePlans({
  workId,
  revision,
  planId,
}: {
  workId: string;
  revision: number;
  planId?: string;
}) {
  const { view, error } = useScenePlans(workId, revision);
  const refs = useReferences(workId, revision);
  if (!workId) return <p>作品を選んでください。</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!view) return <p>計画を読み込んでいます。</p>;
  if (!planId)
    return (
      <div className="panel-page">
        <h2>シーン計画</h2>
        <p>
          採否・修正・保留はメインチャットへ指示してください。計画の採用と仮説の採用は別です。
        </p>
        {!view.plans.length && <p>保存された計画はありません。</p>}
        <PlanLinks plans={view.plans} />
      </div>
    );
  const p = view.plans.find((p) => p.id === planId);
  if (!p) return <p>計画が見つかりません。</p>;
  const decisions = view.decisions.filter((d) => d.planId === p.id);
  const fixed = p.fixed.context as {
    work?: { intent?: string };
    references?: { selected?: { id: string; title: string }[] };
  };
  return (
    <article className="panel-page" aria-label="シーン計画の詳細">
      <h2>{p.title}</h2>
      <p>計画ID：{p.id}</p>
      <p>{new Date(p.createdAt).toLocaleString("ja-JP")}</p>
      <Judgment decisions={decisions.filter((d) => d.hypothesisId === null)} />
      <p className="record-body">{p.body}</p>
      {p.previousPlanId && (
        <button
          onClick={() => {
            const previous = view.plans.find((x) => x.id === p.previousPlanId);
            if (previous) openPlan(previous);
          }}
        >
          修正前の計画を開く
        </button>
      )}
      <h3>部品・位置関係・概寸・制作順序</h3>
      {p.parts
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((part) => (
          <section key={part.id}>
            <h4>
              {part.order}. {part.name}
            </h4>
            <p>部品ID：{part.id}</p>
            <p>位置関係：{part.placement}</p>
            <p>概寸：{part.dimensions}</p>
          </section>
        ))}
      <h3>仮説（個別に採用するまで確定条件にしません）</h3>
      {!p.hypotheses.length && <p>仮説なし</p>}
      {p.hypotheses.map((h) => (
        <section key={h.id}>
          <h4>
            {h.id}：{h.body}
          </h4>
          <p>根拠：{h.evidence}</p>
          <p>不足：{h.missing}</p>
          <Judgment
            decisions={decisions.filter((d) => d.hypothesisId === h.id)}
          />
        </section>
      ))}
      <h3>作成時の制作意図</h3>
      <p>{fixed?.work?.intent ?? "未入力"}</p>
      <h3>参照元</h3>
      {refs.error && <p role="alert">{refs.error}</p>}
      {!p.referenceIds.length && <p>参考資料の指定なし</p>}
      {p.referenceIds.map((id) => {
        const c = refs.view?.candidates.find((c) => c.id === id);
        return c ? (
          <button
            className="artifact-link"
            key={id}
            onClick={() => openReference(c)}
          >
            {c.title} ↗
          </button>
        ) : (
          <p key={id}>
            {fixed?.references?.selected?.find((c) => c.id === id)?.title ?? id}
            （参照元を取得できません）
          </p>
        );
      })}
      <details>
        <summary>固定した根拠・Git版・依頼元</summary>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {JSON.stringify({ source: p.source, fixed: p.fixed }, null, 2)}
        </pre>
      </details>
      <p>計画を保存・採用してもモデリングは起動しません。</p>
    </article>
  );
}
