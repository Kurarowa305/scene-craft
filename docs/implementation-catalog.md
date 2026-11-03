# 現実装のMCP・HTTP API・DB一覧

更新日: 2026-11-03。現在の実装を確認する一覧。追加・変更・削除時は[開発フロー](agents/development-workflow.md#実装一覧の更新)に従い、実装と同じコミットまたはPRで更新する。設計上の将来機能は設計資料を参照する。

- [MCPツール](#mcpツール)
- [バックエンドHTTP API](#バックエンドhttp-api)
- [DBテーブル・物理カラム](#dbテーブル物理カラム)
- [JSON保存項目と表示用項目](#json保存項目と表示用項目)
- [ソースとの照合](#ソースとの照合)

## MCPツール

専用stdio MCPは11ツールを公開する。処理は会話別資格付きUnix socket RPCを経由し、DBを所有するバックエンドで実行する。MCPと内部RPCはHTTP APIとは別の入口。[公開定義](../src/server/mcp.ts)、[ツール一覧・認可・分岐](../src/server/context-rpc.ts)、[保存処理](../src/server/context-store.ts)。

| ツール名 | 状態 | 操作・結果 | 主なDB参照／変更 |
| --- | --- | --- | --- |
| `get_execution_context` | 実装済み | 現在依頼・工程・実行照合、固定文脈と最新共有情報、固定版、残る再実行回数、未対応操作 | works、text_revisions、chat_requests等を参照 |
| `find_records` | 実装済み | 作品内の原文履歴をページ取得。現実装はread_recordsと同じ取得処理（検索語の引数なし） | records、conversations、chat_requests、text_revisionsを参照 |
| `read_records` | 実装済み | 原文記録・会話ID・依頼・改訂を取得。記録と依頼はそれぞれ最大50件、独立カーソル | 同上 |
| `create_work_intent` | 実装済み | CREATE：新しい全文で制作意図を作成・全置換 | works.intent更新、text_revisions追加 |
| `update_work_intent` | 実装済み | UPDATE：既存意図への追記・部分編集・書き直し | 同上 |
| `create_manual_record` | 実装済み | CREATE：新規手作業文章、または明示された既存記録の全文置換 | 新規時records追加、text_revisions追加 |
| `update_manual_record` | 実装済み | UPDATE：既存手作業本文への追記・部分編集・書き直し | text_revisions追加。records原文は保持 |
| `update_work_context` | 互換用・実装済み | 制作意図の旧操作名。原文に対応したCREATE/UPDATEを実行 | works.intent更新、text_revisions追加 |
| `record_manual_work` | 互換用・実装済み | 手作業CREATEの旧操作名 | records／text_revisions追加 |
| `amend_record` | 互換用・実装済み | 指定記録の本文・旧理由・要約を訂正、本文へ追記 | text_revisions追加 |
| `record_human_decision` | 公開済み・未実装 | `FEATURE_UNAVAILABLE`を返す | 変更なし |

### MCP共通引数・保存条件

| 引数 | 型・必須性 | 内容 |
| --- | --- | --- |
| `contextRef` | string、全ツール必須 | アプリが発行した現在の依頼文脈。会話別接続資格・世代・試行・thread・現在turn・停止状態を別途照合 |
| `operationId` | string、全ツール必須 | 再送に同じIDを使用。実行時は8〜100文字の英数字・ハイフンを検査。モデルには安定したUUIDを案内 |
| `sourceRequestId` | string、書き込み操作で実行時必須 | 現在の利用者指示原文ID。公開schemaは任意プロパティだがバックエンドで一致を要求 |
| `after` | integer ≥ 0、find_records/read_recordsのみ任意、既定0 | 記録sequenceの後続カーソル |
| `afterRequests` | integer ≥ 0、同上 | 依頼sequenceの後続カーソル |

更新ツールは新本文・対象IDを引数として受け取らず、保存済みの指示原文から解決する。自然文は同じ選択モデルのツールなし解釈処理でCREATE/UPDATE・対象・本文を構造化し、UPDATEの編集元全文を保存時に照合する。手作業は作業内容と任意の理由を一つの本文として扱う。対象不明時は`{complete:false,needsClarification:true,question}`、保存確定時は`{operationId,complete:true,revision}`を返す。

成功した参照・更新操作はcontext_operationsとreceiptsに保存する。更新依頼の解釈結果はchat_requests.dataにも保存する。同じ明示指示の更新は操作IDを変えても一度だけ確定する。未実装の人間判断操作は保存しない。MCP応答のtext contentにはRPC結果の`{result:...}`または`{error:...}`をJSONで載せる。

## バックエンドHTTP API

明示登録は33操作。[基本・作品・ファイル・Git API](../src/server/app.ts)、[Codex・会話・実行API](../src/server/chat.ts)、[共通schema](../src/server/http-schema.ts)。

同一localhost originを使用する。GET/HEAD以外はOrigin・HttpOnlyセッションcookie・`x-csrf-token`・`application/json`が必要。本文上限は1MiB。POSTは`/api/shutdown`を除き`requestKey`（8〜128文字、英数字・`_`・`-`）を必須とし、表はそれ以外の入力を記載する。`:id`と`:fileId`はUUID。追加本文プロパティは拒否する。業務エラーはHTTP状態コードと`{error:コード}`を返す。`reconcile`等、schema上のrequestKeyを処理の冪等キーとして使わない操作もある。

| メソッド | パス | 入力 | 結果・副作用 |
| --- | --- | --- | --- |
| GET | `/api/roles` | なし | 既定定義の工程一覧 `{id,description}[]`。未選択は空配列 |
| GET | `/api/works/:id/context` | 作品ID | 現在の作品 `{id,name,intent}` と文章改訂 `revisions` |
| GET | `/api/works/:id/record-history` | 作品ID | 原文記録・会話ID・依頼・文章改訂・次カーソル。HTTP側は先頭ページ |
| GET | `/api/session` | なし | `{csrfToken}` とHttpOnlyセッションcookieを発行 |
| GET | `/api/instance` | `x-scene-craft-challenge`: 64桁の小文字hex | `{app,proof}`（HMAC）。`instanceSecret`設定時だけ登録 |
| GET | `/api/works` | なし | `Work[]`（確定順） |
| GET | `/api/versions` | なし | `configured, definition, style, availability, remote` |
| POST | `/api/versions/default` | `commit`：40/64桁の小文字hex | 既定定義のGit参照を選択・固定 |
| GET | `/api/works/:id/versions` | 作品ID | 新規依頼用の既定定義・作品の固定作風と利用可否 |
| GET | `/api/works/:id/version-plans` | 作品ID | 固定済み `VersionPlan[]` |
| POST | `/api/works/:id/version-plans` | 作品ID、追加本文項目なし | 現在の定義・作風を固定した `VersionPlan` |
| GET | `/api/version-plans/:id/content` | 計画ID、query `kind: definition/style`, `path`（1〜2000文字） | 固定参照から取得したファイル内容・blob等 |
| POST | `/api/works` | `name`（1〜200文字・空白のみ不可）、任意`intent`（最大20000文字）、任意`styleCommit`（commit/null） | 作成した `Work` |
| GET | `/api/works/:id/conversations` | 作品ID | `Conversation[]`（確定順） |
| POST | `/api/works/:id/conversations` | 作品ID、追加本文項目なし | 空の `Conversation` を作成 |
| GET | `/api/conversations/:id/records` | 会話ID | 最新表示の `BodyRecord[]`。元本文・旧理由を保持し現在本文を返す |
| POST | `/api/conversations/:id/records` | 会話ID、`body`（1〜200000文字・空白のみ不可） | LLMを使わず原文を記録し `BodyRecord` を返す |
| GET | `/api/file-roots` | なし | `{sources:[{id}],configured}`。実パスは返さない |
| GET | `/api/works/:id/states` | 作品ID | `{states:SavedState[],currentStateId}`。`recordBody`は表示用最新本文 |
| GET | `/api/works/:id/imports` | 作品ID | `ImportOperation[]` |
| POST | `/api/imports/:id/abandon` | 取り込み操作ID、追加本文項目なし | 明示中止した取り込み操作。照合が必要な完成実体は先に照合 |
| POST | `/api/conversations/:id/imports` | 会話ID、`body,application,beforeStateId,files`。任意`render,reason`（旧互換） | `{operationId,id,state,record}`。制作ファイルを管理下へ固定し保存状態・記録を確定 |
| GET | `/api/states/:id/files/:fileId` | 保存状態ID・ファイルID、任意query `inline=1` | 検査済み実体のダウンロード。inlineはPNG/JPEG/WebP署名検査後に画像応答 |
| POST | `/api/shutdown` | 空オブジェクト `{}`（requestKeyなし） | `{status:stopping}`。応答完了後に終了コールバック |
| GET | `/api/codex` | なし | `{configured,authenticated,runtime,models}`。未接続時も利用可否を返す |
| POST | `/api/codex/login` | 追加本文項目なし | ChatGPT専用ログインの `{authUrl}` |
| GET | `/api/conversations/:id/chat` | 会話ID | `ChatView {session,requests,revision}`。未選択なら利用可能な既定モデルを初期選択 |
| POST | `/api/conversations/:id/model` | 会話ID、`model`（最大200文字）、`effort`（最大30文字）、`speed: standard/fast` | 利用可能なモデル・強度を検査して選択を保存 |
| POST | `/api/conversations/:id/messages` | 会話ID、`body`（1〜200000文字・空白のみ不可）、任意`role`（1〜100文字、既定none） | `ChatRequest`を受付。固定文脈・版・工程で非同期実行 |
| POST | `/api/chat-requests/:id/stop` | 依頼ID、追加本文項目なし | 停止要求を保存し、非同期で実行turnを中断 |
| POST | `/api/chat-requests/:id/reconcile` | 依頼ID、追加本文項目なし | 実行履歴と照合した `ChatRequest`。処理を新規送信しない |
| POST | `/api/chat-requests/:id/resume` | 依頼ID、追加本文項目なし | 同じ依頼を明示再開した `ChatRequest`。既存の再実行上限を継承 |
| GET | `/api/conversations/:id/events` | 会話ID、任意header `Last-Event-ID` | SSE `event: chat`、`id: revision`、`data: ChatView`。15秒ごとkeepalive |

GETにはFastifyによるHEADも自動登録される。`staticRoot`設定時の静的ファイル配信もFastify pluginが登録する。これらは表の明示HTTP APIとは分けて扱う。内部Codex app-serverのJSON-RPCメソッドは、本バックエンドのHTTP APIではない。

### ファイル取り込みの入力詳細

| 項目 | 条件 |
| --- | --- |
| `body` | 1〜200000文字、空白のみ不可。作業内容と任意の理由を含む統合本文 |
| `application` | Blender / Photoshop / Other |
| `beforeStateId` | 必須。UUIDまたはnull |
| `files` | 1〜100件。各項目は`rootId`（1〜100文字）、`relativePath`（1〜2000文字）、`role`（blend/psd/preview/render）を必須とする |
| ファイル形式 | blendは.blend、psdは.psd/.psb、previewは.png/.jpg/.jpeg/.webp、renderは同画像形式または.exr/.tif/.tiff。同じrootId/relativePathの重複を拒否 |
| `render` | 任意。`stateId`・`fileId`をUUIDで指定し、作品への所属を検査 |
| `reason` | 旧API互換の任意文字列、最大20000文字。現在の入力画面は統合本文を使用 |

応答型の詳細は[作品・会話・記録](../src/shared/contracts.ts)、[会話・モデル・実行](../src/shared/chat.ts)、[ファイル・保存状態](../src/shared/files.ts)、[Git参照・固定計画](../src/shared/versions.ts)を参照する。

## DBテーブル・物理カラム

保存先はアプリの`dataDirectory/records.sqlite`。アプリ用17テーブル・60カラム。[DDL・移行・トランザクション](../src/server/store.ts)、[会話保存](../src/server/chat-store.ts)、[文章改訂](../src/server/context-store.ts)を参照する。`PRAGMA user_version`は1。追加機能の移行は対象テーブルの有無で判定し、追加前に`records.before-imports.sqlite`・`records.before-git-versions.sqlite`・`records.before-chat.sqlite`・`records.before-context.sqlite`へ退避する。

制約欄はDDLで明示したPK・UNIQUE・NOT NULL・AUTOINCREMENT・外部キーを記載する。空欄相当の「—」は明示制約なし。JSON中のキーは物理カラムには数えない。全カラムともSQL DEFAULT指定はない。外部キー検査はON、busy_timeoutは3000ms。

| テーブル | 用途 | カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- | --- | --- |
| `chat_events` | 会話更新の永続revision | `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `chat_events` | 会話更新の永続revision | `conversation_id` | TEXT | NOT NULL, FK → conversations.id | 所属会話ID |
| `chat_events` | 会話更新の永続revision | `request_id` | TEXT | FK → chat_requests.id | 更新対象の依頼ID。セッション設定の変更時はNULL |
| `chat_requests` | 依頼原文・実行状態・解釈結果 | `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `chat_requests` | 依頼原文・実行状態・解釈結果 | `id` | TEXT | NOT NULL, UNIQUE | 識別子 |
| `chat_requests` | 依頼原文・実行状態・解釈結果 | `conversation_id` | TEXT | NOT NULL, FK → conversations.id | 所属会話ID |
| `chat_requests` | 依頼原文・実行状態・解釈結果 | `work_id` | TEXT | NOT NULL, FK → works.id | 所属作品ID |
| `chat_requests` | 依頼原文・実行状態・解釈結果 | `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |
| `chat_selections` | モデル選択の引き継ぎ用履歴 | `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `chat_selections` | モデル選択の引き継ぎ用履歴 | `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |
| `chat_sessions` | 会話とCodex thread・選択設定 | `conversation_id` | TEXT | PK, FK → conversations.id | 所属会話ID |
| `chat_sessions` | 会話とCodex thread・選択設定 | `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |
| `context_operations` | 専用MCPの参照・更新操作と結果 | `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `context_operations` | 専用MCPの参照・更新操作と結果 | `id` | TEXT | NOT NULL, UNIQUE | 識別子 |
| `context_operations` | 専用MCPの参照・更新操作と結果 | `request_id` | TEXT | NOT NULL, FK → chat_requests.id | 元依頼ID |
| `context_operations` | 専用MCPの参照・更新操作と結果 | `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |
| `conversations` | 作品内の会話 | `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `conversations` | 作品内の会話 | `id` | TEXT | NOT NULL, UNIQUE | 識別子 |
| `conversations` | 作品内の会話 | `work_id` | TEXT | NOT NULL, FK → works.id | 所属作品ID |
| `conversations` | 作品内の会話 | `created_at` | TEXT | NOT NULL | 作成時刻（ISO 8601文字列） |
| `current_state_updates` | 現在保存状態の更新履歴 | `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `current_state_updates` | 現在保存状態の更新履歴 | `work_id` | TEXT | NOT NULL, FK → works.id | 所属作品ID |
| `current_state_updates` | 現在保存状態の更新履歴 | `before_id` | TEXT | — | 変更前の保存状態ID（初回はNULL） |
| `current_state_updates` | 現在保存状態の更新履歴 | `after_id` | TEXT | NOT NULL, FK → saved_states.id | 変更後の保存状態ID |
| `current_state_updates` | 現在保存状態の更新履歴 | `operation_id` | TEXT | NOT NULL, UNIQUE, FK → import_operations.id | 確定した取り込み操作ID |
| `current_states` | 作品の現在保存状態 | `work_id` | TEXT | PK, FK → works.id | 所属作品ID |
| `current_states` | 作品の現在保存状態 | `state_id` | TEXT | NOT NULL, FK → saved_states.id | 現在の保存状態ID |
| `git_settings` | 既定定義の選択履歴 | `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `git_settings` | 既定定義の選択履歴 | `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |
| `git_settings` | 既定定義の選択履歴 | `created_at` | TEXT | NOT NULL | 作成時刻（ISO 8601文字列） |
| `import_operations` | 制作ファイル取り込みの状態 | `id` | TEXT | PK | 識別子 |
| `import_operations` | 制作ファイル取り込みの状態 | `request_key` | TEXT | NOT NULL, UNIQUE | 同内容再送を識別する受付キー |
| `import_operations` | 制作ファイル取り込みの状態 | `work_id` | TEXT | NOT NULL, FK → works.id | 所属作品ID |
| `import_operations` | 制作ファイル取り込みの状態 | `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |
| `receipts` | 冪等受付の入力と確定結果 | `request_key` | TEXT | PK | 同内容再送を識別する受付キー |
| `receipts` | 冪等受付の入力と確定結果 | `content` | TEXT | NOT NULL | 受付内容のJSON文字列 |
| `receipts` | 冪等受付の入力と確定結果 | `result` | TEXT | NOT NULL | 確定応答のJSON文字列 |
| `records` | LLM不要の記録原文・手作業原文 | `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `records` | LLM不要の記録原文・手作業原文 | `id` | TEXT | NOT NULL, UNIQUE | 識別子 |
| `records` | LLM不要の記録原文・手作業原文 | `conversation_id` | TEXT | NOT NULL, FK → conversations.id | 所属会話ID |
| `records` | LLM不要の記録原文・手作業原文 | `body` | TEXT | NOT NULL | 記録の原文本文 |
| `records` | LLM不要の記録原文・手作業原文 | `created_at` | TEXT | NOT NULL | 作成時刻（ISO 8601文字列） |
| `saved_states` | 確定した制作ファイルの保存状態 | `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `saved_states` | 確定した制作ファイルの保存状態 | `id` | TEXT | NOT NULL, UNIQUE | 識別子 |
| `saved_states` | 確定した制作ファイルの保存状態 | `work_id` | TEXT | NOT NULL, FK → works.id | 所属作品ID |
| `saved_states` | 確定した制作ファイルの保存状態 | `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |
| `text_revisions` | 制作意図・手作業文章・要約等の改訂 | `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `text_revisions` | 制作意図・手作業文章・要約等の改訂 | `id` | TEXT | NOT NULL, UNIQUE | 識別子 |
| `text_revisions` | 制作意図・手作業文章・要約等の改訂 | `work_id` | TEXT | NOT NULL, FK → works.id | 所属作品ID |
| `text_revisions` | 制作意図・手作業文章・要約等の改訂 | `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |
| `version_plans` | 依頼用の固定Git参照 | `id` | TEXT | PK | 識別子 |
| `version_plans` | 依頼用の固定Git参照 | `work_id` | TEXT | NOT NULL, FK → works.id | 所属作品ID |
| `version_plans` | 依頼用の固定Git参照 | `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |
| `work_git` | 作品作成時の定義・作風参照 | `work_id` | TEXT | PK, FK → works.id | 所属作品ID |
| `work_git` | 作品作成時の定義・作風参照 | `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |
| `works` | 作品の現在値 | `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `works` | 作品の現在値 | `id` | TEXT | NOT NULL, UNIQUE | 識別子 |
| `works` | 作品の現在値 | `name` | TEXT | NOT NULL | 作品名 |
| `works` | 作品の現在値 | `intent` | TEXT | — | 現在の制作意図（未入力はNULL） |
| `works` | 作品の現在値 | `created_at` | TEXT | NOT NULL | 作成時刻（ISO 8601文字列） |

追加の明示インデックスは`conversations_work(work_id,sequence)`、`records_conversation(conversation_id,sequence)`、`text_revisions_work(work_id,sequence)`。PK/UNIQUE用の自動インデックスはSQLiteが管理する。SQLite内部の`sqlite_sequence(name,seq)`はAUTOINCREMENT連番を保持し、アプリ用テーブル数に含めない。

## JSON保存項目と表示用項目

`data`等はTEXTカラムにJSONを保存する。以下はJSON内の項目であり、新しい物理カラムではない。旧データで任意項目が欠けている場合もある。

| 保存場所 | 保存項目・構造 | 根拠 |
| --- | --- | --- |
| `receipts.content` / `result` | 操作種別・対象・入力を含む配列／確定応答。同じキーの異内容はREQUEST_KEY_CONFLICT | store.ts のonce |
| `git_settings.data` | GitReference | shared/versions.ts |
| `work_git.data` | `definition, style`（GitReference/null） | store.ts |
| `version_plans.data` | `id,workId,definition,style,createdAt` | VersionPlan |
| `import_operations.data` | `id,requestKey,workId,conversationId,stateId,input,phase,error,createdAt`、任意`completionHash`。phaseはplanned/incomplete/reconciling/committed/abandoned | ImportOperation |
| `saved_states.data` | `id,workId,recordId,beforeStateId,changeKind,application,reason,render,historyBeforeImport,files,missing,createdAt`。changeKindはimport/manual、historyBeforeImportはunknown/recorded | SavedState |
| `chat_sessions.data` | `conversationId,threadId,selection`、任意`instructionKey`（共通指示の識別hash） | ChatSession |
| `chat_selections.data` | ModelChoice：`model,effort,speed`（standard/fast） | chat-store.ts |
| `chat_requests.data` | `id,conversationId,workId,body,selection,actualModel,runtime,threadId,turnId,phase,stopRequested,error,terminal,items,plan,createdAt,retryCount,previousAttempt,attempts`、任意`role,contextSnapshot,instructions,recordInterpretation` | ChatRequest |
| `chat_requests.data.attempts[]` | `stopRequested,turnId,selection,actualModel,runtime,terminal,error,items`。itemsは`id,type,text,complete` | ChatRequest / ChatItem |
| `chat_requests.data.recordInterpretation` | `sourceHash,model,runtime,threadId,turnId,status,instruction,question`。statusはupdate/not_requested/clarification | shared/record-instruction.ts |
| `…recordInterpretation.instruction` | `tool,field,body`、任意`action,mode,baseText,targetId`。actionはcreate/update、modeはreplace/append/edit。自然文UPDATEはbaseTextで編集元全文を固定 | RecordInstruction |
| `text_revisions.data` | `id,workId,targetId,field,body,previousId,previousBody,sourceRequestId,author,createdAt`、任意`action,mode,addedText,format`。body/previousBodyは変更後/前の全文。formatはunified-record-v1 | TextRevision |
| `context_operations.data` | `input:{tool,args},result,createdAt`。接続資格は保存しない | store.ts のcontextOperation |

GitReferenceは`repositoryId,objectFormat,commit,tree,tag,manifest,files[{path,blob}]`。SavedStateのfilesは`id,rootId,relativePath,role,source{rootId,relativePath},size,sha256`、missingは`source,reason`（not_found/cycle/outside_root/inspection_pending）。保存済みrenderは`{stateId,fileId}`またはnull。ImportOperation.inputは上記取り込みAPIの入力。ChatRequest.phaseはaccepted/running/stopping/completed/interrupted/blocked/unknown、planはVersionPlan、selectionはModelChoice。contextSnapshotは受付時の作品・文章改訂・保存状態・固定計画・作風、instructionsは固定Git blob由来の工程指示。

通常表示ではrecords原文と改訂を重ね、旧理由も統合本文として返す。`BodyRecord.originalBody/reason/summary`、`SavedState.recordBody`、`Work.style/plannedDefinition`、`Conversation.title`等は読み取り時に付加する表示項目。これらの名前の物理カラムはない。新しい全文への置換後に旧理由を再付加しない。

## ソースとの照合

更新時は次を確認する。更新の必須条件は[開発フロー](agents/development-workflow.md#実装一覧の更新)を正とする。

1. MCP：contextTools、mcp.tsのtools/list、context-rpc.tsの分岐・引数検査を照合する。互換名と未実装公開ツールも載せる。
2. HTTP：app.tsとchat.tsの全ルートを照合する。ループ生成のstop/reconcile/resume、条件付きinstance、SSE、schemaと応答を確認する。
3. DB：store.tsの全CREATE/ALTER・移行を確認し、新規の隔離保存先で生成したDBのsqlite_master、PRAGMA table_info / foreign_key_list / index_listと照合する。既存の制作DBを検証用に変更しない。
4. JSON：sharedの型と各保存処理を照合し、保存項目と表示時だけ付加する項目を区別する。APIレスポンスだけから物理カラムを推定しない。
