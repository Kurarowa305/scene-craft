# Codex app-server の実接続確認

現在の設計: 2026-10-12 に [LLM 接続設計](../design/llm-connection.md) を合意した。費用確認は利用者が担い、基盤側の確認と利用情報取得失敗による送信保留は設けない。以下の費用確認案・未決表記・検証結果は各調査時点の記録として残す。

2026-10-06、[LLM 接続と費用制約を満たす方式を決める](https://github.com/Kurarowa305/scene-craft/issues/2) の判断材料として、採用済みの Codex 管理の ChatGPT 認証で実接続を確認した。background-agent の直接接続の再検証ではなく、app-server に変更した範囲を対象とする。

## 結果

**stdio 接続、応答完了、画像入力、動的ツール往復、プロセス再起動後の会話再開、文脈圧縮後の継続、認証更新要求、中断と再開を確認できた。** アプリの本実装や Blender 操作の検証ではない。

| 確認 | 実際の操作と判定 | 結果 |
| --- | --- | --- |
| 認証・費用の前提 | `account/read` が `type=chatgpt`。`account/rateLimits/read` が `ordinaryUsageAllowed=true`、`credits.hasCredits=false`、`unlimited=false`、`balance="0"`。各段階の開始前と終了後に確認 | 成功。自動補充無効は利用者の確認を根拠とし、API で取得したとは扱わない |
| ストリーミングと完了 | `item/agentMessage/delta` を受け取り、`turn/completed` の `status=completed` と最終本文を確認 | 成功。初回は本文差分 53 件 |
| 画像入力 | [480×180 の検証画像](evidence/codex-app-server-fixture.png)を `localImage` で送信。画像の内容をプロンプトで教えず、色・形・左右の順序を答えさせた | 左から赤い正方形・緑の三角形・青い円と一致 |
| 動的ツール往復 | `thread/start.dynamicTools` で無害なツールを一つ登録。モデルからの `item/tool/call` に、その場で生成した検証用文字列を返した | `dynamicToolCall` 完了と、その文字列を含む最終応答を確認 |
| 再起動と会話再開 | app-server を終了し、別プロセスで `thread/resume`。以前の識別文字列とツール結果を再提示せず質問した | 両方に一致。ツール定義を再登録せず、復元されたツールを再び呼べた |
| 文脈圧縮 | `thread/compact/start` 後、`contextCompaction` の完了と turn の正常終了を待ち、以前の識別文字列と画像の内容を質問した | 圧縮後の応答も一致 |
| 原文の保持 | 圧縮と再開後に、今回作った thread だけを `thread/read(includeTurns=true)` で取得した | 初回の最終応答の全文が一致。今回の履歴は 6 turns |
| Codex 管理の認証更新要求 | `account/read(refreshToken=true)` が成功し、その後同じ会話で実モデルの turn を実行した | 成功。更新後も ChatGPT 認証。期限切れ・取消済み認証の復旧を試したわけではない |
| 人間による中断に相当する操作 | 検証ツールへの要求を受けた時点で結果を返さず、`turn/interrupt` を送信した | `turn/completed.status=interrupted` を検出。途中本文を完了扱いにしなかった |
| 中断後の明示的な再開 | 新しい turn で、中断した操作を繰り返さず以前の識別文字列だけを返すよう依頼した | 正常終了し、ツールを再実行しなかった |

レスポンス本文・終端状態・イベント件数は [検証結果 JSON](evidence/codex-app-server-connection.json) に保存した。アカウント識別子・メールアドレス・認証情報・既存会話は含めていない。

## 検証構成

- WSL 上の導入済み Codex CLI `0.160.0` を `codex app-server --stdio` で起動した。
- `initialize` / `initialized` の初期化を行い、動的ツールの確認に限って実験 API を有効にした。
- `model/list` が返した既定の `gpt-6.1-sol` を使用。reasoning effort は `low`、service tier は `default` とした。製品の既定モデルを恒久的にこの名前へ固定する判断ではない。
- 認証・保存・更新は既存の Codex に任せた。`forced_login_method="chatgpt"`、`model_provider="openai"` を起動時に指定し、API キー用環境変数を子プロセスへ渡さなかった。組み込み OpenAI provider と ChatGPT 接続先に個別上書きがないことも確認した。既存設定ファイルは変更していない。
- 作業場所は検証用の一時ディレクトリとし、sandbox は read-only、承認方針は never。通常の MCP・プラグイン、シェルツール、Web 検索、マルチエージェント、メモリを無効にして、検証ツールだけを呼ぶ指示を与えた。
- 検証用クライアントは `/tmp/scene-craft-connection-check/probe.py` と `live.py` に作成した。一時的な検証コードであり、製品のエージェント実行処理として採用しない。モデルを呼ぶ段階は `first` → `resume` → `compact` → `interrupt` の順に別プロセスで実行した。

`account/read` のプラン値は `prolite` だった。今回の観測値として保存し、表示上の「Pro」と API の文字列が常に `pro` で一致する前提にはしない。費用判定をプラン名だけに依存させない。

## 起動時に分かった制約

既存の Windows 側 Codex 保存先を使った最初の起動は、SQLite 状態ランタイムの初期化に失敗した。原因を Windows と WSL の同時利用やファイルシステムの制約と断定してはいない。`sqlite_home` と `log_dir` を WSL の検証用ディレクトリへ指定すると起動でき、その構成で上記の確認が通った。

この切り分けで分離したのは SQLite とログの保存先であり、認証やすべての会話保存を完全分離したわけではない。製品では起動場所と Codex の保存領域を一緒に設計し、[アプリ全体と Windows・WSL の責務を決める](https://github.com/Kurarowa305/scene-craft/issues/3) へ引き継ぐ。

検証クライアントの初期版は MCP 名を引用符付きの dotted key として起動オプションに渡したため、別名の不完全な設定として解釈されて起動に失敗した。実際の設定キーに合わせて修正した。これは LLM 接続障害ではなく、検証クライアントの設定指定の誤りである。

## 設計への反映と未確認範囲

- 接続はローカル実行プロセスから stdio を用い、本文の表示と turn の完了を分けて扱える。再起動後の再開には保存した thread ID を用いる。
- 動的ツールで外部の制作操作を呼ぶ経路は成立したが、実験 API である。正式なツール契約に動的ツールと MCP のどちらを使うかは、安定性と実装量を比較して決める。
- 圧縮後の原文取得は今回の短い会話で確認できた。長期の制作履歴保持や任意の過去版の復元まで保証する結果ではなく、scene-craft 側の制作履歴管理を代替しない。
- 中断の確認は、副作用がない検証ツールの結果待ちを止めたもの。外部ツールが既に変更した制作データの取消・整合性・二重実行防止は、制作操作の設計と検証が必要。
- 認証の期限切れ・取消・別アカウントへの変更、通信切断、プロセスの強制終了、利用上限到達、自動補充設定の変更は試していない。上限を使い切る検証やクレジット購入は行わない。異常系の分類・模擬と運用確認を後続で扱う。
- 認証更新は Codex への更新要求とその後の継続を確認した。トークン本体を取り出して差分を検査したり、失効を人為的に起こしたりしていない。

RPC の根拠は [公式 app-server 文書](https://learn.chatgpt.com/docs/app-server) と、導入済み CLI が `app-server generate-json-schema --experimental` で出力した schema。現在の合意と残る判断は [接続設計](../design/llm-connection.md) を参照する。

<a id="recovery-notes"></a>

## 2026-10-07 の復旧設計に向けた schema 確認

以下は文書と 0.160.0 の生成 schema の読み取り結果であり、新たな実接続・異常系試験の結果ではない。

- `ErrorNotification` は `error`、`threadId`、`turnId`、`willRetry` を持つ。通知名は `error`。`codexErrorInfo` は省略・null・文字列・オブジェクトの場合があり、wire 値は `usageLimitExceeded` 等の camelCase である。`willRetry=true` を最終失敗とせず、`turn/completed` を待つ。内部再送が一回ごとに通知される保証は確認できず、通知件数を再実行予算へ直結しない。[公式 app-server](https://learn.chatgpt.com/docs/app-server#errors)
- provider の `request_max_retries` と `stream_max_retries` は別の通信再試行設定であり、制作依頼全体の回数ではない。両者を 2 にしても「一依頼最大 2 回」を保証せず、0 にしても認証更新やモデルによる操作修復まで一切なくなる保証は確認できない。[設定一覧](https://learn.chatgpt.com/docs/config-file/config-reference)
- `GetAccountResponse` には nullable な `workspaceRouting` があり、その中に `chatgptAccountId` がある。`GetAccountRateLimitsResponse.accountId` も nullable。二つが同じ ID 空間であるという公開保証は未確認。メール・プラン名・workspace ID だけから人物の同一性を推定しない。
- `account/updated` と `account/rateLimits/updated` は、確認した schema ではアカウント ID を含まない。通知だけで接続先の同一性を判断せず、更新後の応答を取得する。認証情報が切り替わる前の利用枠を、新しいアカウントに流用しない。
- `TurnStartParams.clientUserMessageId` と読み戻しの `UserMessageThreadItem.clientId` は存在するが、入力と出力の対応・重複排除・クラッシュ時の永続化保証は確認できない。これを冪等キーとして受付不明の依頼を再送する根拠にはしない。
- `thread/read(includeTurns=true)` は履歴照合に使える。ただし履歴にないことは未実行の証明ではない。送信前の依頼記録、既知の turn/item、制作操作側の記録と照合し、対応不明なら自動再送しない。これは schema と公開文書の保証範囲から導く設計上の判断である。[thread/read](https://learn.chatgpt.com/docs/app-server#read-a-stored-thread-without-resuming)
