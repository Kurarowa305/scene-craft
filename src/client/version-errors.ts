const reasons: Record<string, string> = {
  GIT_NOT_CONFIGURED: "Gitリポジトリが未設定です。起動設定を確認してください。",
  GIT_CONTENT_UNAVAILABLE:
    "Gitの内容を読み出せません。同じリポジトリとオブジェクトを復旧してください。",
  GIT_DEFINITION_NOT_SELECTED: "設定から定義のコミットを選んでください。",
  GIT_RUNTIME_INCOMPATIBLE:
    "この定義は現在の実行基盤に対応していません。対応する版を選んでください。",
  GIT_TOOL_CONTRACT_INCOMPATIBLE:
    "この定義の文脈・ツール・操作・出力形式は現在の実行基盤に対応していません。",
  GIT_STYLE_INCOMPATIBLE:
    "作風の形式または必須条件が合いません。互換性のある作風・定義を選んでください。",
  GIT_TAG_CONFLICT:
    "保持タグが別の対象またはsymbolic refです。自動変更せず停止しました。Gitの参照を確認してください。",
  GIT_TAG_MISSING:
    "保持タグがありません。同じコミットの保持参照を復旧してください。",
  GIT_DEPENDENCY_UNRESOLVED:
    "必要なファイルが欠損しているか、リンク・submodule・LFS参照が未解決です。",
  GIT_MANIFEST_INVALID: "manifestの形式・必須項目を確認してください。",
  GIT_INCOMPLETE_HISTORY:
    "履歴が不完全です。完全なGitオブジェクトを用意してください。",
  GIT_REPOSITORY_MISMATCH:
    "保存済み参照とはリポジトリIDが異なります。元のリポジトリを復旧してください。",
};
export function versionReason(code: string | null) {
  return code
    ? (reasons[code] ??
        `Git版を利用できません（${code}）。参照と形式を確認してください。`)
    : "";
}
