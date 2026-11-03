# Issue #62の検証

2026-11-03 JST。比較元`b35fb78`。対象コミットは本資料を含むPRのHEADとCI Artifactから識別する。[実装・Windows操作・DB変更](../implementation-62.md)。

## 自動検証

- 最初の公開操作試験は、工程を指定したメッセージ送信が`INVALID_INPUT`で失敗することを確認後に実装した。実装後、同じthreadでreference→noneを切り替え、受付工程を保持する。
- HTTPから一時SQLiteへの確定と専用stdio MCP→実Unix socket RPCを通して、制作意図更新、文章の手作業記録、理由補記、同一指示の重複排除、旧参照、停止、作品/役割偽装、原文と現在値、別作品参照拒否、要約からの更新拒否、未実装の採否とshell拒否、操作ID異内容再送を検査する。外部Codexだけをprotocol fixtureへ代替し、保存・権限処理は製品経路を通す。
- ブラウザ試験で工程選択・再読込後の固定工程表示・noneへの切替・意図更新・共有情報と履歴表示までを確認する。専用MCPは製品のビルドを起動する。画像は`test-results/chat.png`。

## 導入済みCodexの非推論確認

Node 24.19.0、Codex CLI 0.166.0。`generate-json-schema --experimental`でTurnStartParamsの`additionalContext`（application種別）とThreadUnsubscribeResponseを確認した。

`npm run build`後、`node --import tsx scripts/probe-context.ts <Codex絶対パス> <結果JSON>`を実行。空の隔離CODEX_HOMEで認証をコピーせず、`thread/start`と`mcpServerStatus/list`を実行した。会話ごとのMCP資格を設定したrequiredな専用MCPが起動し、7ツールを列挙でき、instructionSourcesは0だった。同梱skills5件は無効化後の`skills/list`で有効0件と照合した。資格は出力へ含めない。[保存した証跡](evidence/issue-62-codex-contract.json)。

この確認はturn/start・推論を行っていない。同じthreadでの実工程切替、共通指示変更後のcold resume、モデルからのツール往復と迂回禁止の成立はWindows実機確認へ残す。型・起動成功をこれらの合格としない。

## 実機確認

未実施。利用者がWindowsで[操作手順](../implementation-62.md)を実施する。`Test-Local.ps1`に工程切替・専用MCP、明示記録・訂正、設定探索制限・cold resumeの手動項目を追加した。結果JSONにはコミット・環境・期待/実結果・証跡・状態とランチャーハッシュを記録する。

保護の実適用・解除、編集案の採否、制作ファイル操作は後続機能として拒否する。未実装機能を利用可能と表示しない。

## Standards

独立レビューで、同梱skillsが暗黙に有効なまま残る点を指摘された。専用CODEX_HOME内で明示無効化し実RPCで有効0件を確認した。ツール名の複数箇所での定義は改善候補であり、今回の公開一覧は一致している。

## Spec

独立レビューで、通常画面の更新不足、遅い共有情報GETによる巻き戻し、固定作風の本文未提供を指摘された。親画面とファイルカードを最新文章へ更新し、取得順と会話revisionで古い応答を無視し、固定Git blobの作風本文を実行文脈へ追加した。画面競合試験と固定作風参照・ファイル理由の訂正/再起動試験を追加した。別会話の有効な参照も接続資格不一致で拒否する試験を追加した。
