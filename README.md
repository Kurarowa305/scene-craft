# scene-craft

Blender と Photoshop を使った背景イラスト制作を支援する基盤。現在は初期要件の合意が完了し、実装前の設計を進める段階です。

- [初期要件](docs/requirements/initial-scope.md)
- [設計項目と設計 Issue](docs/design/README.md)
- [開発の進め方と使用スキル](docs/agents/development-workflow.md)
- [用語集](GLOSSARY.md)

画面設計の確認用に、[操作できるプロトタイプ](docs/design/prototypes/user-interface/README.md)を`prototype/user-interface-12`ブランチに置いています。Python 3の1コマンドで起動でき、追加パッケージは不要です。LLM・Blenderへの接続や実ファイル操作は行いません。設計は利用者の確認待ちです。

別セッションで再開するときは、開発の進め方を読み、設計一覧から未着手かつ依存先が完了した Issue を選んでください。
