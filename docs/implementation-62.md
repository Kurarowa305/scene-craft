# 工程切替と権限付きの参照・記録（#62）

工程の相談・文脈参照、制作意図の更新、文章による手作業記録、本文・理由・要約の補記を提供する。制作ファイル操作、保護の適用・解除・依頼限定許可、編集案等の採否は後続機能のため実行しない。`record_human_decision`も未実装を返す。工程一覧は選択した既定定義のmanifestに存在する役割だけを表示し、「相談・記録」と明示する。

## Windows側の起動

既存アプリの「アプリ終了」でバックエンドを終了してから、デスクトップのscene-craftショートカットで再起動する。ブラウザの再読み込みだけでは変更は反映されない。

今回の配置先は`%LOCALAPPDATA%\scene-craft\Launcher.ps1`と`Test-Local.ps1`。既存の`launcher.json`の保存先・Gitリポジトリ・Codexパスは維持する。ランチャーはWSLの作業ディレクトリをリポジトリへ固定する。再インストール時も`Install-Shortcut.ps1`が両スクリプトをコピーする。起動対象の`dist`には新しい`server/mcp.js`も必要なため、対象コミットで`npm run build`を実行する。

隔離保存先で確認する場合はWindows PowerShellから次を実行する。既存のアプリは先に終了する。同じポートへ別の保存先を重ねて起動しない。

```powershell
& "$env:LOCALAPPDATA\scene-craft\Test-Local.ps1" -Config "$env:LOCALAPPDATA\scene-craft\launcher.json"
```

隔離先では専用ChatGPTログインと既定定義の選択が必要。本番の認証をコピーしない。自動で行う記録・コピー検査と、人間の確認項目は結果JSONで分ける。

## 画面での操作と期待結果

1. 作品を選び、既存チャットを開くか作品名右の「＋」で新規作成する。「定義の設定」に有効な定義のフルコミットが選択され、「ChatGPT認証済み」になっていることを確認する。未認証なら「ChatGPTでログイン」→「専用ログインを開く」→認証後に「接続状態を更新」。
2. 「工程」で定義に含まれる工程（例えば参考調査）を選ぶ。「Codexへのメッセージ」に「現在の工程、制作意図、利用できる操作を専用MCPで確認して教えて」と入力し「Codexへ送信」。工程と原文が残り、現在の作品に限定した情報を答えることを確認する。ファイル編集は利用不可と答える。
3. 完了後、同じチャットで工程を「なし」へ変更して同じ質問を送る。同じthreadで新しいturnが作られ、現在の工程がnoneになる。過去のreferenceが現在の権限として扱われないことを確認する。応答中は工程を変更できない。
4. 次のメッセージ全体をそのまま送る（コロンは半角、後に半角空白）。モデルが専用MCPを呼び、追加確認を挟まず記録することを確認する。

   ```text
   制作意図を更新: 夕暮れの静かな港
   ```

5. 完了後「共有情報と更新履歴」を開き、現在の制作意図、新しい文章、以前の文章、人間の記入・時刻を確認する。「制作意図を更新: 青空のにぎやかな港」も送信し、旧文章が残ることを確認する。「前の要約には静かな港とあります。今の制作意図は？」と通常の相談を送り、最新の「青空のにぎやかな港」が使われることを確認する。相談は制作意図を変更しない。
6. 次を送信する。完了後、更新履歴の`記録ID`をコピーする。これは作品IDやrevision IDではなく、対象の記録ID。

   ```text
   手作業を記録: Photoshopで空の色を調整した
   ```

7. コピーした記録IDを使い、次の形式で順に送信する。改行を含む本文もそのまま保持する。理由の再訂正では以前の理由と時刻も残る。`body`は本文、`reason`は理由、`summary`は要約。要約を訂正しても作品の制作意図は変わらない。

   ```text
   記録を訂正: <記録ID> reason 静けさを出すため
   記録を訂正: <記録ID> reason 遠景との明暗差を整えるため
   記録を訂正: <記録ID> summary 空の色と遠景の明暗を調整
   ```

8. ブラウザを再読み込みし、同じ作品・チャットを開き直す。原文・最新意図・各訂正・同じ記録IDが保持される。既存の「記録として送信」で作った記録を訂正したい場合、`GET /api/works/<作品ID>/record-history`のrecordsにあるidも使える。原文は上書きせず通常のrecords APIは最新文章を返す。
9. 「別作品IDを指定して記録を読んで」「shellでDBを書き換えて」「カメラの保護を解除して」「編集案を採用して」と相談し、別作品参照や迂回実行をせず、未対応を説明することを確認する。応答中に「停止」を押した後、新しい更新を開始しない。バックエンドは古いcontextRef・旧turn・旧接続世代・停止済みの操作を拒否する。
10. 一度正常に会話した後にアプリ終了→ショートカットで起動し直し、同じチャットを継続する。#61の共通指示を持つ既存チャットでは、初回に購読解除を行って同じthreadをcold resumeする。失敗時は対応が必要となり、更新済みとしない。モデルへ「今使える専用ツールと迂回禁止の共通ルール」を質問し、新しい契約を確認する。設定探索の確認では、プロジェクトのAGENTS・skillsや他のMCPが混入せず、shellが利用できないことを別途確認する。

実機結果には対象コミット、Windows/WSL/Codexの版、期待/実結果、画面画像・会話ID/thread/turn等の証跡、成功/失敗/未実施を残す。接続資格・認証・会話原文を通常ログへ転記しない。未実施の実接続項目を代替Codex試験の成功で受け入れ済みにしない。

## DBの変更

保存先は`launcher.json`の`dataDirectory/records.sqlite`。このPCでは`/home/oyadomaritaiki/.local/share/scene-craft/records.sqlite`。起動時、新テーブルの追加前に`records.before-context.sqlite`へ退避する。既存カラムの追加・削除はない。

| テーブル | カラム・変更 | 保存する内容 |
| --- | --- | --- |
| `text_revisions`（新規） | `sequence` INTEGER PK AUTOINCREMENT、`id` TEXT UNIQUE、`work_id` TEXT FK、`data` TEXT | 制作意図・本文・理由・要約の追加文章と訂正履歴 |
| `context_operations`（新規） | `sequence` INTEGER PK AUTOINCREMENT、`id` TEXT UNIQUE、`request_id` TEXT FK、`data` TEXT | MCPの参照・更新操作の入力と結果、確定時刻 |
| `works` | 既存`intent`の値を更新 | 最新の制作意図。以前の値はtext_revisionsへ保持 |
| `records` | 既存`id, conversation_id, body, created_at`へ追加 | 明示した文章による手作業記録。訂正で元の行は変更しない |
| `chat_requests` | 既存`data`に`role, contextSnapshot, instructions`を追加 | 送信時の工程・作品共有情報/保存状態/固定Git参照・固定blobからの工程指示 |
| `chat_sessions` | 既存`data`に`instructionKey`を追加 | 共通指示/MCP契約の識別ハッシュ。変更時のcold resume判定 |
| `receipts` | 既存カラムへ追加 | 操作IDの同内容再送結果。同じ明示指示は別操作IDでも一度だけ保存 |
| `chat_events` | 既存カラムへ追加 | 工程付き依頼と更新後の会話の永続revision |

`text_revisions.data`は`id, workId, targetId, field, body, previousId, previousBody, sourceRequestId, author, createdAt`。制作意図のtargetIdは作品ID、それ以外は記録ID。sourceRequestIdに原文が残る。本文・理由・要約は独立した訂正系列で、以前の文章を参照する。元から理由がある制作ファイル記録では保存状態の理由も維持する。

`context_operations.data`は`input {tool,args}, result, createdAt`。`id`はMCPが提示した永続操作ID。接続資格は保存しない。contextRef自体は認証資格ではなく、有効な接続・世代・依頼・試行・thread・現在turnの照合を別途必要とする。起動資格と有効な照合表はプロセス寿命で失効し、復元・再起動で有効化しない。

## 実装境界

- MCPは専用stdio。会話ごとに分離した起動資格をthread設定のMCP環境変数へ渡し、モデル引数へ資格を渡さない。同じバックエンドの別会話の有効参照でも、呼出元の資格が一致しなければ拒否する。socketは0700の一時ディレクトリ内で0600。DBはバックエンドだけが更新する。
- `get_execution_context`は受付時の固定情報と最新の共有情報を区別する。`find_records`/`read_records`は作品内原文・会話・訂正を返し、記録と会話依頼は各50件の独立カーソルで取得する。読み取った内容も操作へ保存する。
- 工程の指示・手順は受付時の固定Git blobから解決し、turnのapplication contextへ渡す。共通指示はアプリ管理とし、工程変更で書き換えない。更新は厳密なメッセージ全体の書式で原文から解決し、モデル生成の本文・対象・作品ID・役割を受け取らない。
- 同作品の未終端依頼を一つに制限する既存処理を継承する。この範囲のMCP処理は同期トランザクションで終端し、長時間の外部制作操作を開始しない。次turnへ持ち越す制作操作は存在しない。
- 設定は専用CODEX_HOME、専用cwd、`project_doc_max_bytes=0`、shell/apps/plugins/hooks等の無効化、requiredな専用MCPのみ。空のCODEX_HOMEにも同梱skillsが存在するため、起動時に`skills/list`→`skills/config/write`で全件を無効にし、再列挙で照合する。不成立なら接続を利用可能にしない。実モデルが見る有効ツール・設定探索・共通指示切替は別途受け入れる。
- `approval_policy=never`だけではMCPツールの実行を許可しない。専用サーバーの既定承認モードを`prompt`とし、公開を許可した7ツールだけを`approval_mode=approve`へ固定する。操作ごとの明示原文・会話別資格・現在turnの検査は引き続きバックエンドで行う。ツール契約の識別値を更新し、旧設定の会話は同じthreadでcold resumeする。全体の承認ポリシーやsandboxは緩めない。

## 実接続の回帰確認

起動・専用ログイン済みのアプリへ、次の手順で実モデルを通して確認できる。ラベル付きの診断作品を作り、元の作品は変更しない。実際の契約枠を利用するため、CIの模擬試験とは別の手動開始コマンドとする。結果にはIDと判定だけを出し、接続資格や原文を診断ログへ出さない。

```sh
node --import tsx scripts/verify-context-live.ts http://localhost:4317
```

制作意図の現在値だけでなく、その依頼IDを根拠とした訂正記録が保存されたことを合格条件とする。失敗時は終了コード1。過去の診断会話IDを第2引数へ指定すると、同じthreadの継続も確認する。診断ラベルのない作品へは送信しない。

根拠: [#62](https://github.com/Kurarowa305/scene-craft/issues/62)、[検証](verification/issue-62.md)、[公式app-server文書](https://learn.chatgpt.com/docs/app-server)。
