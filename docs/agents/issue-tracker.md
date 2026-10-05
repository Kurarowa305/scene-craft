# Issue 管理：GitHub

作業と実装用の仕様は Kurarowa305/scene-craft の GitHub Issues で管理する。
合意済み要件・現在の設計資料との分担は [開発フロー](development-workflow.md) に従う。
このリポジトリ内で gh CLI を使う。

## 操作

- 作成：gh issue create --title "..." --body-file <file>
- 閲覧：gh issue view <number> --comments
- 一覧：gh issue list --state open --json number,title,body,labels
- コメント：gh issue comment <number> --body-file <file>
- ラベル追加：gh issue edit <number> --add-label "..."
- ラベル削除：gh issue edit <number> --remove-label "..."
- クローズ：gh issue close <number> --comment "..."

複数行の本文は、実際の改行を含むファイルを渡す。

スキルが「Issue 管理先に公開する」と指示した場合は、
GitHub Issue を作成する。
「関連チケットを取得する」と指示した場合は、
Issue 本文とコメントを読む。

## PR を triage の受付対象にするか

PRs as a request surface: no.

## wayfinder の操作

- マップ：wayfinder:map ラベルを付けた Issue。
  本文は Destination、Notes、Decisions so far、Not yet specified、Out of scope を使う。
- 子チケット：GitHub の sub-issue としてマップに紐付ける。
  利用できない場合はマップ本文のタスクリストに追加し、
  子チケット本文の先頭に「Part of #<map>」を記載する。
  ラベルは wayfinder:research、wayfinder:prototype、
  wayfinder:grilling、wayfinder:task のいずれかを使う。
- 依存関係：gh api で GitHub の Issue 依存関係を登録する。
  依存先には Issue 番号ではなくデータベース ID を使う。
  利用できない場合は子チケット本文の先頭に
  「Blocked by: #<number>」を記載する。
- 次の作業：未完了の依存先がなく、担当者もいない、
  最初の未完了子チケットをマップの順序で選ぶ。
- 担当：作業する開発者をチケットに割り当てる。
- 完了：回答をコメントし、チケットを閉じる。
  設計項目がまとまった場合は対応する docs/design/ の資料を先に更新し、回答から参照する。
  マップの Decisions so far に要約とリンクを追記する。

GitHub の親子関係・依存関係は以下の REST API で取得できる。
`<map-number>` と `<issue-number>` は表示上の Issue 番号とする。

```sh
gh api 'repos/Kurarowa305/scene-craft/issues/<map-number>/sub_issues?per_page=100'
gh api 'repos/Kurarowa305/scene-craft/issues/<issue-number>/dependencies/blocked_by?per_page=100'
```

登録には同じパス（クエリ文字列なし）への POST を使い、親子関係は
`-F sub_issue_id=<child-database-id>`、依存関係は
`-F issue_id=<blocker-database-id>` を渡す。ID は Issue 取得結果の `id` を使う。
取得結果がページ上限に達する場合は後続ページも取得する。
