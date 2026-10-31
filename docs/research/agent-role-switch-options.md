# 同じ会話で工程を切り替えるための契約調査

確認日：2026-10-31。[エージェント契約の設計](https://github.com/Kurarowa305/scene-craft/issues/9)の補助調査。専用stdio MCP採用後の検討資料であり、方式の合意・実装・実機検証の完了を意味しない。

## 調査後の採用判断

2026-10-31、利用者が共通指示＋依頼ごとの工程指定と、受付側の権限検査を組み合わせる方式を承認した。以下の候補比較は調査時点の記録とし、現在の合意は[エージェント契約](../design/agent-contracts.md)を参照する。cold resume等の実動作の検証は未完了。

## 前提と資料

[文脈設計](../design/context-and-style.md)では、同じ会話はCodexの既存threadを継続・再開し、圧縮もCodexへ任せる。毎回独自要約だけで新規threadを作らない。[画面設計](../design/user-interface.md)では送信ごとに工程または「なし」を選べ、サイドチャットは相談専用とする。これらを維持した候補を比較する。

- 公式の[app-server文書](https://learn.chatgpt.com/docs/app-server)、[設定リファレンス](https://learn.chatgpt.com/docs/config-file/config-reference)を検索後に実ページで取得した。更新される文書であり、導入版の動作保証にしない。
- 導入済みCLI `0.166.0-alpha.5.1` の[保存済みschema抜粋](evidence/codex-app-server-ui-schema.json)と、以前の調査で生成済みの通常schema `ThreadResumeParams`／`ThreadStartParams` を照合した。生成物のSHA-256は同抜粋に記載されている。
- 実装の確認点は、既存調査と同じ公式コミット `67f0994b532b8740f14b5b738af7b7b2a915b1d6` に固定した。このソースと導入バイナリの同一性は確認していない。モデル推論・認証・既存設定変更・制作実行は行っていない。

## 確認した事実

| 対象 | 確認結果と限界 |
| --- | --- |
| 指示の指定場所 | 導入版の通常 `ThreadStartParams`／`ThreadResumeParams` に `baseInstructions`、`developerInstructions`、`config` がある。通常 `TurnStartParams` にはこれらの指示欄はない。型の存在は、読み込み済みthreadの指示が直ちに差し替わる保証ではない |
| 読み込み済みthreadへのresume | 固定ソースは、既存threadの設定と要求を比較する。`config`、`baseInstructions`、`developerInstructions` の指定は差異として記録され、購読中の既存threadへの再接続等では上書きを無視し、既存セッションを維持する経路がある |
| cold resumeへ移る例外 | 同ソースには、購読者がなく、idleで、agentがRunningではない場合に、既存セッションを正常shutdownしてからcold resumeへ進む経路もある。shutdown失敗・時間切れならそのまま再構築するとは限らない |
| cold resumeの設定 | 新規セッションを組み立てる経路は要求された指示・configを読み込む。既存thread IDと履歴を保つ候補になるが、購読解除から切替・復旧までの導入版の実動作は未検証 |
| MCP設定のscope | ツール許可・拒否リストが設定可能。公式文書では `config/mcpServer/reload` はディスク設定を読み直し、読み込み済みthreadへ更新を予約する。工程切替のたびに共有ディスク設定を書き換える方式は、並行する相談・制作への影響を別途検証する必要がある |
| MCPとthreadの対応 | `mcpServerStatus/list` はthread指定時にその接続を再利用する仕様。固定ソースにもthreadの現在MCP設定とruntime contextを使う経路がある。全MCP要求に信頼できる依頼ID／turn IDが常に付く保証とは別である |

ソース：[resume差異の列挙](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/request_processors/thread_processor.rs#L125)、[loaded threadの再利用・shutdown・上書き無視](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/request_processors/thread_processor.rs#L4688)、[cold resumeの設定読込経路](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/request_processors/thread_processor.rs#L3991)、[threadのMCP設定参照](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/request_processors/mcp_processor.rs#L138)。

## 設計へ戻す候補

| 候補 | 内容 | 評価 |
| --- | --- | --- |
| 共通指示＋依頼ごとの工程指定 | 同じthreadの共通指示に、現在の依頼へ束縛された工程・固定定義・制作文脈を使う契約を置く。工程の具体的指示はその依頼の入力として渡し、過去発言にある工程や版は履歴として扱う | 同じthreadを継続し、通常turnへ存在しない指示上書きや共有MCP設定のreloadへ依存しにくい。モデルが従うことと権限強制は別にする必要がある |
| 安全にunloadしてcold resume | 前turnと外部操作の終端を照合し、購読・生存セッションを安全に閉じ、同じthread IDに新しい指示と固定設定を指定して再開する | 役割固有の上位指示・MCP公開一覧を変えたい場合の候補。既にloadedなthreadへresumeするだけでは不十分。導入版で明示的な切替と応答設定の確認が必要 |
| 工程ごとに新規thread | UIの一会話へ複数のCodex threadを対応付ける | 履歴・圧縮の継続、他工程の原文参照、作品の最新共有情報をどう引き継ぐかが増える。現在の合意から自動的に採用してよい方式ではない |

第一案は**共通指示＋依頼ごとの工程指定と、受付側の権限束縛**とする。共通指示自体やMCP契約の版変更など、実際のthread設定更新が必要な場合だけ、安全なcold resumeを検証して使う案が考えられる。これは設計上の推奨であり採用済みではない。

## 受付側で必要な具体的契約の案

1. 同じthreadでは一つの進行中turnだけを扱う。役割変更・新しい依頼への切替は、前turnの終了と実行中ツール・外部制作処理の照合が済んでから行う。別threadのサイド相談は並行できる。
2. バックエンドが、専用MCPの信頼済み起動／接続と、会話・依頼・試行・現在のturn・世代を結び付ける。MCP引数にモデルが書いた役割名・作品ID・依頼IDを、そのまま権限にしない。
3. ツール受付時点で実行情報を固定し、処理の途中に「現在の依頼」を読み直して別依頼へ付け替えない。接続・依頼・世代の不一致、停止済み・失効した実行は拒否する。
4. 新turnへ権限を移す前に、前turnの未完了呼出・遅延通知・結果不明を解消する。解消できなければ新しい競合操作を開始しない。MCPメッセージの到着時に現在の依頼へ単純に紐付けるだけでは、古い呼出を新依頼と誤認し得る。
5. サイドチャットは別thread・読み取り専用の接続とし、更新ツールを公開せず、受付側でも制作・採否・記録・メインへの依頼を拒否する。シェル・外部MCP・書込可能パス等の迂回経路も別途制限する。
6. Git版・参照blob・権限・変更範囲は依頼の正本から解決する。履歴中の指示やモデルのツール引数で別版を読むことを許可しない。共通指示やMCP実装を固定Git内容から起動する契約も検査する。

上記は同時実行・停止・権限の設計案であり、汎用MCPが自動提供する機能ではない。信頼済み接続の識別方法、MCP要求からturnへの確実な対応、古い接続の失効、ツール一覧の切替は未実装・未検証。

## 導入版で残る確認

- 既存threadを継続し、工程変更後に以前の工程・定義版を現在値として使わないこと。
- 購読中resumeの上書き無視と、購読解除・正常shutdown後のcold resumeを分けて確認すること。
- 設定変更時に並行するサイドthreadへ更新権限が混入しないこと。共有ディスク設定のreloadを工程切替に流用しないこと。
- 前turnの完了通知・MCP要求・外部操作終了の順序、通信断・遅延・重複・再起動時に、古い呼出を次依頼へ結び付けないこと。
- 通常の参照と相談からシェル・別MCP等で制作管理を迂回できないこと。

実験を伴わず決められるのは、同じthreadの継続を基本とする方針、受付側での強制、切替前の照合、サイドの別threadと更新拒否である。具体的な指示差替えやMCP接続再構成が成立するかは、型や固定ソースの読解だけで受け入れ完了としない。
