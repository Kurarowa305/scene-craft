# 設計項目と資料

[scene-craft 初期構築の設計マップ](https://github.com/Kurarowa305/scene-craft/issues/1) を設計作業の入口とする。[初期要件](../requirements/initial-scope.md) は合意済みで、以下は実装前に決める13領域である。2026-10-06 に設計 Issue を登録した。2026-10-12 に LLM 接続・費用制約の設計を合意した。Codex app-server と Codex 管理の認証を採用し、費用条件の確認は利用者が担う。モデル選択、停止・再開、再実行の契約と後続への引き継ぎは [接続設計](llm-connection.md) にまとめる。同日、[Blender連携設計](blender-integration.md)も最終合意した。Windowsのbackground操作、編集可能な制作データ、13レイヤーの16bit sRGB PSD／上限時PSB、停止・失敗契約を確定した。同日、[全体設計](application-architecture.md)も最終合意し、Windows 起動管理・WSL バックエンド・Windows 実行補助プロセスの責務、通信、停止と再接続を確定した。同日、[データモデル設計](domain-data-model.md)も最終合意し、ブランチグラフを支える保存状態・変更・採否、理由の訂正履歴、復元・派生・振り返りの参照関係を確定した。2026-10-18、[Git版管理設計](git-versioning.md)で受付時の版固定、保持用タグとGitHubへの明示push、作風更新・互換性・ローカル形式の移行を合意した。Git専用の独自バックアップ機能は初期の必須範囲から外す。設計完了と本実装・異常系の検証完了は区別する。

Issue の状態・依存関係・担当者は GitHub を正とする。この一覧は領域と資料化先の対応を示す。開始時は親 Issue の子 Issue と依存関係を取得する。登録時点で着手可能なのは「LLM 接続と費用制約を満たす方式を決める」と「Blender の操作経路とレンダー出力契約を決める」。それ以後の進捗は GitHub で確認する。

## 項目一覧

設計がまとまった項目から資料を作成する。下表のファイル名は作成予定先であり、未作成の資料を設計済みとして扱わない。作成したらファイル名をリンクに更新する。大きい問いは追加 Issue に分割して、この領域の資料へ統合する。

| 領域 | 設計 Issue | 設計資料の作成先 |
| --- | --- | --- |
| LLM 接続・費用制約 | [LLM 接続と費用制約を満たす方式を決める](https://github.com/Kurarowa305/scene-craft/issues/2) | [llm-connection.md](llm-connection.md)（設計合意済み） |
| 全体構成・OS の責務 | [アプリ全体と Windows・WSL の責務を決める](https://github.com/Kurarowa305/scene-craft/issues/3) | [application-architecture.md](application-architecture.md)（設計合意済み） |
| Blender 連携・出力 | [Blender の操作経路とレンダー出力契約を決める](https://github.com/Kurarowa305/scene-craft/issues/4) | [blender-integration.md](blender-integration.md)（設計合意済み。出力方式の実装検証は[後続調査](https://github.com/Kurarowa305/scene-craft/issues/16)） |
| ドメイン・データモデル | [作品と制作履歴のデータモデルを決める](https://github.com/Kurarowa305/scene-craft/issues/5) | [domain-data-model.md](domain-data-model.md)（設計合意済み） |
| 保存・復元・バックアップ | [制作データの保存・復元・バックアップ方式を決める](https://github.com/Kurarowa305/scene-craft/issues/6) | `artifact-storage.md` |
| 実行状態・再実行 | [実行状態・順序制御・再実行・復旧を決める](https://github.com/Kurarowa305/scene-craft/issues/7) | [execution-lifecycle.md](execution-lifecycle.md)（設計合意済み） |
| 編集案・保護指定 | [編集案の採用と保護指定の適用方法を決める](https://github.com/Kurarowa305/scene-craft/issues/8) | `edit-candidates.md` |
| エージェント契約 | [工程別エージェントの入出力とツール契約を決める](https://github.com/Kurarowa305/scene-craft/issues/9) | `agent-contracts.md` |
| 文脈・作風・制作方針 | [会話の文脈と作風・制作方針の利用方法を決める](https://github.com/Kurarowa305/scene-craft/issues/10) | `context-and-style.md` |
| Git の版参照・保持 | [Git の版固定・保持・更新互換性を決める](https://github.com/Kurarowa305/scene-craft/issues/11) | [git-versioning.md](git-versioning.md)（設計合意済み） |
| 画面・制作導線 | [専用アプリの画面と制作・記録の導線を決める](https://github.com/Kurarowa305/scene-craft/issues/12) | `user-interface.md` |
| 参考調査・素材サービス | [参考調査と素材サービスの選定・取り込み契約を決める](https://github.com/Kurarowa305/scene-craft/issues/13) | `reference-and-assets.md` |
| テスト・診断・受け入れ | [テスト境界・診断情報・初期版の受け入れ手順を決める](https://github.com/Kurarowa305/scene-craft/issues/14) | `testing-and-diagnostics.md` |

## 資料にまとめる内容

- 対象範囲、責務・構成
- データ・インターフェース・状態遷移など、合意した契約
- 制約・失敗時の扱い、他の設計との境界
- 未決事項と対応する Issue
- 根拠となる要件・設計 Issue・ADR・調査資料

資料の更新と Issue の解決を対応付ける手順、使用スキル、仕様・実装 Issue への移行は [開発フロー](../agents/development-workflow.md) に従う。ADR は重要な選択の理由を記録し、ここには現在採用している構成をまとめる。
