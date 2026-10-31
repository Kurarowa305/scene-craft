# scene-craft制作ツールの接続方式比較

確認日: 2026-10-31。[エージェント契約の設計](https://github.com/Kurarowa305/scene-craft/issues/9)の補助調査。既製MCP for Blenderを初期採用せず、Windows補助プロセスとBlender Pythonを使う構成は利用者が合意済み。本資料は、その制作ツールの入口としてMCPまたはapp-server動的ツールを選ぶための事実と提案を記録する。接続方式の採用は未合意。

## 調査後の採用判断

2026-10-31、比較の説明後に利用者が専用stdio MCPを採用した。以下の「未合意」は調査時点を示す。現在の合意は[エージェント契約](../design/agent-contracts.md)と[全体構成](../design/application-architecture.md)を参照する。採用は実装・実機検証の完了を意味しない。

## 一次資料と確認方法

- OpenAI公式の[app-server文書](https://learn.chatgpt.com/docs/app-server)と[MCP文書](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)を検索後に取得した。更新される文書であり、導入版の保証にはしない。
- [既存の機能分担調査](codex-app-server-ui-capabilities.md)と[導入版のプロトコル抜粋](evidence/codex-app-server-ui-schema.json)を再利用した。
- 導入版 `codex-cli 0.166.0-alpha.5.1` から、空の一時 `CODEX_HOME` を指定し `codex app-server generate-json-schema --experimental --out <一時出力先>` を実行して型を照合した。ログイン・推論・既存会話の読み込み・設定変更・MCP接続は行っていない。
- 前提は[全体設計](../design/application-architecture.md)、[Blender連携](../design/blender-integration.md)、[実行状態](../design/execution-lifecycle.md)、[Git版固定](../design/git-versioning.md)。

## 比較

| 観点 | 専用stdio MCP | app-server動的ツール |
| --- | --- | --- |
| 接続と公開 | Codexが起動する専用ローカルMCPプロセスを経由する。制作管理へ渡す小さいアダプターとして設計できる | app-serverからクライアントへ `item/tool/call` 要求を送り、scene-craftが処理と応答を担う。別のMCPプロセスは不要 |
| 権限設定 | `enabled_tools`／`disabled_tools` の公開制御がある。サーバー単位の `enabled`／`required` 等も使える | `thread/start.dynamicTools` で公開する定義を渡す。呼出には `threadId`・`turnId`・`callId` がある |
| 形式と依存 | MCP設定とサーバー実装・起動・接続の管理が必要 | `dynamicTools` と呼出・結果フローは公式文書で実験APIと明記。導入版とcapabilityに依存 |
| 継続・工程切替 | threadに設定された接続と、専用Codex領域の有効設定を管理する。設定reloadは稼働中threadへ影響し得るので、工程切替のために共有設定を書き換える案は別途検証が必要 | 公式文書では定義がthreadに保存され、resume時に復元される。前工程の定義が消えたと仮定できない |
| 結果 | 導入版の `McpServerToolCallResponse` は `content`、`structuredContent`、`isError` 等を持つ | 導入版の結果は `contentItems` と `success`。内容はテキスト・画像URL・音声URLの型。製品では音声を追加しない。構造化ドメイン結果はJSONテキスト等で別途符号化する必要がある |
| 停止・完成 | MCPの呼出成功やtimeoutを、Blender停止・制作実体完成・採用の確定に使わない | turn中断や `success=true` を、外部処理停止・制作実体完成・採用の確定に使わない |

公式文書はstdio接続とツール公開設定、動的ツールの実験性・threadへの保持を裏付ける。結果の具体的フィールドは上記導入版の型確認による。MCPの `content` が任意JSONを許すことだけで、すべての画像形式がモデルへ届くと保証しない。動的ツールの画像URLも、画像の保存・可用性・モデル受理の確認とは別である。

## 方式を問わず必要な制約

以下は既存の制作・実行契約を接続へ適用する設計上の帰結であり、MCPや動的ツールが自動提供する機能ではない。

- 依頼・操作・試行・所有権・停止・再実行予算と権限はscene-craftの受付記録から検査する。モデルが引数へ書いた作品IDや工程名だけを信用しない。
- MCPでは専用起動／接続の権限と受付側の実行情報を結び付ける設計が必要。動的ツールは外側のthread/turn/call情報を利用できるが、ドメイン上の依頼へ照合する責務は残る。
- 相談から更新要求が届いたら受付で拒否する。ツール非公開に加え、組込みシェル・外部MCP・書込可能な制作パス等の迂回経路も制御する。read-only設定だけで外部副作用を禁止できたとは扱わない。
- 入力コピー、Blenderの所有プロセス、完成した出力、停止結果を独立して追跡する。接続切断・timeoutを未実行と解釈して再送しない。
- メインの工程切替でも共有情報と原文は維持し、指示・権限・Git版が意図どおり切り替わることを確認する。導入版の通常 `TurnStartParams` には `developerInstructions`／`dynamicTools` がなく、単なる通常turn送信だけでthread単位設定が切り替わるとは扱わない。

## 初期採用の推奨と未確認事項

**初期案はscene-craft専用のstdio MCPを推奨する。** 動的ツールの実験APIを新たな必須依存にせず、制作管理・実行管理を通常のモジュールとして保ったまま、小さいMCPアダプターで公開する。素材サービス等の既製MCPを無制限に接続する意味ではない。MCPだから安全・安定性が保証されるという判断でもない。

動的ツールは、呼出のthread/turn/call対応を直接取得し、同じクライアントで完結できる利点がある。実験APIの導入版固定・異常系確認・将来の変更対応を引き受けるなら合理的な代替候補になる。方式変更を黙って行うのではなく、同じ制作ツール契約を満たすアダプターとして選ぶ。

未確認なのは、専用MCP起動と実行権限の結合、工程別の公開一覧・指示変更、resume後の設定照合、画像結果の実際のモデル入力、並行相談と制作の分離、外部処理中断・timeout・再起動時の照合。現行版での両方式のend-to-end試験は未実施。本調査で設計・実装・受け入れを完了扱いにしない。

## 型の照合記録

今回の生成ファイルSHA-256。出力は一時領域であり、下記のフィールド観察を本資料へ残す。既存のプロトコル抜粋も併せて参照する。

| 型 | SHA-256 |
| --- | --- |
| `DynamicToolCallParams` | `401bba20cfbd95762bef0467d840430c46be53369093ad9f26425ba757e34efc` |
| `DynamicToolCallResponse` | `abb082cad67f11fcc98ba75f2eff75d7d1723af0c657655329b83ff160451a02` |
| `McpServerToolCallResponse` | `04a59b2064922c37b0c49bdb2470b8fff08d943e56dba4f7280a6b34bfa52c68` |
| `ThreadStartParams` | `80a40a7fac15b4bf70efb7f893fb353acc0a0d30c68f54aee4f01923deca85de` |
| `ThreadResumeParams` | `8152ea774ace4eb5623081abd64a1135f28cbff1e73ca641cfb80ac16f6eed32` |
| `TurnStartParams` | `c7483aee79757d260c4fc1bb5c68b1a8d6f72846388e9f1e88d6f76f423287c8` |
