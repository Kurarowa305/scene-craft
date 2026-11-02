# 定義・作風のGit版の選択と固定（#60）

## 起動と操作

WSLのNode 24.19.0でビルドし、定義と作風を保存するローカルGitリポジトリを明示する。

```sh
npm run build
node dist/server/cli.js --git-repository /absolute/path/to/definitions
```

Windowsショートカットは既存の`launcher.json`に`"gitRepository": "/absolute/path/to/definitions"`を追加し、更新した`Launcher.ps1`を配置する。指定値はWSLパス。未設定でも作品・本文・取り込みの記録を使える。Git処理はWSLで行い、資格情報やGitプロセスのstderrをブラウザ・診断へ返さない。

1. 「定義の設定」にフルコミットを入力し「既定定義を保存」。ブランチ名や短縮ハッシュは受け付けない。
2. 作品作成で「作風なし」または別のフルコミットを選ぶ。定義と作風は同じリポジトリ内の別コミットを参照できる。
3. 作品の「定義・作風の固定内容」で、次の依頼の定義・作品の作風・可用性・tree/blob・保持タグを確認する。
4. 「依頼用の参照を固定」で、現在の明示選択から不変の予定参照を保存する。保存済み参照の各ファイルを読める。これは参照の準備であり、LLM・制作操作を開始しない。後続の依頼受付・実行管理はこの参照を使用し、現在のHEADへ解決し直さない。

既定定義は明示的な変更だけで更新され、作品の作風・保存済み予定参照には伝播しない。作品作成時の定義も`plannedDefinition`として残す。設定変更の各参照・時刻は追加記録する。既存作品は作風なし・作成時の定義未選択として扱い、過去の手作業に定義を付与しない。

## manifest契約

選んだコミットのルートに`definition.json`または`style.json`を置く。ファイル名と以下の契約識別子はこの実装の具体化であり、内容の版はフルコミットである。

最小の定義例。`instructions.md`も同じコミットに必要。

```json
{
  "schema": "scene-craft.definition.v1",
  "runtime": "scene-craft.v1",
  "roles": [{
    "id": "reference",
    "description": "参考調査",
    "instructions": ["instructions.md"],
    "procedures": [],
    "code": [],
    "context": ["work.intent"],
    "tools": [],
    "operations": [],
    "outputs": ["text"]
  }],
  "style": { "required": false, "formats": ["scene-craft.style.v1"] }
}
```

作風例。観察された傾向と採用済み方針は別フィールドで保持する。

```json
{
  "schema": "scene-craft.style.v1",
  "tendencies": ["静けさを好む傾向"],
  "policies": ["主題の周りに余白を残す"]
}
```

役割IDは重複不可。説明・指示・出力を必須とし、全配列の型・値を検査する。必要文脈は`work.intent`・`work.history`・`work.style`、出力は`text`を認識する。現在は制作ツール・操作のアダプターが未実装のため、`tools`と`operations`は空だけを許す。後続実装で実際に使える契約を加える。作風必須・形式不一致・runtime非互換は予定参照の固定前に拒否する。

指示・手順・コードはmanifestに明示した通常blobのみ。英数字・`_-.`と`/`による相対パスを使う。絶対パス・親参照・`.git`・symlink・submodule・LFSポインター・欠損blobは拒否する。未コミット・未追跡・Git属性によるarchive置換・暗黙の設定探索を取り出し経路に使わない。取り出したコードはこのIssueでは実行しない。

## 保存と保持

- リポジトリIDをGit common directoryの`scene-craft-repository-id`に一度だけ作る。場所・remote URLとは独立し、worktree間で共有する。移動時もこのIDを維持する。別cloneへの対応付け・バックアップでのID復元は後続実装であり、異なるIDを自動で同一扱いしない。
- Gitオブジェクト形式・フルcommit・tree・使用パス/blob・保持用軽量タグをSQLiteへ保存する。作風なしは`null`で明示する。
- shallow履歴とpromisor/partial clone設定を拒否し、先祖を含むオブジェクトの可用性を検査する。暗黙fetchとreplace objectsを無効にする。導入済みの古いGitでもネットワーク取得を開始しないよう、partial cloneはオブジェクト読み出し前に保守的に拒否する。
- 使用commit・root/nested tree・blobの実データからGitオブジェクト識別子を再計算し、不一致を拒否する。展開可能な圧縮データであっても、記録したblobとは別の内容を使わない。
- `refs/tags/scene-craft/retained/<full-commit>`を未作成確認付きで作り、DB確定前に再照合する。同対象の軽量タグのみ再利用する。別対象・注釈タグ・symbolic ref（参照先欠損も含む）を上書きしない。タグを移動・自動削除しない。
- DB保存が失敗したら参照を確定せず、余分な保持タグと取り出し領域は残す。再送は同一受付キーの結果を返し、既定変更後も選び直さない。
- `git-exports`下に定義と作風を別領域で取り出す。ファイル0400・ディレクトリ0500。毎回Git blobから新規に構築し、既存キャッシュを信頼しない。実行側が所有ユーザーの権限を使ってchmodすることまで防ぐsandboxではない。Codex・外部runtimeの探索制限と実行権限は後続の実接続で検証する。
- DBへGit用の追加テーブルを作る前に`records.before-git-versions.sqlite`へ退避する。既存作品・会話・本文・取り込みは維持する。

リモート状態は常に「未確認」。ローカルで固定できれば利用できる。保持タグのGitHubへの明示push・照合は後続Issueの責務であり、この画面は保存済みと表示しない。欠損時は固定内容の検査で理由を表示し、その参照を使う新しい予定参照の確定を止める。履歴・本文記録・取り込みは継続できる。可用性は読み出す時点で再検査し、ブラウザで以前の表示が残っていても書き込み入口で再検査する。

## 公開APIと後続への境界

| 操作 | 保存・返却 |
| --- | --- |
| `GET /api/versions` | 既定定義と現在の可用性 |
| `POST /api/versions/default` | `requestKey, commit`。検証・保持・読取専用展開後に既定を確定 |
| `POST /api/works` | 従来入力に`styleCommit: full-commit または null`を追加。作成時の定義・作風を固定 |
| `GET /api/works/:id/versions` | 新規依頼の既定定義と作品固定作風の検査 |
| `POST /api/works/:id/version-plans` | `requestKey`。現在の選択を固定し、不変の予定参照IDを返す |
| `GET /api/works/:id/version-plans` | 過去の予定参照。現在の既定へ置換しない |
| `GET /api/version-plans/:id/content?kind=definition&path=…` | 記録済み使用パスのblob本文。作風は`kind=style` |

書き込みは#58の同一origin・セッション・CSRF・入力検査・受付キーを再利用する。予定参照は実行許可ではない。後続の依頼受付は停止・所有権・保護・再実行予算・役割の検査を引き続き担当する。実行側は`gitVersions.materialize`で固定参照を再検査・展開する。現在のアプリはCodexや制作ツールを起動しない。

## 確認

`tests/versions.test.ts`は一時Git・DBと公開APIで、別コミット、再送、再起動、保持タグ競合、dangling symbolic ref、ブランチ削除/GC、未コミット内容の排除、読取専用展開、欠損/非互換、DB確定失敗と再送、不正manifest/外部リンクを確認する。`tests/browser/versions.spec.ts`は本物のHTTP・SQLite・Gitを通し、設定・作品作成・予定参照保存・本文表示・開き直しを確認する。既存CIの`npm run check`に含まれ、PR作成・更新時に実行する。

Windowsショートカットの新設定・実Codex・Blender・GitHubへの保持タグpushは未検証。このIssueの自動試験成功を初期版全体の受け入れ完了と扱わない。

根拠: [Issue #60](https://github.com/Kurarowa305/scene-craft/issues/60)、[Git版管理設計](design/git-versioning.md)、[エージェント契約](design/agent-contracts.md)、[テスト設計](design/testing-and-diagnostics.md)。
