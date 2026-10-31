# Codex app-server と画面機能の分担

確認日：2026-10-31（日本時間）。[画面機能と独自実装の分担調査](https://github.com/Kurarowa305/scene-craft/issues/26)の結果。機能棚卸しと根拠の確認を対象とし、設計変更の合意・本実装・受け入れの完了を意味しない。

app-server は会話・推論・ツール呼び出しの基盤として利用できる。作品、保存状態、採否、保護、制作ファイルとその実行結果、画面自体は scene-craft／通常プログラムが担当する。既存の Codex 管理認証・WSL 配置・ChatGPT 契約枠・明示再開の選択は変更しない。

## 根拠と判定の読み方

- **D**：[公式 app-server 文書](https://learn.chatgpt.com/docs/app-server)。確認時点の更新される文書。API 名の記載だけでは実機確認済みを意味しない。取得URLは `https://learn.chatgpt.com/docs/app-server.md`、本文SHA-256は `f879715bb0d440db60b71e7a5bfe1258d045520feabe3fc6b11847100c8d064b`。公開文書には版固定がないため、追跡可能な公式ソースの固定コミットとPも併用する。
- **S**：公式 `openai/codex` main の確認コミット `67f0994b532b8740f14b5b738af7b7b2a915b1d6`。導入済み `0.166.0-alpha.5.1` と同一ビルドであることは確認していない。最新ソースにあることを導入版の動作保証にしない。
- **S-thread**：[thread.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/v2/thread.rs)。`ThreadStartParams`、`ThreadSettingsUpdateParams`、resume/fork 設定。
- **S-turn**：[turn.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/v2/turn.rs)。`TurnStartParams`、`UserInput`。
- **S-project**：[project.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/v2/project.rs)。project は id/name/roots/metadata/並び順等を持つ。scene-craft の作品・保存状態・採否モデルとは区別する。
- **S-title**：[TUI の thread_title.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/app/thread_title.rs)。TUI クライアントが一時 thread を開始し構造化タイトルを求める実装。これは app-server が各初回 turn 後の命名を無条件に行う証拠ではない。
- **UI**：`docs/design/user-interface.md`、確定元 `403644c75308b50cf886431d020be502474492a8`。試作 `5298534c2939aa44683baa6ebd3ced8285801466` は操作契約の根拠だけであり、app-server 接続の根拠ではない。
- **P**：導入済み CLI `0.166.0-alpha.5.1` が生成した[プロトコル抜粋](evidence/codex-app-server-ui-schema.json)。通常出力と `--experimental` の出力を比較。メソッド一覧、主要型の項目名・必須項目・元schemaのSHA-256、入力型・状態・通知を収録。以下の型・API名は P でも照合したものを使う。通常出力に含まれることを製品の安定保証とは呼ばない。
- **R**：[現行版の非推論RPC結果](evidence/codex-app-server-ui-probe.json)と[再実行コード](evidence/codex-app-server-ui-probe.py)。空の専用 `CODEX_HOME` で確認し、認証・既存会話は読み込まず `turn/start` は送っていない。
- **入力資料**：調査開始時の scene-craft `main` は [`787b620d858c611058f96d361a9ab9bfdcd41830`](https://github.com/Kurarowa305/scene-craft/tree/787b620d858c611058f96d361a9ab9bfdcd41830)。UI本文は上記確定コミットから変更なし。[参考調査・素材設計](../design/reference-and-assets.md)までを含む。`agent-contracts.md` は未作成で、工程別契約を本調査で確定しない。
- **旧実機**：[既存接続検証](codex-app-server-connection-validation.md) の `0.160.0` 検証。turn/画像/動的ツール/resume/圧縮/原文取得/interrupt の確認を再利用できるが、最新版や制作ツールの異常系を保証しない。

表の **標準**＝app-server標準で提供、**構成**＝app-serverを利用してscene-craft側で構成、**自前**＝scene-craft／外部ツール側で実装、**未確認**＝対応・保証または実機動作を確認できていない。1機能の内部で複数の責務を併記する。

## 機能別対応表

P／S／D は仕様・型・ソースの確認、R／旧実機は実行による確認である。「構成」「自前」は既存要件とこれらの提供範囲を照合した責務の整理であり、完成した製品や正式採用済みの接続方式を示さない。「app-serverを必要としない」は **自前** に分類する。

| UI機能・利用者操作 | app-serverで実現する部分 | 対応するAPI・イベント・設定と根拠 | scene-craftで独自に実装する部分 | 接続する外部ツール・通常プログラム | 制約・未確認事項・検証方法 |
| --- | --- | --- | --- | --- | --- |
| 作品を作成し既存ファイルを取り込む | **構成**：project と thread の関連付けに使える補助機能はある | `project/create,list,read,update,move,delete`、`thread/start.projectId`（Pでは両方とも実験）；P、S-project、S-thread | **自前**：作品ID、制作意図、空／取り込み、作風なし、初回保存状態、取り込み履歴、作品所属の正本とUI | SQLite、ファイルコピー・ハッシュ・依存確認 | project API はscene-craftの作品作成契約を完成させない。実験APIを採用するか #9／実装仕様で判断。再作成・移行時のID対応を検証 |
| 作品別の複数チャット・作成・一覧 | **標準**：複数thread、一覧、cursor pagination | `thread/start,list`、実験 `thread/start.projectId`；P、D Threads、S-thread、S-project | **構成／自前**：作品・振り返り別の所属、空チャット即時表示、利用者別の並び、model選択保持、左側UI | SQLite | `cwd`だけで作品所属を代替しない。Rでは空threadを2件作成しloaded一覧で取得できたが、stored一覧は0件。初回送信前もscene-craft DBへ保存する。既定sourceKindsとpaginationによる一覧漏れも確認 |
| チャットを保存し開き直す | **標準**：永続threadの履歴読み戻し・再接続 | `thread/read,resume`、`thread/turns/list,items/list`；D Threads | **構成**：scene-craft会話IDとthread IDの対応、原文・ドメイン参照の正本、再表示UI | SQLite、HTTP/SSE | Rは同一プロセス内のread/resumeまで成功。再起動後は旧実機のみ。Rの新規threadはpaginatedで、includeTurns=trueはdeprecationNotice。メタ取得＋turns/itemsページングへ。継続データは移行対象外で、消失時も原文を表示 |
| 最初のリクエスト後にLLMがタイトル命名 | **標準**：設定済み名前の保存・取得・通知。**未確認**：app-serverが初回turnだけで自動生成する保証 | `thread/name/set`、`thread/name/updated`；P、R、D、S-title | **構成**：初回送信後の命名依頼、結果検査・保存、暫定タイトル、命名失敗時の再試行方針 | SQLite | TUIの一時thread命名実装はクライアント側。製品のモデル自動切替禁止と矛盾しない命名モデル・費用扱いを #9 で決める。命名未完でも記録を許可 |
| 会話の開始・継続・本文ストリーミング | **標準**：turn・item lifecycle、delta、終端 | `initialize`→`initialized`、`thread/start,resume`、`turn/start`、`item/agentMessage/delta`、`turn/completed`；D Lifecycle/Events | **構成**：RPC相関、バックエンドからブラウザへSSE、原文永続化、重複・順序制御 | Node.js/Fastify、SQLite | 本文finalとturn成功を区別。旧実機の成功は再利用可、現行版とブラウザ再接続は別途確認 |
| 状態アイコン・進捗・確認待ち | **標準**：thread/turn/item状態とapproval情報 | `thread/status/changed`（notLoaded/idle/systemError/active、activeFlags）、`turn/started,completed`、`item/*`；D Events | **構成／自前**：9状態から4表示への集約、未解決の確認優先、LLM外の制作処理状態 | 実行管理DB、Windows補助プロセス | notLoadedは停止や制作完了の証明ではない。過去の失敗を現在アイコンに残さない。複数依頼と外部レンダー待ちを検証 |
| 入力欄から現在の作業だけ停止 | **標準**：対象turnへの中断要求と終端 | `turn/interrupt`→`turn/completed.status=interrupted`；D、旧実機 | **構成／自前**：チャットから依頼・操作への対応、停止待ち、実際の外部プロセス停止と照合 | Windows Blender/Python、所有権付きプロセス管理 | `{}`の受付応答は外部停止完了ではない。他チャットが止まらないことと副作用後の照合を #14 へ |
| 「続けて」で再開・結果不明を照合 | **標準**：保存会話のresume、新turn、履歴取得 | `thread/resume,read`、`turn/start`；D | **構成／自前**：再開対象の解決、同じ依頼ID・累積回数、安全な照合、競合停止、明示指示の記録 | SQLite、制作操作ログ、実体ハッシュ | resumeは制作依頼の再実行ではない。clientUserMessageIdの冪等保証は未確認。履歴不在だけで未実行と判断しない |
| 送信時にモデルを選択・記録 | **標準**：catalog、thread/turnごとのmodel設定 | `model/list`、`thread/start.model`、`turn/start.model,effort,serviceTier`；D Models、S-turn | **構成**：送信時の設定固定、要求と有効設定、実行記録、使用不能表示 | SQLite | 一覧は各リクエストの利用権限・成功保証ではない。Rでは未認証でもcatalogが返った。Thread.model/effortはturn別実績ではない（P）。要求値・有効値・model/reroutedを区別し、サービスによる切替の制御可否は未確認 |
| 直前のチャットのモデルを新規へ引継ぐ | **標準**：明示したmodelを受け付ける | `thread/start.model`、`turn/start.model`；D、S-thread/S-turn | **自前**：直前の選択を保存し新規会話へ適用。既存会話を変更しない、次依頼から適用 | SQLite | app-serverのthread内sticky設定とチャット間の選択継承は別。使用不能時の自動フォールバック禁止を維持。Pの実験allowProviderModelFallback=falseの利用とmodel/reroutedの監視・停止境界を検証。falseがサービス側切替を防ぐ保証はない |
| エージェント選択と「なし」 | **構成**：指示・skills・tools等を実行へ渡す基盤 | `thread/start.baseInstructions,developerInstructions,config`、`UserInput.skill,mention`、実験`collaborationMode`；S-thread/S-turn | **自前**：工程別定義、送信ごとの工程記録、「なし」の権限、Git版固定、切替時の設定漏れ防止 | Git、契約検査 | Codex子agentやcollaboration modeはscene-craft工程選択そのものではない。「なし」はLLMなしの記録送信とも区別。具体的な同一thread内切替は #9 |
| メインと並行する相談専用サイドチャット | **標準**：独立thread/turnを管理 | `thread/start`、`turn/start`；D | **構成**：独立会話・並行表示・保存・停止対象、開いた時点の初期文脈を固定して投入 | SQLite | メインへturn/steerを送る機能で代替しない。タブを閉じても削除・停止しない |
| 相談へ初期文脈を継承 | **標準**：指示/入力で文脈投入、会話forkも存在 | `thread/start.developerInstructions`、`turn/start.input`、`thread/fork`；D、S-thread/S-turn | **構成**：作品意図・採用状態・メイン話題・成果物参照のsnapshot、後続発言は自動転送しない | SQLite、文脈組立 | forkは会話履歴をコピーし、権限・metadataも継承し得る。相談用権限が保証されるとみなさず最小thread構成で検証 |
| 相談から制作・採否・記録を禁止 | **標準**：sandbox/approval policy等の制御機構 | `sandboxPolicy`、`approvalPolicy`、MCP設定、`dynamicTools`；D Sandbox/Approvals、S-thread | **自前**：更新tool非公開、呼出元会話の権限をバックエンドで検査、記録送信UIなし、メインへの依頼を確定しない | 制作tool受付、SQLite | read-onlyだけで外部MCP副作用は禁止できない。動的toolを空にしても組込みshell等が消えるとは限らない。各経路の迂回禁止を #9/#14 で確認 |
| 原文・要約・文脈圧縮 | **標準**：会話継続とcontext compaction | `thread/compact/start`、`contextCompaction` item、`thread/read`等；D、旧実機 | **構成／自前**：原文の正本、根拠付き要約・訂正履歴、作品共有情報、参照元ID | SQLite、要約生成 | 圧縮は制作履歴保持やscene-craft要約の代替ではない。長文・長期・再起動後・履歴paginationを検証 |
| コンピューターから画像添付 | **標準**：画像入力 | `UserInput.image`、`localImage`、`model/list.inputModalities`；D Turns、S-turn、旧実機 | **構成**：OS選択・アップロード、管理下コピー、URI/WSLパス変換、表示・参照 | ファイルAPI、Windows/WSL橋渡し | localImage.pathはserver側パス。URL画像取得・サイズ・モデル受理と原本保存は別途確認 |
| `.blend`・PSD/PSB等を添付し成果物選択 | **未確認**：汎用バイナリをUserInput.fileとして受けるAPI。調べたUserInputに汎用file variantなし | P、S-turn `UserInput`（text/image/localImage/audio/localAudio/skill/mention）、`thread/attachment/add,list,remove` | **自前**：ファイル受領・copy/hash・依存収集、成果物dropdown、保存状態と元案・時刻・path表示。LLMには識別参照と必要な抽出情報を渡す | SQLite、Blender/Python、ファイル解析 | attachment RPCはattachmentType/identityKey/payload等の関連情報を扱う。ファイル実体のuploadやモデル理解の保証とは別。pathのtext化だけで任意バイナリを理解できるとはしない。音声等は製品範囲に追加しない |
| 編集案・保存状態へのリンクと右側タブ | **標準**：本文やtool結果を返す経路 | agentMessage、dynamic/MCP tool result；D Events/Tools | **自前**：固定IDリンク、対象検証、既存タブ再利用、閉じても実体維持、欠落状態表示 | SQLite、ローカル成果物API、React | Markdownリンクやファイル変更itemだけでドメイン上の編集案は確定しない。枝先変更後も参照固定を検証 |
| プレビュー生成・取得・画像拡大移動 | **構成**：必要ならtool呼出を仲介 | `item/tool/call`（実験）、MCP；D Dynamic tools | **自前**：生成条件固定・再利用判定・画像配信・拡大移動UI、生成失敗でも記録可能 | Windows Blender、通常Python、画像API | LLM画像生成やimageViewは`.blend`プレビュー生成ではない。LLM停止中にも同じ通常処理を実行できること |
| 会話による採用・不採用・理由 | **構成**：自然言語解釈とtool経路 | turn/input、`outputSchema`、dynamic/MCP tools；D/S-turn | **自前**：対象明確化、採否記録、確定処理、現在状態切替、理由任意・未入力保持、AIの返答と実処理一致 | SQLite、制作tool、実体検証 | schema準拠の出力やapprovalは採用成功を保証しない。明示済みの同一指示へ追加確認を強制しない |
| 部分採用・複数案の組合せ・候補追加修正 | **構成**：指示理解とtool実行経路 | D Tools/Turns | **自前**：独立変更単位、依存関係、起点・寄与元固定、組合せ実体の生成・検証・提示 | Blenderスクリプト、SQLite | thread/forkやturn/diffは制作データ差分合成ではない。古い案の組合せで手修正を保持できるか検証 |
| 手作業記録・理由/変更要約の訂正 | **構成**：LLMを使う整理・解釈 | turn/input、tool result；D | **自前**：保存済みファイル取り込み、変更前後・指示者/変更者、訂正版追加、原文保持 | SQLite、ファイルcopy/hash | GUI未保存内容を取得済みにしない。Photoshop操作は人間。旧理由をAI推測で補わない |
| LLMなしの「記録として送信」 | app-serverを必要としない | UI/保存設計の要求。Codex turnは呼ばない | **自前**：本文・対象・添付の直接保存、後日要約と命名、相談送信との区別 | SQLite、通常プログラム | 認証失敗・利用枠超過・Codex未起動中に保存できることを検証 |
| 保護指定・一覧から解除・依頼限定許可 | **構成**：会話と確認tool経路 | D Approvals/Tools | **自前**：保護対象・項目、継続解除と一時許可、最新保護照合、直接/間接変更と共有材質検査 | Blender検証、SQLite | shell承認やsandboxのファイル書込制御はドメイン保護ではない。違反/検証不能な候補は採用不可 |
| 左から右への制作履歴ブランチグラフ | app-server標準の制作グラフは確認していない | D Thread/Turn/Item、`thread/fork` は会話分岐 | **自前**：保存状態・変更・採否のグラフ、理由hover、固定参照、レイアウト | SQLite、Reactグラフ描画 | Gitコミットやthread親子を保存状態グラフと混同しない。長いグラフの描画性能は #14 |
| 保存状態への復元・別作品への派生 | app-serverには会話forkがあるが制作実体の復元ではない | `thread/fork`；D/S-thread | **自前**：起点固定、未登録手修正の保存、実体検査、復元前後記録、元作品不変、独立copy | SQLite、ファイル操作、Blender | 会話履歴の切詰め/rollbackで制作復元しない。必要実体がないとき開始しない |
| 全履歴を対象に単作品/複数作品を振返る | **構成**：LLM分析、別thread | `thread/start`、`turn/start`、tools；D | **自前**：対象作品選択、全履歴取得、参照根拠固定、不足表示、複数作品に属する振返り記録 | SQLite、文脈組立、Git | model contextへ全原文が無制限に入る保証はない。全履歴を対象に探索・要約し実参照を記録、未採用・削除実体の履歴も漏らさない |
| 作風・制作方針の表示と最新表示 | **構成**：固定文脈をモデルへ渡せる | thread instructions、turn input；D/S-thread/S-turn | **自前**：使用中版、最新ラベル、未選択/不採用、作品意図優先、版選択UI | Git、SQLite | main更新や最新版作成は作品への自動適用ではない |
| 方針の項目別採否・編集・保留 | **構成**：提案生成とtool経路 | D Tools、`outputSchema`；S-turn | **自前**：項目ID、仮説/事実、根拠訂正、採用記録、commit成功確認 | Git、SQLite | LLMの「保存した」という返答だけでcommit・作品適用とみなさない |
| 定義・作風のGit版固定・作品へ適用・公開 | **構成**：shell/tool呼出経路はある | D Tools/Commands、S-thread.config | **自前**：フルhash、保持tag、旧新版/理由、互換性、待機/実行中の切替契約、remote保存時刻 | Git/gh、SQLite | Git実行能力は版固定・明示push・作品適用の契約を提供しない。副作用はtool受付で検査 |
| 認証・利用上限・再認証表示 | **標準**：Codex管理認証、状態・利用枠APIと通知 | `account/read,login/start,login/cancel,logout`、`account/updated`、`account/rateLimits/read,updated`；D Auth | **構成**：専用CODEX_HOME/file保管、費用条件案内、原因分類、途中成果と対処表示 | Codex管理認証、ブラウザlogin | 認証tokenを自前管理へ無条件変更しない。残枠APIは無料利用保証ではない。枠回復だけで制作を再開しない |
| 再接続・失敗・再実行 | **標準**：error通知、willRetry、終端、履歴resume | `error`、`turn/completed`、`thread/resume`；D Errors | **構成／自前**：依頼全体最大2回、通信再送との区別、owner/世代、結果不明照合、自動再開禁止 | 実行管理DB、Windows補助プロセス | app-server内部retry件数を制作再実行回数に直結しない。切断・強制終了・成功応答喪失を #14 で模擬 |
| ブラウザ終了後の継続・再表示 | **標準**：サーバープロセスが会話実行を保持し得る | D transport/thread lifecycle | **自前**：ブラウザとWSLバックエンドの寿命分離、進捗永続化、再購読・再表示 | Windows起動管理、Node.js、HTTP/SSE、SQLite | browser切断とapp-server stdin EOFは別。transport切断時にturnがどうなるか実機確認が必要 |
| LLM利用不可時の閲覧・プレビュー | app-serverを必要としない経路にする | UI、保存/全体設計 | **自前**：会話と履歴の表示、通常プログラムpreview、設定画面の操作 | SQLite、ファイルAPI、Windows Blender/Python | app-serverのthread/readだけに原文表示を依存させない。LLMなしの手記録と合わせて検証 |
| ローカル保存・全体backup・復元・移行 | **標準**：Codex自身の会話継続データの保存。製品backupではない | D Threads、S-thread履歴設定 | **自前**：作品DB/実体の整合backup、安全停止、空先復元、不足/破損、移行前退避 | SQLite、manifest/hash、copy・migrationプログラム | Git実体・認証・Codex内部継続データを製品backupに含めない。移行先でthread IDが使えない場合も原文表示・明示再開を成立させる |
| 大容量実体の明示削除・履歴維持 | app-serverのthread/deleteは存在するが別操作 | `thread/delete`；D Threads | **自前**：容量・影響提示、共有/採用中/実行中保護、実体のみ削除、削除済み/欠落/破損区別 | SQLite、参照検査、ファイル削除 | thread/deleteを制作実体削除やタブ閉鎖の代用にしない。会話と理由・採否・分岐は残す |
| Windows Blender・通常script・制作tool接続 | **標準／構成**：shell、MCP、実験dynamic toolの呼出機構 | `item/tool/call`、`mcpToolCall`、`command/exec`等；D、旧実機 | **自前**：RPC引数・権限検査、Windows/WSL path、所有権/停止/期限、制作操作・実体検証・完成判定 | Windows補助プロセス、Blender、Python、PSD/PSB処理 | tool呼出成功は13層出力・保存・採用成功と別。`thread/shellCommand`や実験process APIはsandbox外と文書化されており相談制限に流用しない |
| 一般Web検索・参考画像を調べる | **標準／構成**：web search toolと検索item、画像入力の経路 | `webSearch` item（search/openPage/findInPage）、`UserInput.image/localImage`；D Events、S-turn | **自前**：出典/確認日/参考要素、選択記録、画像の管理下保存可否、利用条件と欠落表示 | Web取得プログラム、SQLite、ファイル保存 | webSearch itemの存在は一般画像検索・画像保存・ライセンス判断の提供を意味しない。アカウント・モデル・設定による利用可否、検索結果と画像の対応は未検証 |
| Poly Haven/ambientCG・指定フォルダー検索と素材取得 | **構成**：MCP/dynamic toolからサービスやローカル検索へ接続できる | D Tools、reference-and-assets.md | **自前**：service別API、対象folder制限、pagination/cache、候補条件、人間の選択、指定品質取得・依存copy・編集案への取り込み | Poly Haven/ambientCG API、HTTP client、ファイル検索、Windows Blender | app-server専用の2サービス接続は今回確認していない。一般Web検索でservice専用取得契約を代替しない。実取得・形式受入は #14 |

## 見直し・後続へ渡す点

1. **#9 エージェント契約**：初期要件は手作業相談追加により10役割だがIssue本文は9役割表記のため最新要件へ揃える。同一チャットの工程切替と「なし」、命名要求の起動・モデル・費用、相談の初期文脈と強制的な更新拒否、動的tool（実験）対MCP、ファイル参照から制作toolへの入力、出典付き検索/素材取得の権限を具体化する。protocolの存在だけで正式採用しない。
2. **#12 画面設計**：操作契約を変更する根拠は得られていない。既存「調査未着手」の引継ぎ行を本資料参照へ更新する。タブ・zoom・グラフ・採否・保護等は自前UI。project APIや自動タイトルの有無をUI実装済みと表現しない。
3. **#14 テスト・診断**：現行版の会話保存、空thread、命名、pagination、画像path、相談権限迂回、切断後turn照合、外部操作停止、LLMなし導線、長期圧縮・backup移行、素材取得を実装検証に含める。
4. **接続・全体・文脈・実行状態・保存・参考素材設計**：調査リンクを加える。最新版APIを用いた既存契約の破壊的変更は行わない。0.160.0時点のincludeTurns全件取得の説明には、現行paginatedでの非推奨とページングを補足する。要求モデルと実行モデルを同一視せず、自動切替禁止を実現できる範囲を #9/#14 で確認する。特に「Codex thread履歴＝scene-craft原文正本」「approval＝制作採否」「project＝作品」「interrupt受付＝外部停止完了」と置き換えない。


## 現行版で実行した確認と再現方法

```sh
codex --version
codex app-server generate-json-schema --out /tmp/scene-craft-26-schema-stable
codex app-server generate-json-schema --experimental --out /tmp/scene-craft-26-schema-experimental
python3 docs/research/evidence/codex-app-server-ui-probe.py --out /tmp/scene-craft-ui-probe-result.json
```

生成先は専用の空ディレクトリを使う。最後のスクリプトは一時領域に空のCodex保管先を作り、APIキー用環境変数を除外し、ChatGPT認証を指定する。認証をコピーせず、既存会話・ユーザー設定を変更しない。`turn/start`・ツール実行・ログインは行わず、結果には許可した項目だけを出力し、一時パス・生成thread IDを置換する。調査用コードであり製品runtimeではない。

| 確認 | 観測結果 | 言える範囲 |
| --- | --- | --- |
| プロトコル抽出 | 通常出力106メソッド、実験追加73メソッド | 型の存在。実装・利用権限・安定性の保証ではない |
| initialize／initialized | 接続成功 | 現行CLIのstdio初期化 |
| account/read | account=null | 未認証の専用領域を使用 |
| model/list | 2件取得、続きのcursorあり | catalog取得。未認証でも返ったので推論権限を証明しない |
| thread/start × 2 | 別thread、idle、name=null、0 turn、historyMode=paginated | 複数の空会話を同時保持。並行推論は未実行 |
| thread/name/set／thread/read | 指定した名前を読み戻し、thread/name/updated受信 | 明示設定と通知。自動LLM命名は未実行 |
| thread/loaded/list／thread/list | loaded=2、stored=0 | 今回の初回turn前の空会話は保存済み一覧に現れない。永久に保存できないとの一般化はしない |
| thread/resume | 同じ名前・0 turnを取得 | 同じ起動中プロセスへの再接続。現行版のプロセス再起動後は未確認 |
| thread/read(includeTurns=true) | 成功とdeprecationNoticeを受信 | 現行paginatedでは全件取得に依存せず、ページングに対応する必要がある |

旧実機の推論・画像・動的ツール・再起動後resume・圧縮・interrupt結果は `0.160.0` の証拠として再利用する。現行版で同じ試験を再実行済みとは扱わない。今回の非推論確認から、モデル応答品質、並行推論、外部副作用の安全な停止、復元やバックアップの整合性は結論できない。

## 追加検証と未確定の契約

以下は本調査の未確認事項を受け取る検証計画であり、機能の受け入れ完了ではない。具体的なツール方式・工程定義をこの表で採用決定しない。

| 引き継ぎ先 | 次に確かめる内容 | 観測する結果 |
| --- | --- | --- |
| エージェント契約／テスト・診断 | 同じUIチャットで工程を切り替える。「なし」と記録送信を区別 | 通常のTurnStartParamsにdeveloperInstructionsはなく、ThreadStartParamsにはある（P）。threadの指示とツール設定の持ち越しを設計し、前工程の権限・版が漏れないこと |
| エージェント契約／テスト・診断 | 初回送信後の命名をLLMで実施し失敗・停止・枠到達を模擬 | 名前の保存と通知、命名未完でも原文・記録保持。TUIの内部的なモデル選択をそのまま製品へ流用しないこと |
| エージェント契約／テスト・診断 | 明示モデルの使用不能、allowProviderModelFallback、model/rerouted | 要求・有効設定・切替通知・判明した実モデルを区別。サービス側切替を拒否できるかを確認し、不可なら契約上の差を合意前に明示する。未通知時も実モデルを推測しない |
| エージェント契約／テスト・診断 | メインと相談を並行実行し、相談から各更新経路を試す | 更新tool未公開、MCP・shell等の迂回不可、受け取った更新要求も会話権限で拒否。片方の停止が他方に波及しないこと |
| テスト・診断 | 現行版で推論後に再起動し、長期・圧縮済み履歴をページング | 原文・turn/item ID・順序・完全性を照合。summary itemsを完全な原文とみなさず必要なfull itemを取得。cursor境界の重複や欠落を検出 |
| テスト・診断 | ブラウザ切断、app-server終了、turn/start応答喪失、tool結果喪失、停止と完成の競合 | 保存した依頼・turn・操作記録・実体を照合し、履歴にないだけで再送しない。外部停止完了まで制作枠を解放しない |
| テスト・診断 | app-server不在・利用上限・再認証待ち、バックアップ移行 | 閲覧・記録・プレビュー・バックアップが通常プログラムで動く。Codex継続データなしでも根拠原文を保持し、明示再開まで制作しない |
| エージェント契約／テスト・診断 | Windows画像パス、一般Web検索、素材2サービスとローカル検索 | 検索結果・画像・出典・利用条件と管理下実体を対応付ける。サービス別取得／Blender取り込みの失敗・停止・二重実行を検証 |

実験API（project、dynamicTools、queue、settings等）は存在だけで必須依存にしない。例えばthread内queueは、作品をまたぐ制作操作の順序・所有権・再実行予算を提供するものではない。採用する場合は導入版・必要capability・失敗時の扱いを固定して検証する。

本調査は既存UIの操作契約を変更する根拠を示していない。実験APIの正式採用、同一会話での役割切替方法、サービス側モデル切替を含む未確定事項は、エージェント契約とテスト・診断へ渡す。制作機能が標準APIだけで完成しているとは扱わない。
