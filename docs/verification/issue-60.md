# Issue #60 の実装確認

対象コード: `04bc44ac93e83866cf28bd9ac6e57548316d4906`。比較元: `5d0a3ff98d123e29c165721939cc2ce0c919c5e9`。操作・manifest・公開APIは[運用資料](../implementation-60.md)。

## 自動確認

2026-11-03 JST、WSL Ubuntu / Linux `6.18.54.1-microsoft-standard-WSL2`、Node `24.19.0`、Git `2.34.1`、Playwright `1.64.1` / Chromium 156で確認。

| コマンド・境界 | 期待結果 | 実結果 |
| --- | --- | --- |
| `npm run typecheck` | クライアント・サーバーの型検査成功 | 成功 |
| `npm test` | 公開APIと保存・起動・Gitの異常系が成立 | 26件成功（#60追加8件） |
| `npm run build` | 配布するサーバーとブラウザ画面のビルド成功 | 成功 |
| `npm run test:ui` | 本物のHTTP・DB・Gitを通す画面操作と再読込が成立 | 8件成功（#60追加1件） |
| PowerShell Parser | Windowsスクリプトに構文エラーなし | 3ファイル成功。実行時確認とは区別 |
| `git diff --check` | 差分の空白エラーなし | 成功 |

変更前の最初の試験は`POST /api/versions/default`が404で失敗。実装後は別コミットの定義・作風を保持・保存し、再送と再起動後も同じ参照を返す。保持タグ競合とdangling symbolic refは409で拒否し、以前の既定を維持する。試行ブランチ削除・reflog期限切れ・GC後も保持された指示を読める。

Git blobの欠損、展開可能だがハッシュと異なる内容、非互換runtime、未対応ツール、不正manifest、外部パス・symlink、partial clone設定を拒否する。実体欠損中も原文の記録を継続できる。DB確定失敗は500とし、保持タグを残して同じ受付で再送できる。取り出し領域とファイルの書込ビットがないこと、本文がコミット済み内容であることも確認。

ブラウザ確認の画像は`test-results/versions.png`。固定済み本文の表示と開き直しをassertし、画像も目視確認した。CIでは同じ試験をPR作成・更新時に実行し、対象commit・環境・画面とtraceを既存の`verification-<sha>` Artifactへ保存する。

## Standards

独立レビュー: 明確な規約違反0件。処理と試験fixtureの重複2件が改善候補として報告され、共有の`prepare`と`gitFixture`へ整理した。最終差分の再レビューでブロッカーなし。

## Spec

独立レビュー: 版選択、不変の予定参照、タグ先行確定、互換性検査、読取専用展開、公開API・画面試験を確認。オブジェクトの内容とハッシュの照合不足はcommit/tree/blobの再計算で対応。後続の制作実行やリモートpushを利用可能と表示していない。最終差分の追加確認も行う。

## 未実施と既存の制約

Windowsショートカットからの`gitRepository`設定の実行時確認、実Codexの設定探索制限、Blender実行、GitHubへの保持タグpush・別環境fetchは未実施。これらは後続実装・実機受け入れと区別する。初期版全体の受け入れ完了ではない。

GitHub APIで確認したmainはbranch protectionなし（404）、rulesetsは空。CI自体は実行するが、必須チェックによるマージ禁止が設定済みとは報告しない。これは先行の受け入れ運用に残る既存状態であり、本変更でリポジトリ全体の保護設定を変更していない。
