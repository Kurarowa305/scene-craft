# scene-craft

Blender と Photoshop を使った背景イラスト制作を支援する基盤。初期版を実装中です。作品・空のチャット・LLMなしの本文記録から利用できます。起動・検証と未確認事項は[Issue #58 の実装と確認](docs/verification/issue-58.md)を参照してください。

- [初期要件](docs/requirements/initial-scope.md)
- [公開中の設計ポータル（GitHub Pages）](https://kurarowa305.github.io/scene-craft/)
- [設計ポータルのソース（HTML）](docs/design/index.html)
- [詳細設計の一覧と設計 Issue（Markdown）](docs/design/README.md)
- [現実装のMCPツール・バックエンドAPI・DB一覧](docs/implementation-catalog.md)
- [開発の進め方と使用スキル](docs/agents/development-workflow.md)
- [用語集](GLOSSARY.md)
- [確定した画面・制作導線の設計](docs/design/user-interface.md)

画面設計の根拠となる[操作できるプロトタイプ](https://github.com/Kurarowa305/scene-craft/blob/5298534c2939aa44683baa6ebd3ced8285801466/docs/design/prototypes/user-interface/README.md)は、`prototype/user-interface-12`ブランチのコミット`5298534`に保存しています。

別セッションで再開するときは、開発の進め方を読み、設計一覧から未着手かつ依存先が完了した Issue を選んでください。

設計ポータルは `docs/design/index.html` をブラウザで直接開いてください。ビルド・サーバー・外部CDNは不要です。GitHubではHTMLがソース表示になるため、取得したリポジトリから開きます。既存Markdownはすべて維持し、現在の詳細設計はMarkdown、合意と経緯は設計Issue、全体像から厳密な仕様まではHTMLで確認できます。

GitHub Pagesは `main` ブランチの `docs` フォルダーから公開します。`docs/index.html` が設計ポータルへ案内します。設計HTML・CSS・JavaScriptを更新してmainへ反映すると公開内容も更新されます。`.nojekyll`で静的ファイルをそのまま配信し、詳細MarkdownへのリンクはGitHub上のmainの資料を参照します。

## 制作ファイルを取り込む

保存済みのblend・PSD/PSB・プレビューを登録して、初回の保存状態と手修正の前後を記録できます。起動時の保存ルート設定、依存宣言、未完成・照合待ちの扱いは [取り込み実装の運用](docs/implementation-59.md) を参照してください。Blenderによる内容検査と制作実行は後続実装です。

## 定義・作風の版を固定する

設定で既定定義のGitコミットを選び、作品作成時に作風の別コミットまたは作風なしを指定できます。保持タグ・使用blobを検査してから固定し、固定済み内容を画面で確認できます。起動設定、manifest形式、公開APIと後続実装との境界は [Git版固定の運用](docs/implementation-60.md) を参照してください。

## 参考資料を検索して選ぶ

参考調査の検索・出典付き候補保存・会話による選択と、右側「参考資料」タブを利用できます。Windows起動スクリプトの更新と画面操作は [Issue #65の実機確認手順](docs/verification/issue-65.md) を参照してください。実Codex・Windows実機の確認結果は自動試験と分けて記録します。
