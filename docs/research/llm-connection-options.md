# LLM 接続方式の比較

現在の設計: 2026-10-12 に [LLM 接続設計](../design/llm-connection.md) を合意した。費用確認は利用者が担い、基盤側の確認と利用情報取得失敗による送信保留は設けない。以下の費用確認案・未決表記・検証結果は各調査時点の記録として残す。

調査日: 2026-10-06。対象: [LLM 接続と費用制約を満たす方式を決める](https://github.com/Kurarowa305/scene-craft/issues/2)。本書は判断材料であり、方式の採用決定ではない。[初期要件](../requirements/initial-scope.md#app)と[ADR 0003](../adr/0003-dedicated-chat-with-chatgpt-plan.md)を前提とする。

比較後の判断: 利用者は実行処理と文脈管理の自作を減らすことを優先し、app-server を採用する方針を選んだ。[ADR 0004](../adr/0004-codex-app-server-runtime.md) に理由を、[現在の設計](../design/llm-connection.md) に合意済み事項と残る問いを記録する。その後、利用者は認証も Codex 管理に確定し、自動補充無効・既存クレジットなしを確認した。以下の専用 OAuth 案の比較・費用運用は判断時点の根拠として残し、現在の認証方式は設計資料を参照する。

## 確認範囲と今回の合意

- **利用者確認済み:** background-agent で応答完了、画像入力、再起動後の会話再開、モデルからのツール呼び出しと結果返送を検証済み。同じ接続方式の再検証は求めない。これは2026-10-06の利用者回答であり、同アプリの古い検証文書の「未検証」より優先する。
- **費用の運用を合意済み:** 人間が ChatGPT 側で該当アプリの credits 利用無効を確認する。OAuth 成功だけを追加課金なしの保証としない。設定確認不能時は推論を開始しない。
- **今回の調査:** 公開公式文書、background-agent のソース、導入済み Codex CLI 0.160.0 の生成 schema を読み取った。実推論、認証、秘密・保存会話の読み取り、background-agent の変更は行っていない。
- **未検証:** scene-craft 自体、app-server を用いる今回の構成、Blender 操作、制作中断からの整合した再開。利用者の接続確認をこれらの完成まで拡張しない。

## 比較する二つの構成

| | A: Responses 直接接続 | B: Codex app-server 採用 |
| --- | --- | --- |
| 呼び出し経路 | scene-craft → 公開 Responses API | scene-craft → stdio RPC → app-server → 公開 Responses API |
| 認証の所有者 | scene-craft が専用 OAuth 登録・保存・更新を管理 | 同じ専用 OAuth を scene-craft が管理し、access token を子プロセスへ渡す |
| エージェントの実行 | scene-craft がモデル・ツールの往復を組み立てる | Codex のエージェント実行基盤へ依頼し、進捗・ツール・完了イベントを受け取る |
| 出発点 | 利用者が確認した background-agent の接続部 | 公式の ChatGPT 契約枠用 provider 設定と Codex の thread/turn API |

A は[公式の直接接続](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、B は[公式の app-server 構成](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)に対応する。B の採用は通信の中継を足すだけではなく、推論・ツール実行・会話文脈を動かす責任を Codex に委ねる設計判断になる。

ここで B に使うのは `env_key=ACCESS_TOKEN`、公開 API の Responses provider、`requires_openai_auth=false`、`supports_websockets=false`。別の Codex ログインは不要である。Codex 自身の ChatGPT ログインや実験的な `chatgptAuthTokens` モードは別経路なので、更新動作・利用枠を同一視しない。[SIWC app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)、[app-server 認証](https://learn.chatgpt.com/docs/app-server#auth-endpoints)

### 別案: Codex 自身の ChatGPT ログインを使う

app-server には `account/login/start` の `chatgpt` / `chatgptDeviceCode` で Codex が OAuth・token保存・自動更新を管理する方式もある。この方式なら認証管理をCodexに任せられ、上記の「自前refresh後に子プロセスを再起動」はapp-server全般の制約ではない。ただしSIWCのアプリ専用登録とは異なる経路なので、今回合意したアプリ別credits無効の確認方法、費用条件、利用可能な機能、既存Codex利用との分離がどう対応するかは追加調査が必要。background-agentの成功をこの方式の実接続成功へ引き継がない。[app-server 認証方式](https://learn.chatgpt.com/docs/app-server#auth-endpoints)

## 機能と責任の比較

表の「必要」「向く」は、公式機能とscene-craft要件を照合した設計上の評価である。

| 観点 | A: Responses 直接接続 | B: Codex app-server 採用 |
| --- | --- | --- |
| 工程別エージェント | 指示・入力・ツール・停止条件を自作ループで管理する。制作操作へ絞った振る舞いを定義しやすい | Codex のループ、指示、承認、ツール機構を利用する。scene-craft の変更範囲・保護指定をどこで強制するかは別途必要 |
| 文脈圧縮 | 原文とは別に要約・必要履歴の選択を実装する。background-agent は全完了履歴を再送し、サイズ上限で停止する | 自動圧縮の閾値設定と `thread/compact/start` がある。制作意図や採否を圧縮後も保持する入力設計は必要 |
| ツール統合 | namespace function tool を自分で検証・実行・結果返送する。MCP を使いたければローカルの橋渡しを作る | ローカル MCP を使える。ホストへツール実行を依頼する `dynamicTools` / `item/tool/call` は実験的 API |
| 原文履歴 | 受信した本文・イベントと継続用入力の保存形式を自分で決める | Codex のローカル thread 履歴と再開を利用できる。scene-craft の原文保存・要約・書き出し要件に十分かは確認が必要 |
| 制作履歴 | 作品、保存状態、編集案、採否、手修正をscene-craftが管理する | 同じ。Codex の会話ログを制作履歴の代わりにはできず、thread/turn/item と作品の記録を結び付ける |
| 停止・再開 | 通信中断と途中記録を自作する。ツールの副作用との整合を直接制御できる | `turn/interrupt` と `thread/resume` を使えるが、Blender側の停止・完了判定や二重実行防止は別途必要 |
| モデル選択 | 同じ OAuth で `/v1/models` を取得する | `model/list` は同providerでも内蔵・キャッシュ一覧の可能性がある。アカウント固有の現行選択肢は `/v1/models` で取得する |
| 保守 | 自作ループ、圧縮、再開、イベント処理の保守が増える | Codex版・設定・RPC互換性・子プロセス管理の保守が増える。既存の実行機構を利用する分、自作範囲を減らせる |

根拠: [app-server のライフサイクル・動的ツール](https://learn.chatgpt.com/docs/app-server)、[圧縮設定](https://learn.chatgpt.com/docs/config-file/config-reference)、[契約枠経路の制約](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)、[モデル一覧](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)。制作履歴と保存義務は[初期要件](../requirements/initial-scope.md#records)による。

## 両方式に共通する制約

この契約枠経路では HTTP 推論を `store:false`、`stream:true` とし、必要な履歴をリクエストへ含める。画像はモデルが対応する場合に利用できる。namespace の function/custom tool は利用できる一方、hosted MCP、画像生成、Code Interpreter、Responses `tool_search` などは非対応。**Codex がローカルで実行する MCP と hosted MCP は別物**であり、B を採っても非対応の Responses 機能が使えるようにはならない。[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

費用制約を満たすための確認条件は A/B で共通する。今回の比較は同じアプリ専用 OAuth と利用設定を使う。ChatGPT のアプリ別利用許可・credits 設定は人間が確認し、API キーへの切替を実装しない。確認した公開資料には、scene-craft が credits 無効を自動確認・強制する方法を見つけていない。この不在は確認範囲の限界であり、APIが存在しないとの断定ではない。[Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines)

契約枠の消費量や応答時間は比較測定していない。送信する文脈・圧縮・ツール往復が異なるため、同じ認証を使うことだけで消費量も同じとは扱わない。

認証更新も両方でscene-craftの責任になる。A は次の送信へ更新済みtokenを使える。B の公式 `env_key` 構成では、更新後のtokenで app-server を再起動し、保存したthread IDで再開する。実行中の制作操作をその境界でどう保全するかを決める必要がある。[SIWC app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)

## 再試行と制作状態の扱い

background-agent は SDK retry を0にしている。Codex provider には HTTP 用 `request_max_retries`（既定4）と SSE 中断用 `stream_max_retries`（既定5）がある。そのまま使えばscene-craft側から見えない通信再試行が増え得る。[background-agent 接続実装](../../../background-agent/src/engine.mjs)、[公式設定一覧](https://learn.chatgpt.com/docs/config-file/config-reference)

[初期要件](../requirements/initial-scope.md#execution)の「依頼ごとの自動再実行は最大2回」は、通信再試行、モデルによる操作方法の修正、副作用ツールの再実行の関係を定義して実装する必要がある。B の二つの設定をそれぞれ2にしても、依頼全体の上限2回は表せない。A/Bとも、利用上限と人間の停止を通常の再試行へ入れず、実行済みか不明なBlender操作を無条件で繰り返さない設計が必要になる。

公式仕様では、利用上限超過と一時的な利用可否確認失敗は別のエラーである。前者は新規推論を停止し、後者は資格情報を保持した限定的な復旧候補となる。401だけを根拠に資格情報を破棄・再認証させず、scope・登録・失効を診断する。どの方式でも、機密を除いたHTTP状態・構造化コード・request IDを保ち、UIの復旧案へ変換する必要がある。[Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)

原文、要約、モデルへ渡す文脈、制作状態を分けるのは両方式で必要である。圧縮や失敗によって原文や実行済み操作の記録を失わせず、採用済みの保存状態と実行中の編集案を照合して再開する。これは[原文保存と制作履歴の要件](../requirements/initial-scope.md)から導く設計条件であり、app-serverの一般的な会話再開だけで満たせるとの確認はない。

## background-agent からの再利用判断

| 区分 | 対象と根拠 |
| --- | --- |
| 両方式で再利用候補 | OAuth の state/nonce/PKCE・ID検証・scope確認・直列refresh（`src/auth.mjs:15–134`）、原子的保存（`src/storage.mjs:6–17`）、セッション単位の本人確認ゲート（`src/server.mjs:67,75,138–154`）。アプリ名と保存先はscene-craft専用にする |
| Aで再利用候補 | APIキー環境を排除した接続（`src/engine.mjs:69–78`）、ストリーム完了項目の統合（`89–105,126–158`）、画像正規化（`40–67`）、暗号化reasoningとcall IDを含む履歴往復（`110–169`） |
| Bで置換する箇所 | `Engine.run` の推論・ツールループとその継続履歴を、RPCクライアント・thread管理・イベント取り込みへ置き換える。OAuth部はBでも必要 |
| 修正必須 | 失敗ターン全体を継続履歴から除外する方式（`engine.mjs:110`）と、echo実行後に結果をまとめて保存する方式（`163–169`）は、副作用がある制作操作の再開へそのまま使えない |
| 修正必須 | `safeError` は `usage_unavailable` と利用上限を同分類にし、401を一律再認証案内へ寄せる（`engine.mjs:27–38`, `public/app.js:9–10`）。scene-craftでは公式の復旧条件を区別する |

上表のパスは同じPCの隣接リポジトリ [background-agent](../../../background-agent/) 内。tokenは0700/0600の保護されたJSONに保存され、暗号化保管ではない。refresh終端コードの列挙、scope省略時の保持、replacement refresh token保存は既に実装されている。新しいID tokenを無検証で信頼せず最初に検証したIDを保持する実装であり、scene-craftでは長時間処理・アカウント切替・sign-out時の失効も含めて認証境界を決める。[実装](../../../background-agent/src/auth.mjs)、[公式のセッション管理](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)

## app-server の対象版と未確認事項

導入済み `codex-cli 0.160.0` で `app-server generate-json-schema --experimental` を実行し、推論なしで確認した。`ThreadStartParams` は `baseInstructions` / `developerInstructions` / `dynamicTools` / `config` を持ち、`ThreadResumeParams` は指示とconfigを持つが `dynamicTools` フィールドを持たない。`DynamicToolCallParams` はcall/thread/turn ID、結果はcontent itemsとsuccessを持つ。これは型の存在確認であり、動作確認ではない。

最新公式資料は動的ツールの永続化と再開を説明するが、実装対象は導入版のschemaを基準にする。Bを選ぶ場合、次を追加の統合確認対象とする。同じ直接接続の既確認項目を繰り返すものではない。

- ローカルMCPと動的ツールのどちらを選ぶか、必要な権限制約と設定を維持できるか。
- 契約枠で非対応の `tool_search` 等を出さない設定、不要なshell等の無効化。
- OAuth更新に伴う再起動・thread再開、停止時のツール結果保存、RPCエラーからの復旧。
- 文脈圧縮がこのproviderで動作すること、原文と制作履歴が保持されること。
- 通信再試行の実効回数・上限停止・モデルからの再実行の計数と、依頼全体の上限との対応。

根拠: [app-server](https://learn.chatgpt.com/docs/app-server)、[SIWC制約](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)、[設定一覧](https://learn.chatgpt.com/docs/config-file/config-reference)。自動圧縮のAPI・設定の存在と、このproviderでの成功は区別する。

## 選択で引き受けるもの

**Aが向く条件（評価）:** 制作ツール、依頼の実行上限、再開時に渡す文脈をscene-craftで一貫して制御したい場合。既確認の接続資産を活かせる一方、長い会話の圧縮や堅牢なエージェントループを自作・保守する負担を引き受ける。

**Bが向く条件（評価）:** Codexのエージェント実行・文脈圧縮・ローカルMCPを基盤として使いたい場合。自作を減らせる一方、Codexのプロセス・版・設定・RPCへ依存し、制作固有の履歴・保護指定・停止・再実行をその外側で整合させる負担を引き受ける。

どちらも専用会話アプリと費用制約には整合し得る。判断の中心は接続の可否ではなく、**エージェントの実行と文脈管理を自作するか、Codexを採用するか**である。
