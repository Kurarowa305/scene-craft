# 工程別エージェントから使う Blender ツールの適合調査

調査日: 2026-10-31。[エージェント契約の設計](https://github.com/Kurarowa305/scene-craft/issues/9)に対する補助調査。事実確認と設計上の提案を分ける。本資料では製品の採用・非採用を確定せず、インストール・設定変更・実機検証も行っていない。

## 前提と確認対象

現行の[Blender連携設計](../design/blender-integration.md)は、保存済み入力をコピーし、Windows Blender を background 起動して Python で編集案・レンダーを生成する。[全体設計](../design/application-architecture.md)の Windows 補助プロセスが実行を所有し、制作管理・実行管理が保護指定、採否、停止、照合、再実行予算を管理する。この合意を既製ツール名から暗黙に変更しない。

対象は作者公開の [ahujasid/mcp-for-blender](https://github.com/ahujasid/mcp-for-blender)。旧称 blender-mcp。確認した HEAD は `992233bb258975a05eec8b5691465c50c2831e34`（commit日時 2026-10-29）。以下のリンクはこのコミットへ固定した。Blender Foundation の公式ツールではない。

MCP という接続プロトコルの採用と、この既製サーバーの採用は別の判断である。scene-craft の操作管理を MCP 経由で公開しても、この既製ツールを使うことにはならない。

## 既製ツールで確認した機能

作者の[公開ツール一覧](https://github.com/ahujasid/mcp-for-blender/blob/992233bb258975a05eec8b5691465c50c2831e34/README.md#capabilities)と固定ソースを確認した。

| 公開ツール | 用途 | scene-craft との対応候補 |
| --- | --- | --- |
| `execute_blender_code` | 起動中の Blender 内で Python 実行 | 仮形状、配置、UV、材質、環境設定。ただし操作の用途別権限・保護をこれだけでは表現しない |
| `get_scene_info` | シーン内の対象情報を取得 | 計画・制作前の確認 |
| `look` | viewport・camera・複数方向・画像等を観察 | プレビューの確認。ただし既存の保存済み入力からの記録用プレビューとは別経路 |
| `search_assets` / `import_asset` | Poly Haven・Sketchfab・Poly Pizza の候補検索と取り込み | 素材検索の参考。初期採用サービスの ambientCG・指定フォルダー検索を網羅する契約ではない |
| `get_addon_status` | Blender／アドオンの版と有効機能の確認 | 実行環境確認 |
| `generate_3d` | 外部の生成サービスで作成して取り込む | 初期要件で採用済みとは扱わない |
| `disable_telemetry` / `record_trajectory_feedback` | 収集制御・フィードバック | 制作操作とは別の管理機能 |

機能名があることは、工程別の品質・変更範囲・利用条件・編集可能性を保証する根拠ではない。

## 現行契約との適合

| 観点 | 一次資料で確認した事実 | scene-craft の設計上の評価 |
| --- | --- | --- |
| background 実行 | `BlenderMCPServer.start()` は `bpy.app.background` の場合にサーバー開始を拒否する。GUI または仮想ディスプレイでの実行を案内している | 現行の Windows background 経路へ無変更で接続する候補にはならない。GUI方式へ変える場合は既存設計の見直しが必要 |
| 実行する対象 | アドオン内で `exec(code, namespace)` により起動中シーンへ操作する | 入力コピー・出力隔離・保存状態固定を別途実装する必要がある |
| 要求と結果 | MCPサーバーからアドオンへの要求は `type` と `params`。送受信をロックし応答を順序で対応付ける | scene-craft の依頼・操作・試行ID、永続受付、世代・所有権を管理する契約とは別物 |
| 結果不明と停止 | 通信の180秒timeoutは接続を無効化するが、その時点で制作処理の取消・保存済み結果の照合まで確定する契約ではない | timeoutを未実行とみなして再送してはいけない。scene-craft 側で停止・状態確認・重複防止が必要 |
| 変更範囲・保護指定 | `execute_blender_code` の入力はコードと依頼原文。safe mode はコード内の危険な操作を制限するが、Blenderの編集・保存・import/exportを許可する | 作品の保護対象・間接変更・採用時検査・依頼全体の再実行予算を強制する仕組みの代替にはならない |

根拠: [アドオンのbackground拒否](https://github.com/ahujasid/mcp-for-blender/blob/992233bb258975a05eec8b5691465c50c2831e34/addon.py#L1329-L1334)、[アドオンのコード実行](https://github.com/ahujasid/mcp-for-blender/blob/992233bb258975a05eec8b5691465c50c2831e34/addon.py#L2323-L2348)、[送受信とtimeout](https://github.com/ahujasid/mcp-for-blender/blob/992233bb258975a05eec8b5691465c50c2831e34/src/blender_mcp/server.py#L198-L265)、[コード実行ツールとsafe mode](https://github.com/ahujasid/mcp-for-blender/blob/992233bb258975a05eec8b5691465c50c2831e34/src/blender_mcp/server.py#L791-L820)。

これは関連経路のソース確認に基づく評価であり、リポジトリ全体にあらゆる安全機能が存在しないとの主張ではない。safe mode 自体の耐性や他機能の網羅検査は行っていない。

## 設計へ戻す提案と未決事項

現行の保存済み入力・background実行を維持するなら、Windows補助プロセスとBlender Pythonによる操作を共通ツールとして公開する案が適合する。必要ならその入口をMCPにする。この案と既製MCP for Blenderの採用は区別して、利用者との設計判断へ戻す。

各役割の対応表では「モデルへ公開するツール」「内部で呼ぶBlender Python／素材サービス等」「変更可能な対象」「人間の選択」「完成を検証する条件」を分ける。検索と取り込み、生成と採用、プレビューと13レイヤー出力を一つの成功扱いにしない。

未決事項は、MCPとapp-server動的ツールの選択、操作ツールの粒度・引数、生成Pythonの実行範囲、保護検査の実装、依頼・操作・試行IDの具体スキーマ。これらは本調査で確定していない。

実機では、入力コピーの保全、停止・通信断・保存途中終了、再送の二重実行防止、範囲外／共有データ経由の変更拒否、依存素材保持、各工程の編集可能性を確認する必要がある。既製サーバーの最新機能や動作を本資料のソース確認だけで受け入れ済みとは扱わない。
