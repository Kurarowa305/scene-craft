# Codexとの会話・モデル選択（#61）

この実装はテキスト会話の開始・継続、原文・応答・終端の保存、モデル選択、停止、履歴照合を提供する。工程別エージェント・制作操作・サイドチャット・命名と要約は後続Issueであり、利用可能として表示しない。

## Windowsから起動する

WSLのNode 24.19.0とCodex CLI 0.166.0を使用する。起動するコミットをビルドする。

```sh
npm run build
node dist/server/cli.js --data-dir /absolute/data --git-repository /absolute/definitions --codex-binary /absolute/bin/codex
```

Windows側の`%LOCALAPPDATA%\scene-craft\Launcher.ps1`は今回の最新版を配置する。`launcher.json`へ`codexBinary`（WSLの絶対パス）を追加する。今回のPCでは`/home/oyadomaritaiki/.nvm/versions/node/v24.19.0/bin/codex`。既存の`fileRoots`・`gitRepository`・`dataDirectory`等は維持する。`Install-Shortcut.ps1`にも`CodexBinary`・`GitRepository`・`FileRoots`を追加し、再配置時に既存の任意設定を維持する。

既にアプリが動いている場合は「アプリ終了」で終了してから、Windowsデスクトップのscene-craftショートカットで起動し直す。ブラウザの再読み込みだけではバックエンドは更新されない。

## 実機での画面操作と期待結果

1. 起動後、左の作品を選び、作品名右の「＋」からチャットを作る。既存のチャットも開ける。「定義の設定」が未選択なら#60で確認した有効な定義のフルコミットを保存する。会話送信には固定Git参照が必要。
2. 「Codexとの会話」で「ChatGPTでログイン」→「専用ログインを開く」を押し、ブラウザでChatGPT認証する。その後「接続状態を更新」で「ChatGPT認証済み」を確認する。WindowsのCodexアプリの認証はコピーしない。
3. 初回はCodexが返す利用可能な既定モデルが選ばれる。「会話モデル」「推論強度」「速度」を選び、「Codexへのメッセージ」に「港の背景を描く構想について、短く相談に乗ってください」と入力して「Codexへ送信」。原文、途中の返答、最後に「完了」が表示されることを確認する。要求モデルと実行設定のモデルを比べる。
4. 同じチャットで追加の質問を送る。`GET /api/conversations/<id>/chat`またはDBで`session.threadId`が変わらず、新しい`turnId`が増えることを確認する。モデル変更は次の依頼から適用され、前の依頼の設定は変わらない。
5. 新しいチャットを作り、直前に選んだモデル・推論強度・速度が引き継がれることを確認する。既存チャットの選択は変わらない。
6. 応答中にブラウザを閉じ、ショートカットで開き直して対象の作品・チャットを選ぶ。原文と応答が重複せず表示され、再依頼されないことを確認する。必要に応じて「履歴を照合」でCodexのturn/item全ページを取得し、保存済み履歴と照合する。
7. 長めの返答を依頼し、入力欄横の「停止」を押す。「停止中」の間は新しい依頼を送れず、終端確認後に「停止しました」となることを確認する。途中本文は保持される。完了との競合では、確認できた終端と`stopRequested`の両方を残す。
8. 停止後に「この依頼を再開」を明示的に押す。元の依頼ID・固定Git参照と過去の本文を維持し、再実行回数が増えることを確認する。同じ依頼で最大2回。認証回復・SSE再接続だけで再開しない。
9. 一度正常に会話した後、アプリ終了→ショートカットで再起動し、同じチャットの「履歴を照合」後に継続送信する。原文とIDが維持され、同じthreadをcold resumeできることを確認する。初回送信前の空threadの履歴取得・resumeは現行版で失敗するため、初回送信後を対象とする。

実アカウントの利用上限消費・資格情報失効・rerouteの強制は行わない。これらの判断は模擬試験で確認する。実機結果は対象コミット・Windows/WSL/Codex版、手順、期待/実結果、証跡、成功/失敗/未実施を記録する。`Test-Local.ps1`は隔離保存先を作り、これらの手動項目とCodex版を結果JSONへ記録する。隔離先では別途専用ログインが必要で、認証を本番保存先からコピーしない。

## DB変更

既存の`works`・`conversations`・`records`等のカラムは変更しない。起動時に`records.before-chat.sqlite`を退避してから以下の4テーブルを追加する。DBは設定した`dataDirectory/records.sqlite`。今回のPCでは`/home/oyadomaritaiki/.local/share/scene-craft/records.sqlite`。

| テーブル | カラム | 内容 |
| --- | --- | --- |
| `chat_sessions` | `conversation_id` PK/FK, `data` TEXT | 会話とCodex thread、次の依頼用のモデル選択 |
| `chat_selections` | `sequence` INTEGER PK AUTOINCREMENT, `data` TEXT | 選択順のモデル・推論強度・速度。新しい会話へ継承 |
| `chat_requests` | `sequence` INTEGER PK AUTOINCREMENT, `id` UNIQUE, `conversation_id` FK, `work_id` FK, `data` TEXT | 依頼原文、固定版、実行設定、途中/終端、停止、再開履歴 |
| `chat_events` | `sequence` INTEGER PK AUTOINCREMENT, `conversation_id` FK, `request_id` nullable FK | SSE用の永続更新順。選択・thread更新はrequest_idなし。本文は依頼の`data`に保持 |

`chat_sessions.data`: `conversationId`, `threadId`, `selection {model, effort, speed}`。

`chat_requests.data`: `id`, `conversationId`, `workId`, `body`（入力原文）, `selection`, `actualModel`, `runtime`（initializeが返す実行版）, `threadId`, `turnId`, `phase`, `stopRequested`, `error`, `terminal`, `items [{id,type,text,complete}]`, `plan`（固定Git参照）, `createdAt`, `retryCount`, `previousAttempt`, `attempts`（過去のturn・設定・本文・終端・エラー）。`actualModel`はthread開始/再開応答の有効モデルとreroute通知から記録する。モデル出力の内容から推測しない。通知されないサービス内部のルーティングを独自に証明するものではない。

既存の`receipts`へ送信・モデル変更・停止・明示再開の受付キーと結果を追加する。会話の再読込やSSE再接続は送信操作を呼ばない。

## 実行・接続の契約

- `<dataDirectory>/codex`を専用`CODEX_HOME`とし、`forced_login_method=chatgpt`・file保管・OpenAI providerを固定する。親のAPIキー・provider・接続URL・MCP・hooksの環境設定を引き継がず、専用configを起動時に管理する。認証実体は制作DBへ保存しない。資格情報はプロセスstderrやRPCエラーから画面・診断に出さない。
- 作品ごとに未解決の依頼を一つに制限する。同じ受付キーは同じ依頼を返し、異内容は409。停止はDBへ先に確定し、非同期で`turn/interrupt`する。終了未確認・受付不明では新しい開始を拒否する。
- APIキー・別provider・モデルfallbackへの経路を設けず、利用枠や残高APIを送信条件にしない。モデル不在・thread応答の不一致・`model/rerouted`を検出したら続行しない。
- 制作ツールを公開しない。read-only sandbox、外部環境なし、専用作業領域、shell/apps/plugins/hooks等を無効にする。承認・動的ツールの要求は拒否する。本物の制作権限検査・Windows補助プロセスは後続Issueの責務。
- 起動時に未終端を`unknown`として保存し、自動dispatchしない。履歴はturn/itemを全ページ取得し、IDで照合する。文字列一致だけで受付成功とみなさない。受付不明のturnが特定できない場合は不明を維持し、再送しない。
- SSEは永続revisionと保存済み全体像を返す。再接続で重複表示を避け、Last-Event-ID付きの接続では未解決turnの履歴を照合する。通信切断はモデルへの再依頼としない。

根拠: [Issue #61](https://github.com/Kurarowa305/scene-craft/issues/61)、[公式app-server文書](https://learn.chatgpt.com/docs/app-server)、[LLM接続設計](design/llm-connection.md)、[検証結果](verification/issue-61.md)。
