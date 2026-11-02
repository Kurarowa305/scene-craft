# Issue #61の確認

2026-11-03 JST。比較元は`0b761b5`。対象コミットは本資料を含むPRのHEADとCI Artifactに記録する。操作・DB変更は[実装資料](../implementation-61.md)。

## 自動確認

WSL Ubuntu、Node 24.19.0、Git 2.34.1、Playwright 1.64.1で確認。

- 最初の公開API試験は`POST /api/conversations/:id/model`の404で失敗。実装後、会話原文・終端・モデル・runtime・thread/turn/itemの保存と再起動を確認。
- #61の12統合試験: 重複受付、選択継承と次依頼への適用、停止・再開と予算/過去本文の維持、認証失効、利用上限、モデル不在、内部再送とreroute、受付不明、全ページの履歴照合、遅延ページと終端通知の競合、空thread作成中の停止。代替するのは外部Codex境界で、HTTPと一時SQLite・Gitを通す。別途、外部プロセス境界で起動失敗・シグナル終了後のクローズを検査する。
- #61のブラウザ試験: 本番stdioアダプターを外部プロトコルfixtureに接続し、モデル選択・SSE・画面再読込・停止を確認。画像`test-results/chat.png`。代替接続の成功を実ChatGPT認証の成功としない。
- PRの既存CIで型検査・全自動試験・ビルド・全ブラウザ試験・Windowsスクリプト構文検査を実行する。

最終ローカル確認: `npm run check`が成功（自動試験39件・ブラウザ9件・型検査・ビルド）。PowerShell ParserでWindowsスクリプト3ファイルの構文検査成功、`git diff --check`成功。画面画像は目視確認した。Windows側へ`Launcher.ps1`と`Test-Local.ps1`を配置し、ランチャーのハッシュ一致を確認。既存`launcher.json`を日時付きで退避し、`codexBinary`を追加した。実起動による手動受け入れは未実施。

## Standards

独立レビューで明確な規約違反0件。改善候補のHTTP入力schema重複は`http-schema.ts`へ統合した。会話実行とHTTP/SSEを一モジュールで管理する点は整理候補として残し、今回のブロッカーとはしない。子プロセスがシグナル終了済み/起動失敗の場合にcloseが待ち続ける問題と、再開時に過去の停止要求を失う問題を修正した。外部プロセス試験と停止履歴のassertを追加し、再レビューでブロッカーなし。

## Spec

独立レビューで指摘された、履歴照合の古い応答による終端巻き戻し、初回送信前に停止した空threadの再開失敗、遅い接続状態応答がSSEの新しい表示を上書きする問題を修正した。空履歴ページの遅延と確定済み未開始の照合も含め、失敗を再現した回帰試験とrevision/世代・終端の保持で確認した。再レビューで残るブロッカーなし。範囲外の機能追加なし。

## 導入版Codexの非推論確認

WSLへCodex CLI 0.166.0を導入し、同版の`generate-json-schema --experimental`と実RPCを照合。空の隔離`CODEX_HOME`、認証コピーなし、`turn/start`なしで確認した。再実行は`node --import tsx scripts/probe-codex.ts <binary> <output>`。

`initialize`、`account/read`（未認証）、`model/list`、`thread/start`（OpenAI・read-only・paginated）が成功。instructionSourcesは0。初回送信前の空threadについて`thread/turns/list`・`thread/items/list`・`thread/resume`は拒否された。推論後の履歴とcold resumeの成功とは扱わない。取得した型ではitemページの行は`{turnId,item}`であり、実装とfixtureもこの形にした。

証跡は[evidence](evidence/issue-61-codex-contract.json)。実アカウントの上限消費・失効は起こしていない。

## 未実施

Windowsショートカットからの実ChatGPTログイン、実応答・interrupt、実送信後の全ページ履歴・cold resume、サービス側rerouteの実発生は未実施。利用者が[画面手順](../implementation-61.md#実機での画面操作と期待結果)に従って確認する。BlenderやPhotoshopをこのIssueの代替接続の成功で受け入れ済みにしない。

先行確認でGitHubのmainには必須CIチェックの保護設定がなかった。CIを実行することと、設定でマージを強制的に防ぐことは区別する。
