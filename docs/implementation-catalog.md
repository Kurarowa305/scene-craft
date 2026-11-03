# 現実装のMCP・HTTP API・DB一覧

更新日: 2026-11-04。現在の実装を確認する一覧。追加・変更・削除時は[開発フロー](agents/development-workflow.md#実装一覧の更新)に従い、実装と同じコミットまたはPRで更新する。設計上の将来機能は設計資料を参照する。

- [MCPツール](#mcpツール)
- [バックエンドHTTP API](#バックエンドhttp-api)
- [DBテーブル・物理カラム](#dbテーブル物理カラム)
  - [テーブル一覧](#テーブル一覧)
  - [テーブルごとのカラム一覧](#テーブルごとのカラム一覧)
- [ソースとの照合](#ソースとの照合)

## MCPツール

専用stdio MCPはメインに11ツール、サイドチャットに参照専用3ツール（`get_execution_context/find_records/read_records`）を公開する。サイドの接続設定・stdio公開一覧を絞り、バックエンドでも更新・制作・採否・保護・メイン受け渡し・shell等を拒否する。処理は会話別資格付きUnix socket RPCを経由し、DBを所有するバックエンドで実行する。MCPと内部RPCはHTTP APIとは別の入口。[公開定義](../src/server/mcp.ts)、[ツール一覧・認可・分岐](../src/server/context-rpc.ts)、[保存処理](../src/server/context-store.ts)。

| ツール名 | 状態 | 操作・結果 | 主なDB参照／変更 |
| --- | --- | --- | --- |
| `get_execution_context` | 実装済み | 現在依頼・工程・実行照合、固定文脈と最新共有情報、選択済み参考資料（参考工程では全候補も）、作品内の訂正後要約・未要約原文、固定版、残る再実行回数、未対応操作 | works、text_revisions、chat_requests、records、summary_revisions等を参照 |
| `find_records` | 実装済み | 作品内の原文履歴をページ取得。現実装はread_recordsと同じ取得処理（検索語の引数なし） | records、conversations、chat_requests、text_revisionsを参照 |
| `read_records` | 実装済み | 原文記録・会話ID・依頼・改訂を取得。記録と依頼はそれぞれ最大50件、独立カーソル | 同上 |
| `create_work_intent` | 実装済み | CREATE：新しい全文で制作意図を作成・全置換 | works.intent更新、text_revisions追加 |
| `update_work_intent` | 実装済み | UPDATE：既存意図への追記・部分編集・書き直し | 同上 |
| `create_manual_record` | 実装済み | CREATE：新規手作業文章、または明示された既存記録の全文置換 | 新規時records追加、text_revisions追加 |
| `update_manual_record` | 実装済み | UPDATE：既存手作業本文への追記・部分編集・書き直し。省略入力で指定した要約・旧理由の訂正もこのツールで処理 | text_revisions追加。records原文は保持 |
| `fetch_reference_page` | 実装済み・参考工程のみ | 公開URLを取得し、目的・取得先・確認日時・本文・hashまたは失敗を固定 | reference_pages追加、context_operations・receipts追加 |
| `save_reference` | 実装済み・参考工程のみ | 取得済みページから候補を保存。出典・参考要素・意図との関係と条件根拠を保持。利用条件を情報として記録（不明も保持）。imageUrlがあれば保存条件の調査なしで取得し、検査成功したPNG/JPEG/WebPを管理ルートへ固定 | reference_pages参照、reference_candidates追加、context_operations・receipts追加 |
| `select_reference` | 実装済み・メインのみ | 現在の人間原文全文と作品内候補を、同じ選択モデルのツールなし解釈threadへ渡して直接の参考選択を判定。対象が一致するときだけ参考として選択。曖昧・否定・質問・翻訳依頼等は保存せず確認待ち。原文に任意理由を含めて保持し、未選択は不採用にしない | reference_candidates参照、reference_selections追加、context_operations・receipts追加 |
| `record_human_decision` | 公開済み・未実装 | `FEATURE_UNAVAILABLE`を返す | 変更なし |

### 参考調査MCPの引数・取得契約

全操作でcontextRef/operationIdが必須。fetch_reference_pageは`url,purpose`、save_referenceは`pageId,title,element,intentRelation,usageTerms`が必須、任意`author,imageUrl,usagePageId,usageQuote`。select_referenceは`referenceId,sourceRequestId`が必須。URLは最大4000文字、タイトル/作者は500文字、IDは100文字、参考要素等は20000文字。未知の引数は拒否する。

ページ取得は`{complete,page,purpose}`、候補保存は`{complete:true,candidate,link}`、選択は`{complete:true,selection}`または確認待ち。ページは最大1MiB、本文はテキスト化後最大100000文字、画像は8MiB・1600万画素まで、Sharp 0.35.5で全画素をデコードして破損/切断を検査（5秒上限、アニメーションは全フレームの合計画素数）。12秒の取得制限、最大5回のリダイレクト、各接続のDNS検査と検査済みアドレスへの固定を行う。localhost・プライベートIP・認証付きURL・80/443以外のポート等は拒否。取得先に認証情報を送らず、本文は実行しない。

参考画像は趣味の参考調査として保存し、保存条件の調査や許可引用を要求しない。利用条件はusageTermsへ記録し、不明なら不明と残す。任意のusagePageId/usageQuoteは同じ作品の取得済みページと本文内引用を照合する。管理下ルートが未設定なら画像未保持。画像取得と利用条件の判明を分離する。制作素材への用途変更時は別途条件を確認する。実体は`managed/reference-images/<candidate-id>`へ固定し、読出時にサイズ/hashを検査する。欠落・破損でも候補・本文・選択を保持する。

取得中も停止・現在turn・試行を検査し、停止後は候補や選択を確定しない。ページ取得中の停止結果だけをreference_pagesへ残す。操作IDの同一内容再送は外部再取得なしで同じ確定結果を返す。異内容再送は拒否。参考工程のthread/start/resumeだけ`web_search=live`、工程なし・他工程・サイドはdisabled。組込Web検索はMCPではなくCodexのitem通知/履歴から記録する。

### MCP共通引数・保存条件

| 引数 | 型・必須性 | 内容 |
| --- | --- | --- |
| `contextRef` | string、全ツール必須 | アプリが発行した現在の依頼文脈。会話別接続資格・世代・試行・thread・現在turn・停止状態を別途照合 |
| `operationId` | string、全ツール必須 | 再送に同じIDを使用。実行時は8〜100文字の英数字・ハイフンを検査。モデルには安定したUUIDを案内 |
| `sourceRequestId` | string、制作意図・手作業更新とselect_referenceで実行時必須 | 現在の利用者指示原文ID。制作意図・手作業のschemaでは任意だが実行時一致を要求。select_referenceはschemaでも必須。fetch_reference_page/save_referenceでは受け付けない |
| `after` | integer ≥ 0、find_records/read_recordsのみ任意、既定0 | メインは記録sequence、サイドは固定配列の後続オフセット |
| `afterRequests` | integer ≥ 0、同上 | メインは依頼sequence、サイドは固定配列の後続オフセット |

制作意図・手作業の更新ツールは新本文・対象IDを引数として受け取らず、保存済みの指示原文から解決する。自然文は同じ選択モデルのツールなし解釈処理でCREATE/UPDATE・対象・本文を構造化し、UPDATEの編集元全文を保存時に照合する。手作業は作業内容と任意の理由を一つの本文として扱う。対象不明時は`{complete:false,needsClarification:true,question}`、保存確定時は`{operationId,complete:true,revision}`を返す。

成功した参照・更新操作はcontext_operationsとreceiptsに保存する。更新依頼の解釈結果はchat_requests.dataにも保存する。同じ明示指示の更新は操作IDを変えても一度だけ確定する。未実装の人間判断操作は保存しない。MCP応答のtext contentにはRPC結果の`{result:...}`または`{error:...}`をJSONで載せる。

サイドの`get_execution_context`は`requestId,role:consultation,fixed:SideReference,execution,plan,readOnly:true`を返す。開始時の作品情報・作風・現在保存状態ID・選択成果物のID/hash・最後のメイン原文の最大4000文字の抜粋・履歴件数だけを渡す。全原文と過去のsnapshotは各turnへ展開しない。最新共有情報・後続のメイン発言を追加しない。`find_records/read_records`は開始時の固定履歴から各50件まで返し、`fixedAt`を付ける。取得結果は`context_operations`に保存。メインの履歴検索・共有要約からサイド会話を除外し、自動的な依頼受け渡しを作らない。

## バックエンドHTTP API

明示登録は47操作。表はパスの辞書順、同一パスはメソッド順（GET→POST）で並べる。追加時も該当パスの位置へ行を挿入する。[基本・作品・ファイル・Git API](../src/server/app.ts)、[Codex・会話・実行API](../src/server/chat.ts)、[共通schema](../src/server/http-schema.ts)、[ブラウザー制作ファイル添付](../src/server/attachments.ts)、[会話画像](../src/server/chat-images.ts)。

同一localhost originを使用する。GET/HEAD以外はOrigin・HttpOnlyセッションcookie・`x-csrf-token`が必要。通常は`application/json`、本文上限1MiB。制作ファイル受け渡しと会話画像アップロードは`application/octet-stream`。前者は最大8GiB、後者は最大20MiB。POSTは`/api/shutdown`と制作ファイル／会話画像のアップロードを除き`requestKey`（8〜128文字、英数字・`_`・`-`）を必須とし、表はそれ以外の入力を記載する。`:id`・`:fileId`・`:imageId`はUUID。追加本文プロパティは拒否する。業務エラーはHTTP状態コードと`{error:コード}`を返す。`reconcile`等、schema上のrequestKeyを処理の冪等キーとして使わない操作もある。

| メソッド | パス | 入力 | 結果・副作用 |
| --- | --- | --- | --- |
| POST | `/api/auxiliary/model` | `model`（1〜200文字・空白のみ不可） | 実モデル一覧で存在確認し全会話共通の命名・要約モデルを保存。初期値`gpt-6-luna`。受付済み補助処理のモデルは変更しない |
| POST | `/api/chat-requests/:id/reconcile` | 依頼ID、追加本文項目なし | 実行履歴と照合した `ChatRequest`。処理を新規送信しない |
| POST | `/api/chat-requests/:id/resume` | 依頼ID、追加本文項目なし | 同じ依頼を明示再開した `ChatRequest`。既存の再実行上限を継承 |
| POST | `/api/chat-requests/:id/stop` | 依頼ID、追加本文項目なし | 停止要求を保存し、非同期で実行turnを中断 |
| GET | `/api/codex` | なし | `{configured,authenticated,runtime,models}`。未接続時も利用可否を返す |
| POST | `/api/codex/login` | 追加本文項目なし | ChatGPT専用ログインの `{authUrl}` |
| POST | `/api/conversations/:id/attachments/:fileId` | メイン会話ID・添付UUID、query `name`（最大240文字かつUTF-8 240 bytes、区切り・制御文字・非対応拡張子拒否）、binary本文（1 byte〜8GiB）。requestKeyなし、添付UUIDが再送識別子 | ファイル領域設定時だけ登録。`{file:SourceFile,size,sha256}`。DB変更なし、会話の存在と相談専用制限を検査。同じID・名前・bytesは同じ応答、異内容409、処理中の同じIDは409。部分受信は公開しない。絶対パスは受け付けず返さない |
| POST | `/api/conversations/:id/auxiliary/resume` | 会話ID、追加本文項目なし | 通常完了した最新依頼で、失敗等の命名・未要約分を明示再実行。停止・エラー・未確定の依頼では拒否。同一requestKeyの再送は重複起動しない。停止した制作依頼は既存resumeまたは新しい依頼で再開 |
| GET | `/api/conversations/:id/chat` | 会話ID | `ChatView {session,requests,revision,auxiliary,sideNames}`。補助モデル設定・会話名・処理履歴・根拠付き要約・未要約原文を含む。`sideNames`は配下サイドの会話ID→現在名/nullの表示用辞書。未選択なら利用可能な既定モデルを初期選択 |
| GET | `/api/conversations/:id/events` | 会話ID、任意header `Last-Event-ID` | SSE `event: chat`、`id: revision`、`data: ChatView`。15秒ごとkeepalive。サイドの命名等でもメインのrevisionを進めて`sideNames`を配信し、閉じたサイドごとの接続を作らず一覧名を更新 |
| GET | `/api/conversations/:id/images/:imageId` | 会話ID・画像UUID | 会話内に固定されたPNG/JPEG/WebP画像の原本を正しいMIMEでinline返却。メタデータとSHA-256を照合。別会話・不存在404、変更検出409。絶対パスは返さない |
| POST | `/api/conversations/:id/images/:imageId` | 会話ID・画像UUID、query `name`（最大240文字・UTF-8 240 bytes、区切り／制御文字禁止、.png/.jpg/.jpeg/.webp）、binary本文最大20MiB、requestKeyなし | `ChatImage {id,name,mime,size,sha256,width,height}`。sharpでデコード・実形式・拡張子一致・20,000,000画素以下・静止画を検査（APNGはacTLチャンクで明示拒否）。空・破損・非対応400、容量超過413。同じID／内容は同じ応答、異内容409。全体4アップロードまで、同ID処理中409。制作ファイル領域未設定でも登録し、records/saved_statesを増やさない |
| POST | `/api/conversations/:id/images/:imageId/remove` | 会話ID・画像UUID、追加本文項目なし | 未送信画像の原本とreceiptを削除し`{removed:true}`。不存在404。受付処理中・メッセージ参照済みは409。requestKeyはschema必須だが削除の冪等キーには使わない |
| POST | `/api/conversations/:id/imports` | 会話ID、`body,application,beforeStateId,files`。任意`render,reason`（旧互換） | `{operationId,id,state,record}`。制作ファイルを管理下へ固定し保存状態・記録を確定。サイド会話では403。`browser_uploads`参照は当該会話の受け渡し済み添付だけ許可し、確定後に受け渡し用実体を除去 |
| POST | `/api/conversations/:id/messages` | 会話ID、`body`（0〜200000文字）、任意`role`（1〜100文字、既定none）・`imageIds`（重複なしの画像UUID配列、最大5件） | `ChatRequest`を受付。本文に空白以外があるか画像1枚以上が必要。会話内画像を参照し、合計40MiB以下を検査して画像メタデータを受付時に固定。Codex turn/startに本文textと画像localImageを渡し、再開でも原本／SHA-256を照合。固定文脈・版・工程で非同期実行。サイドは工程consultationのみ（省略時自動適用）、開始時の版・文脈を継続しメインとは別thread。メインと並行受付可能、同じサイド内の未確定依頼は拒否 |
| POST | `/api/conversations/:id/model` | 会話ID、`model`（最大200文字）、`effort`（最大30文字）、`speed: standard/fast` | 利用可能なモデル・強度を検査して選択を保存 |
| POST | `/api/conversations/:id/name` | 会話ID、`name`（1〜100文字・空白のみ不可） | 人間の会話名を保存。後着の自動命名では上書きしない |
| GET | `/api/conversations/:id/records` | 会話ID | 最新表示の `BodyRecord[]`。元本文・旧理由を保持し現在本文を返す |
| POST | `/api/conversations/:id/records` | 会話ID、`body`（1〜200000文字・空白のみ不可） | LLMを使わず原文を記録し `BodyRecord` を返す。サイド会話では403 |
| GET | `/api/conversations/:id/side-chats` | メイン会話ID | 保存済みの`SideChatView[]`。`conversation_names`から現在の`title`（未命名はnull）を付加する。タブ閉鎖では削除・停止しない |
| POST | `/api/conversations/:id/side-chats` | メイン会話ID、`selectedStateIds`（重複なしUUID配列、0〜50件） | 話題入力なしで開始文脈・メイン原文・選択成果物・版を固定し相談会話を作成。同じrequestKeyは同じ会話。別作品の保存状態は拒否。LLMはまだ呼ばない |
| GET | `/api/conversations/:id/side-context` | サイド会話ID | 保存済みの開始参照`SideChat`。存在しなければ404 |
| POST | `/api/conversations/:id/summaries/:summaryId` | 会話IDと要約改訂ID（UUID）、`body`（1〜200000文字・空白のみ不可） | LLMなしで人間の訂正を追加。旧要約・根拠原文・作成者と時刻・訂正元を保持。別会話の要約は404、既に訂正済みの版は409 |
| GET | `/api/file-roots` | なし | `{sources:[{id}],configured}`。実パスは返さない |
| POST | `/api/imports/:id/abandon` | 取り込み操作ID、追加本文項目なし | 明示中止した取り込み操作。照合が必要な完成実体は先に照合 |
| GET | `/api/instance` | `x-scene-craft-challenge`: 64桁の小文字hex | `{app,proof}`（HMAC）。`instanceSecret`設定時だけ登録 |
| GET | `/api/references/:id` | 参考候補ID | `{candidate,page,selections}`。保存本文・出典・確認日・画像保持条件・人間の選択原文 |
| GET | `/api/references/:id/image` | 参考候補ID | 保存済み画像をサイズ/hash検査してPNG/JPEG/WebPで返す。未保持/欠落404、破損409、保存未設定409 |
| GET | `/api/roles` | なし | 既定定義の工程一覧 `{id,description}[]`。未選択は空配列 |
| GET | `/api/session` | なし | `{csrfToken}` とHttpOnlyセッションcookieを発行 |
| POST | `/api/shutdown` | 空オブジェクト `{}`（requestKeyなし） | `{status:stopping}`。応答完了後に終了コールバック |
| GET | `/api/states/:id/files/:fileId` | 保存状態ID・ファイルID、任意query `inline=1` | 検査済み実体のダウンロード。inlineはPNG/JPEG/WebP署名検査後に画像応答 |
| GET | `/api/version-plans/:id/content` | 計画ID、query `kind: definition/style`, `path`（1〜2000文字） | 固定参照から取得したファイル内容・blob等 |
| GET | `/api/versions` | なし | `configured, definition, style, availability, remote` |
| POST | `/api/versions/default` | `commit`：40/64桁の小文字hex | 既定定義のGit参照を選択・固定 |
| GET | `/api/works` | なし | `Work[]`（確定順） |
| POST | `/api/works` | `name`（1〜200文字・空白のみ不可）、任意`intent`（最大20000文字）、任意`styleCommit`（commit/null） | 作成した `Work` |
| GET | `/api/works/:id/context` | 作品ID | 現在の作品 `{id,name,intent}` と文章改訂 `revisions` |
| GET | `/api/works/:id/conversations` | 作品ID | メインの`Conversation[]`（確定順）。サイドは専用一覧で返す |
| POST | `/api/works/:id/conversations` | 作品ID、追加本文項目なし | 空の `Conversation` を作成 |
| GET | `/api/works/:id/imports` | 作品ID | `ImportOperation[]` |
| GET | `/api/works/:id/record-history` | 作品ID | 原文記録・会話ID・依頼・文章改訂・次カーソル。HTTP側は先頭ページ |
| GET | `/api/works/:id/references` | 作品ID | `ReferenceView {searches,pages,candidates,selections}`。全候補と選択履歴。存在しない作品404 |
| GET | `/api/works/:id/states` | 作品ID | `{states:SavedState[],currentStateId}`。`recordBody`は表示用最新本文 |
| GET | `/api/works/:id/version-plans` | 作品ID | 固定済み `VersionPlan[]` |
| POST | `/api/works/:id/version-plans` | 作品ID、追加本文項目なし | 現在の定義・作風を固定した `VersionPlan` |
| GET | `/api/works/:id/versions` | 作品ID | 新規依頼用の既定定義・作品の固定作風と利用可否 |

GETにはFastifyによるHEADも自動登録される。`staticRoot`設定時の静的ファイル配信もFastify pluginが登録する。これらは表の明示HTTP APIとは分けて扱う。内部Codex app-serverのJSON-RPCメソッドは、本バックエンドのHTTP APIではない。

### ブラウザーからの添付受け渡し

受け渡し用の実体と再送照合用receiptは`dataDirectory/browser-uploads/<conversation-id>/<attachment-id>/`へ固定する。`receipt.json`は`file {rootId,relativePath,role}`・size・sha256を保持し、DBテーブルは追加しない。`browser_uploads`は予約ルートIDで、設定された取り込み元一覧には追加表示しない。対応形式は.blend、.psd/.psb、.png/.jpg/.jpeg/.webp、.exr/.tif/.tiff。依存ファイルの自動探索・プレビュー生成を受け渡し完了とは扱わない。

受信中は同じ会話配下の一時ディレクトリへ書き、size/hashとreceiptを確定してから公開する。中断・失敗の一時領域は当該要求の終了時に除去する。取り込みのDB確定後に受け渡し用の実体を削除し、再送の照合に使うreceiptは保持する。取り込み前に画面を閉じた添付・実行プロセスの強制終了で残った一時領域は自動削除しない。これらを制作の保存状態として表示しない。バックアップ・全体削除の運用は後続Issueの範囲とする。

### 会話用の画像添付

画像は`dataDirectory/chat-images/<conversation-id>/<image-id>/original.<png|jpeg|webp>`と`receipt.json`へ、デコード検査後に一時ディレクトリから原子的に公開する。receiptは`ChatImage`の項目を保持する。実体とreceiptは0400、ディレクトリは0700。新規DBテーブルはなく、受付後の画像参照は`chat_requests.data.images[]`に固定する。送信済み画像は会話履歴・再開に必要なため削除APIでは削除できない。入力欄で取り外した未送信画像は削除する。受信失敗・通常終了時の一時領域は除去する。ブラウザを閉じて放棄された未送信画像と強制終了で残った一時領域の自動整理は追加していない。

クライアントは選択直後に入力欄へ画像プレビューを表示し、送信受付後はユーザー発言本文の直上に画像リンク付きプレビューを表示する。画像だけでも送信できる。アップロード失敗時は同じ画像ID・Fileを保持して再試行でき、アプリ内の会話切替でも未送信画像を保持する。未送信画像はブラウザメモリ保持であり、ページ再読み込みで入力欄へ復元しない。確定した画像履歴は再読み込み・サーバー再起動後も読み出せる。LLMの推論とは独立した原本アップロードで、成果物登録・採用状態・手作業記録を変更しない。

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

保存先はアプリの`dataDirectory/records.sqlite`。アプリ用27テーブル・101カラム。[DDL・移行・トランザクション](../src/server/store.ts)、[会話保存](../src/server/chat-store.ts)、[文章改訂](../src/server/context-store.ts)を参照する。`PRAGMA user_version`は1。追加機能の移行は対象テーブルの有無で判定し、追加前に`records.before-imports.sqlite`・`records.before-git-versions.sqlite`・`records.before-chat.sqlite`・`records.before-context.sqlite`・`records.before-auxiliary.sqlite`・`records.before-side-chats.sqlite`・`records.before-references.sqlite`へ退避する。

制約欄はDDLで明示したPK・UNIQUE・NOT NULL・AUTOINCREMENT・外部キーを記載する。空欄相当の「—」は明示制約なし。JSON中のキーは物理カラムには数えない。全カラムともSQL DEFAULT指定はない。外部キー検査はON、busy_timeoutは3000ms。

### テーブル一覧

テーブル名順に並べる。カラムとJSON項目は各テーブルの詳細へ記載する。

| テーブル | 用途 | 詳細 |
| --- | --- | --- |
| `auxiliary_jobs` | 命名・要約の固定入力・実行結果 | [カラム一覧](#auxiliary_jobs) |
| `auxiliary_pauses` | 補助側の認証待ち・利用上限の保留 | [カラム一覧](#auxiliary_pauses) |
| `auxiliary_settings` | 全会話共通の補助モデル | [カラム一覧](#auxiliary_settings) |
| `chat_events` | 会話更新の永続revision | [カラム一覧](#chat_events) |
| `chat_requests` | 依頼原文・実行状態・解釈結果 | [カラム一覧](#chat_requests) |
| `chat_selections` | モデル選択の引き継ぎ用履歴 | [カラム一覧](#chat_selections) |
| `chat_sessions` | 会話とCodex thread・選択設定 | [カラム一覧](#chat_sessions) |
| `context_operations` | 専用MCPの参照・更新操作と結果 | [カラム一覧](#context_operations) |
| `conversation_names` | 人間または補助モデルが確定した会話名 | [カラム一覧](#conversation_names) |
| `conversations` | 作品内の会話 | [カラム一覧](#conversations) |
| `current_state_updates` | 現在保存状態の更新履歴 | [カラム一覧](#current_state_updates) |
| `current_states` | 作品の現在保存状態 | [カラム一覧](#current_states) |
| `git_settings` | 既定定義の選択履歴 | [カラム一覧](#git_settings) |
| `import_operations` | 制作ファイル取り込みの状態 | [カラム一覧](#import_operations) |
| `receipts` | 冪等受付の入力と確定結果 | [カラム一覧](#receipts) |
| `records` | LLM不要の記録原文・手作業原文 | [カラム一覧](#records) |
| `reference_candidates` | 出典・参考要素・利用条件と画像保持情報を持つ候補 | [カラム一覧](#reference_candidates) |
| `reference_pages` | ページ取得本文・目的・失敗 | [カラム一覧](#reference_pages) |
| `reference_searches` | Codex組込Web検索と依頼/turn/item | [カラム一覧](#reference_searches) |
| `reference_selections` | 人間の参考選択原文・任意理由 | [カラム一覧](#reference_selections) |
| `saved_states` | 確定した制作ファイルの保存状態 | [カラム一覧](#saved_states) |
| `side_chats` | 相談会話・開始時の固定参照 | [カラム一覧](#side_chats) |
| `summary_revisions` | 根拠付き要約と人間の訂正履歴 | [カラム一覧](#summary_revisions) |
| `text_revisions` | 制作意図・手作業文章・要約等の改訂 | [カラム一覧](#text_revisions) |
| `version_plans` | 依頼用の固定Git参照 | [カラム一覧](#version_plans) |
| `work_git` | 作品作成時の定義・作風参照 | [カラム一覧](#work_git) |
| `works` | 作品の現在値 | [カラム一覧](#works) |

### テーブルごとのカラム一覧

JSON保存項目は、対応する物理カラム表の直下に記載する。`data`等のTEXTカラム内のキーを物理カラムとは区別し、旧データで任意項目が欠けている場合もある。

#### auxiliary_jobs

[DDL・保存処理](../src/server/auxiliary-store.ts)。移行時は退避後に5テーブルをトランザクションで追加する。再起動時はpending/runningをfailed・PROCESS_INTERRUPTEDへ変更し、自動再送しない。命名・要約は制作threadと別threadでMCP・shell等の権限なしに実行する。

| カラム | SQLite型 | 制約 | 用途 |
| --- | --- | --- | --- |
| `sequence` | INTEGER | PK、AUTOINCREMENT | 処理の受付順 |
| `id` | TEXT | UNIQUE、NOT NULL | 処理ID |
| `conversation_id` | TEXT | NOT NULL、FK→conversations.id | 対象会話 |
| `data` | TEXT | NOT NULL | 下記JSON |

| JSON項目 | 保存内容 |
| --- | --- |
| `id,conversationId,kind` | ID・会話・name/summary |
| `model,sourceRequestId,generation,createdAt` | 受付時の補助モデル・起点依頼・再実行世代・時刻 |
| `sources[]` | 固定対象原文の`id,requestId,body,complete`。記録ID・依頼ID・返答の試行/項目ID・完全/途中・本文hashを識別。対象本文を固定し後から書き換えない |
| `status,error,result,finishedAt` | pending/running/completed/failed/stopped、固定エラーコード、出力、終了時刻 |
| `threadId,turnId,runtime,actualModel` | 補助thread・turn・実ランタイム・実モデル。制作thread・MCP資格情報は渡さない |

#### auxiliary_pauses

| カラム | SQLite型 | 制約 | 用途 |
| --- | --- | --- | --- |
| `conversation_id` | TEXT | PK、FK→conversations.id | 保留対象会話 |
| `source_request_id` | TEXT | NOT NULL、FK→chat_requests.id | 保留起点の依頼 |
| `error` | TEXT | NOT NULL | AUTH_REQUIREDまたはUSAGE_LIMIT。同じ起点の補助処理を抑止し、明示再実行で解除。新しい明示依頼は再度認証を検査 |

#### auxiliary_settings

| カラム | SQLite型 | 制約 | 用途 |
| --- | --- | --- | --- |
| `id` | INTEGER | PK、CHECK(id=1) | 単一設定行 |
| `model` | TEXT | NOT NULL | 初期値gpt-6-luna。今後受付の補助処理へ適用 |

#### chat_events

会話更新の永続revision。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `conversation_id` | TEXT | NOT NULL, FK → conversations.id | 所属会話ID |
| `request_id` | TEXT | FK → chat_requests.id | 更新対象の依頼ID。セッション設定の変更時はNULL |

#### chat_requests

依頼原文・実行状態・解釈結果。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `id` | TEXT | NOT NULL, UNIQUE | 識別子 |
| `conversation_id` | TEXT | NOT NULL, FK → conversations.id | 所属会話ID |
| `work_id` | TEXT | NOT NULL, FK → works.id | 所属作品ID |
| `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |

##### JSON保存項目

| 保存場所 | 保存項目・構造 | 根拠 |
| --- | --- | --- |
| `chat_requests.data` | `id,conversationId,workId,body,selection,actualModel,runtime,threadId,turnId,phase,stopRequested,error,terminal,items,plan,createdAt,retryCount,previousAttempt,attempts`、任意`role,contextSnapshot,instructions,recordInterpretation,images` | ChatRequest |
| `chat_requests.data.images[]` | 任意。`id,name,mime,size,sha256,width,height`。会話内の不変な原本を参照し、依頼の再開・再試行でも同じ配列を使う。絶対パス・表示URLは保存しない | shared/chat-image.ts / ChatImage |
| `chat_requests.data.attempts[]` | `stopRequested,turnId,selection,actualModel,runtime,terminal,error,items`。itemsは`id,type,text,complete` | ChatRequest / ChatItem |
| `chat_requests.data.recordInterpretation` | `sourceHash,model,runtime,threadId,turnId,status,instruction,question`。statusはupdate/not_requested/clarification | shared/record-instruction.ts |
| `chat_requests.data.recordInterpretation.instruction` | `tool,field,body`、任意`action,mode,baseText,targetId`。actionはcreate/update、modeはreplace/append/edit。自然文UPDATEはbaseTextで編集元全文を固定 | RecordInstruction |

受付時contextSnapshot.referencesとget_execution_context.referencesには人間の選択済み参考資料・対応本文・選択原文を含める。未選択は制作条件へ自動反映しない。

phaseはaccepted/running/stopping/completed/interrupted/blocked/unknown。planは[version_plans](#version_plans)のVersionPlan、selectionは[chat_selections](#chat_selections)のModelChoice。contextSnapshotは受付時の作品・文章改訂・保存状態・固定計画・作風、instructionsは固定Git blob由来の工程指示。

#### chat_selections

モデル選択の引き継ぎ用履歴。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |

##### JSON保存項目

| 保存場所 | 保存項目・構造 | 根拠 |
| --- | --- | --- |
| `chat_selections.data` | ModelChoice：`model,effort,speed`（standard/fast） | chat-store.ts |

#### chat_sessions

会話とCodex thread・選択設定。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `conversation_id` | TEXT | PK, FK → conversations.id | 所属会話ID |
| `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |

##### JSON保存項目

| 保存場所 | 保存項目・構造 | 根拠 |
| --- | --- | --- |
| `chat_sessions.data` | `conversationId,threadId,selection`、任意`instructionKey`（共通指示の識別hash） | ChatSession |

selectionは[chat_selections](#chat_selections)のModelChoiceまたはnull。

#### context_operations

専用MCPの参照・更新操作と結果。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `id` | TEXT | NOT NULL, UNIQUE | 識別子 |
| `request_id` | TEXT | NOT NULL, FK → chat_requests.id | 元依頼ID |
| `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |

##### JSON保存項目

| 保存場所 | 保存項目・構造 | 根拠 |
| --- | --- | --- |
| `context_operations.data` | `input:{tool,args},result,createdAt`。接続資格は保存しない | store.ts のcontextOperation |

#### conversation_names

| カラム | SQLite型 | 制約 | 用途 |
| --- | --- | --- | --- |
| `conversation_id` | TEXT | PK、FK→conversations.id | 会話 |
| `name` | TEXT | NOT NULL | 確定した表示名。会話一覧のtitleにも付加 |
| `author` | TEXT | NOT NULL | human/assistant。人間名の後着上書きを禁止 |
| `created_at` | TEXT | NOT NULL | 設定時刻 |

#### conversations

作品内の会話。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `id` | TEXT | NOT NULL, UNIQUE | 識別子 |
| `work_id` | TEXT | NOT NULL, FK → works.id | 所属作品ID |
| `created_at` | TEXT | NOT NULL | 作成時刻（ISO 8601文字列） |

`Conversation.title`は読み取り時に付加する表示項目であり、物理カラムではない。

#### current_state_updates

現在保存状態の更新履歴。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `work_id` | TEXT | NOT NULL, FK → works.id | 所属作品ID |
| `before_id` | TEXT | — | 変更前の保存状態ID（初回はNULL） |
| `after_id` | TEXT | NOT NULL, FK → saved_states.id | 変更後の保存状態ID |
| `operation_id` | TEXT | NOT NULL, UNIQUE, FK → import_operations.id | 確定した取り込み操作ID |

#### current_states

作品の現在保存状態。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `work_id` | TEXT | PK, FK → works.id | 所属作品ID |
| `state_id` | TEXT | NOT NULL, FK → saved_states.id | 現在の保存状態ID |

#### git_settings

既定定義の選択履歴。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |
| `created_at` | TEXT | NOT NULL | 作成時刻（ISO 8601文字列） |

##### JSON保存項目

| 保存場所 | 保存項目・構造 | 根拠 |
| --- | --- | --- |
| `git_settings.data` | GitReference | shared/versions.ts |

GitReferenceの項目は`repositoryId,objectFormat,commit,tree,tag,manifest,files[{path,blob}]`。

#### import_operations

制作ファイル取り込みの状態。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `id` | TEXT | PK | 識別子 |
| `request_key` | TEXT | NOT NULL, UNIQUE | 同内容再送を識別する受付キー |
| `work_id` | TEXT | NOT NULL, FK → works.id | 所属作品ID |
| `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |

##### JSON保存項目

| 保存場所 | 保存項目・構造 | 根拠 |
| --- | --- | --- |
| `import_operations.data` | `id,requestKey,workId,conversationId,stateId,input,phase,error,createdAt`、任意`completionHash`。phaseはplanned/incomplete/reconciling/committed/abandoned | ImportOperation |

inputは[ファイル取り込みAPIの入力](#ファイル取り込みの入力詳細)。

#### receipts

冪等受付の入力と確定結果。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `request_key` | TEXT | PK | 同内容再送を識別する受付キー |
| `content` | TEXT | NOT NULL | 受付内容のJSON文字列 |
| `result` | TEXT | NOT NULL | 確定応答のJSON文字列 |

##### JSON保存項目

| 保存場所 | 保存項目・構造 | 根拠 |
| --- | --- | --- |
| `receipts.content` / `result` | 操作種別・対象・入力を含む配列／確定応答。同じキーの異内容はREQUEST_KEY_CONFLICT | store.ts のonce |

#### records

LLM不要の記録原文・手作業原文。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `id` | TEXT | NOT NULL, UNIQUE | 識別子 |
| `conversation_id` | TEXT | NOT NULL, FK → conversations.id | 所属会話ID |
| `body` | TEXT | NOT NULL | 記録の原文本文 |
| `created_at` | TEXT | NOT NULL | 作成時刻（ISO 8601文字列） |

通常表示では原文と改訂を重ね、旧理由も統合本文として返す。`BodyRecord.originalBody/reason/summary`は読み取り時に付加する表示項目であり、物理カラムではない。新しい全文への置換後に旧理由を再付加しない。

#### reference_candidates

[DDL・保存処理](../src/server/reference-store.ts)。

| カラム | SQLite型 | 制約 | 用途 |
| --- | --- | --- | --- |
| sequence | INTEGER | PK、AUTOINCREMENT | 確定順 |
| id | TEXT | NOT NULL、UNIQUE | 候補ID |
| work_id | TEXT | NOT NULL、FK→works.id | 作品 |
| page_id | TEXT | NOT NULL、FK→reference_pages.id | 取得ページ |
| data | TEXT | NOT NULL | 下記JSON |

| JSON保存項目 | 内容 |
| --- | --- |
| `data` | `id,workId,requestId,conversationId,threadId,turnId,attempt,pageId,title,author,element,intentRelation,checkedAt,usage,image`。usageは`terms,pageId,quote,checkedAt`（旧記録では未設定）。imageは`status,url,sha256,size,mime,permissionPageId,permissionQuote,error`。permissionPageId/permissionQuoteは旧記録の互換保存項目で、新規保存はnull。statusはurl_only/not_retained/stored/broken/failed/stopped。実体パスはIDから解決し保存JSONに個人パスを含めない |

#### reference_pages

[DDL・保存処理](../src/server/reference-store.ts)。

| カラム | SQLite型 | 制約 | 用途 |
| --- | --- | --- | --- |
| sequence | INTEGER | PK、AUTOINCREMENT | 確定順 |
| id | TEXT | NOT NULL、UNIQUE | ページID |
| work_id | TEXT | NOT NULL、FK→works.id | 作品 |
| request_id | TEXT | NOT NULL、FK→chat_requests.id | 依頼 |
| data | TEXT | NOT NULL | 下記JSON |

| JSON保存項目 | 内容 |
| --- | --- |
| `data` | `id,workId,requestId,conversationId,threadId,turnId,attempt,url,finalUrl,purpose,checkedAt,status,text,sha256,error`。statusはavailable/broken/failed/stopped。sha256は取得バイト列、textはHTML除去等をした本文。停止時も取得履歴を保持 |

#### reference_searches

[DDL・保存処理](../src/server/reference-store.ts)。

| カラム | SQLite型 | 制約 | 用途 |
| --- | --- | --- | --- |
| sequence | INTEGER | PK、AUTOINCREMENT | 受付順 |
| request_id | TEXT | NOT NULL、FK→chat_requests.id | 依頼 |
| item_id | TEXT | NOT NULL | 検索item |
| attempt | INTEGER | NOT NULL | 試行 |
| work_id | TEXT | NOT NULL、FK→works.id | 作品 |
| data | TEXT | NOT NULL | 下記JSON |

| JSON保存項目 | 内容 |
| --- | --- |
| `data` | `workId,requestId,conversationId,threadId,turnId,attempt,checkedAt,itemId,query,action,status,resultAvailability,results`。action/resultsはCodex schemaの構造化値。resultAvailabilityはresults/empty/not_provided。通知に結果がなければ空結果と推測しない。未完了検索はturnの失敗/中断/連絡喪失をfailed/interrupted/unknownへ反映。プロセス再起動時は残るin_progressをinterruptedへ整理。UNIQUE(request_id,attempt,item_id)で通知と履歴照合を重複させない |

#### reference_selections

[DDL・保存処理](../src/server/reference-store.ts)。

| カラム | SQLite型 | 制約 | 用途 |
| --- | --- | --- | --- |
| sequence | INTEGER | PK、AUTOINCREMENT | 確定順 |
| id | TEXT | NOT NULL、UNIQUE | 選択ID |
| reference_id | TEXT | NOT NULL、FK→reference_candidates.id | 候補 |
| request_id | TEXT | NOT NULL、FK→chat_requests.id | 人間の指示依頼 |
| data | TEXT | NOT NULL | 下記JSON |

| JSON保存項目 | 内容 |
| --- | --- |
| `data` | `id,referenceId,requestId,body,author,createdAt`。bodyは人間の選択原文全体（任意理由を含む）。authorはhuman。authorizationは`status,referenceId,question,threadId,turnId,model,runtime`（ツールなし解釈の出典）。UNIQUE(reference_id,request_id)で操作IDを変えても同じ指示の同じ選択は一度だけ |

#### saved_states

確定した制作ファイルの保存状態。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `id` | TEXT | NOT NULL, UNIQUE | 識別子 |
| `work_id` | TEXT | NOT NULL, FK → works.id | 所属作品ID |
| `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |

##### JSON保存項目

| 保存場所 | 保存項目・構造 | 根拠 |
| --- | --- | --- |
| `saved_states.data` | `id,workId,recordId,beforeStateId,changeKind,application,reason,render,historyBeforeImport,files,missing,createdAt`。changeKindはimport/manual、historyBeforeImportはunknown/recorded | SavedState |

filesは`id,rootId,relativePath,role,source{rootId,relativePath},size,sha256`、missingは`source,reason`（not_found/cycle/outside_root/inspection_pending）。保存済みrenderは`{stateId,fileId}`またはnull。`SavedState.recordBody`は読み取り時に付加する表示用の最新本文であり、物理カラムでも保存JSON項目でもない。

#### side_chats

[DDL・保存処理](../src/server/side-store.ts)。追加前に退避し、トランザクションで作成。既存の会話・記録は変更しない。

| カラム | SQLite型 | 制約 | 用途 |
| --- | --- | --- | --- |
| `conversation_id` | TEXT | PK、FK→conversations.id | サイド会話ID |
| `main_conversation_id` | TEXT | NOT NULL、FK→conversations.id | 開始元のメイン会話ID |
| `data` | TEXT | NOT NULL | 下記JSON |

| JSON項目 | 保存内容 |
| --- | --- |
| `conversationId,mainConversationId,createdAt` | 会話・開始元・固定日時 |
| `topic`（旧データのみ任意） | 以前に入力された話題。既存の固定文脈として保持し、新規相談では保存しない |
| `plan,snapshot` | 開始時の固定Git版、作品共有情報・文章改訂・保存状態・メインの会話要約と未要約原文・作風 |
| `selectedStates[]` | 同じ作品の選択済み保存状態（ファイルID・管理下相対パス・hash・不足を含む）。実体を新規複製しない |
| `mainMessages[]` | 開始元会話の依頼`id,body,items`。開始時点の途中返答もそのまま固定 |
| `history` | 開始時の`records,requests,conversations,revisions`全ページ。requestsは原文・返答・試行・工程・状態・日時・計画IDを保持し、過去の文脈snapshotを再帰展開しない。後続発言・更新は転送しない |

サイドのタブ名は最初のサイド発言から既存の補助Codexで一度だけ命名し、`conversation_names`に保存する。命名までは未命名、失敗しても相談を継続する。表示用`SideChatView.title`は読み取り時の付加項目で`side_chats.data`へは保存しない。サイドの原文・返答・試行・停止は既存`chat_requests`、threadは`chat_sessions`へ保存。参照操作は`context_operations`、要約は`summary_revisions`を使用する。[型](../src/shared/side-chat.ts)。

#### summary_revisions

| カラム | SQLite型 | 制約 | 用途 |
| --- | --- | --- | --- |
| `sequence` | INTEGER | PK、AUTOINCREMENT | 要約・訂正の追加順 |
| `id` | TEXT | UNIQUE、NOT NULL | 要約改訂ID |
| `conversation_id` | TEXT | NOT NULL、FK→conversations.id | 会話 |
| `data` | TEXT | NOT NULL | 下記JSON |

| JSON項目 | 保存内容 |
| --- | --- |
| `id,jobId,body,sources[]` | 改訂ID・起点補助処理・要約本文・固定した根拠原文（auxiliary_jobs.sourcesと同じ構造） |
| `previousId,author,createdAt` | 訂正元ID、human/assistant、時刻。旧要約と原文を削除・置換しない |

未要約は保存された原文と全要約の対象ID差分から表示時に計算する。`AuxiliaryView {model,name,nameAuthor,jobs,summaries,pending}`は表示用。次の依頼の`contextSnapshot.conversationSummaries`とMCP `get_execution_context`の`conversationSummaries`には作品内各会話の訂正後の要約・未要約原文を分離して含め、現在の制作意図等を要約で置換しない。HTTP/SSEのrevisionは補助結果・訂正・命名・記録専用送信・取り込みでも更新する。

#### text_revisions

制作意図・手作業文章・要約等の改訂。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `id` | TEXT | NOT NULL, UNIQUE | 識別子 |
| `work_id` | TEXT | NOT NULL, FK → works.id | 所属作品ID |
| `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |

##### JSON保存項目

| 保存場所 | 保存項目・構造 | 根拠 |
| --- | --- | --- |
| `text_revisions.data` | `id,workId,targetId,field,body,previousId,previousBody,sourceRequestId,author,createdAt`、任意`action,mode,addedText,format`。body/previousBodyは変更後/前の全文。formatはunified-record-v1 | TextRevision |

#### version_plans

依頼用の固定Git参照。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `id` | TEXT | PK | 識別子 |
| `work_id` | TEXT | NOT NULL, FK → works.id | 所属作品ID |
| `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |

##### JSON保存項目

| 保存場所 | 保存項目・構造 | 根拠 |
| --- | --- | --- |
| `version_plans.data` | `id,workId,definition,style,createdAt` | VersionPlan |

definition/styleのGitReferenceの構造は[git_settings](#git_settings)を参照。

#### work_git

作品作成時の定義・作風参照。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `work_id` | TEXT | PK, FK → works.id | 所属作品ID |
| `data` | TEXT | NOT NULL | 下表の構造化データを保持するJSON文字列 |

##### JSON保存項目

| 保存場所 | 保存項目・構造 | 根拠 |
| --- | --- | --- |
| `work_git.data` | `definition, style`（GitReference/null） | store.ts |

GitReferenceの構造は[git_settings](#git_settings)を参照。`Work.style/plannedDefinition`は読み取り時に付加する表示項目であり、物理カラムではない。

#### works

作品の現在値。

| カラム | SQLite型 | 明示制約・参照 | カラムの意味 |
| --- | --- | --- | --- |
| `sequence` | INTEGER | PK, AUTOINCREMENT | 確定順の連番 |
| `id` | TEXT | NOT NULL, UNIQUE | 識別子 |
| `name` | TEXT | NOT NULL | 作品名 |
| `intent` | TEXT | — | 現在の制作意図（未入力はNULL） |
| `created_at` | TEXT | NOT NULL | 作成時刻（ISO 8601文字列） |

### インデックスとSQLite内部テーブル

追加の明示インデックスは`side_chats_main(main_conversation_id)`、`conversations_work(work_id,sequence)`、`records_conversation(conversation_id,sequence)`、`text_revisions_work(work_id,sequence)`。PK/UNIQUE用の自動インデックスはSQLiteが管理する。SQLite内部の`sqlite_sequence(name,seq)`はAUTOINCREMENT連番を保持し、アプリ用テーブル数に含めない。

## ソースとの照合

更新時は次を確認する。更新の必須条件は[開発フロー](agents/development-workflow.md#実装一覧の更新)を正とする。

1. MCP：contextTools、mcp.tsのtools/list、context-rpc.tsの分岐・引数検査を照合する。公開中の未実装ツールも載せ、削除したツールは公開一覧と呼び出し経路から外れていることを確認する。
2. HTTP：app.tsとchat.tsの全ルートを照合する。ループ生成のstop/reconcile/resume、条件付きinstance、SSE、schemaと応答を確認する。
3. DB：store.tsの全CREATE/ALTER・移行を確認し、新規の隔離保存先で生成したDBのsqlite_master、PRAGMA table_info / foreign_key_list / index_listと照合する。既存の制作DBを検証用に変更しない。
4. JSON：sharedの型と各保存処理を照合し、保存項目と表示時だけ付加する項目を区別する。APIレスポンスだけから物理カラムを推定しない。

## 参考資料の画面接続（2026-11-04）

mainの3領域UIへ接続した。メイン返答内の参考候補リンクは要求元requestIdで対応付け、同じ作品の候補IDを固定した右詳細タブを開く。右タブの「＋→参考資料」は一覧を開き、タイトルから詳細タブへ進む。参考資料一覧・詳細は既存GET `/api/works/:id/references`を会話SSEのrevision変更で再取得し、文章改訂の件数が変わらない保存・選択も反映する。詳細タブの閉鎖で参照や選択を削除せず、再表示/再読込で保持する。画像添付は会話専用画像APIのまま維持し、参考候補や制作素材の取り込みと混同しない。参考画像はグリッドから成果物と共通の大きなプレビューへ開く。件数未指定時の20件を共通指示とturnのreferenceDefaults.candidateCountへ渡し、モデルが明示件数を優先して調査する。結果不足は実件数とともに示す。MCPの参考保存は利用条件記録と自動画像取得へ変更し、main由来の画像添付APIと合わせて47 HTTP操作・27テーブル・101物理カラムを管理する。
