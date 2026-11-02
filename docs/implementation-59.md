# 制作ファイルの取り込み（#59）

## 起動と登録

#58のローカルセッション・SQLite・CI・Windows確認入口を再利用する。LLM・Photoshop自動操作は呼ばない。

起動時に `--file-roots /absolute/path/roots.json` を指定する。Windowsショートカットの設定JSONには `fileRoots` として、このファイルのWSLパスを追加する。制作ファイルと完成記録はWindows側、記録DBはWSL側へ置く。

```json
{
  "sources": [{ "id": "work-files", "path": "/mnt/c/Users/artist/Documents/Production" }],
  "managed": { "id": "production", "path": "/mnt/c/Users/artist/scene-craft/files" }
}
```

ルートIDは保存後に変更しない。設定ファイルを編集し、再起動する。画面には取り込み元のIDだけを公開する。チャット内「制作ファイルを添付して記録」で、保存済みのblend・PSD/PSB・画像の相対パス、本文、作業アプリ、任意理由、既存の元レンダーを指定する。未保存GUI内容は取得しない。初回以前の経緯・元レンダー不明を補作しない。

初回は取り込み、以降は現在状態からの手修正として記録する。変更しないファイルの固定参照は引き継ぐ。現在状態・変更前後・本文・理由・元レンダー・現在状態更新記録は同じSQLiteトランザクションで確定する。候補編集・採否・復元は後続Issueの範囲で、この入口からは実行しない。

## 依存と検査の境界

各ファイルの隣に `<元ファイル名>.scene-craft-dependencies.json` を置くと、明示した依存を再帰収集する。例：

```json
[
  { "rootId": "work-files", "relativePath": "textures/wall.png" },
  { "rootId": "work-files", "relativePath": "libraries/props.blend" }
]
```

宣言はBlenderによる内容検査の代わりではない。blend・PSD/PSBは内容検査が済むまで`inspection_pending`として表示する。後続Blender入口には `DependencyInspector` を渡し、実参照の列挙・検査結果を接続できる。コピーされた依存と元参照の対応は各ファイルの `source` と固定参照で保持する。**この段階ではblend内の参照書換えや制作実行を提供しない**。管理下にコピーされたことを、外部参照を解決して制作可能になったことと混同しない。

循環・不明な所在・ルート外の依存は理由付き不足にする。実際のコピー失敗・容量不足・読み取り失敗・コピー中変更・不正な依存宣言は未完成とし、既知不足に読み替えない。全本体と依存のサイズ・SHA-256を検証し、収集終了時にも元ファイル集合を再確認する。元ファイル・リンク実参照先と許可ルートの境界を確認し、管理下の固定実体から再取り込みして編集扱いにすることは拒否する。

## 保存形式・照合

- SQLiteには`import_operations`・`saved_states`・`current_states`・`current_state_updates`を追加する。既存本文記録は変更しない。追加前に`records.before-imports.sqlite`をSQLiteの一貫スナップショットとして一度保存し、自動削除しない。
- 制作ファイル側は `.pending-<操作ID>-<試行ID>/` にコピーし、`complete.json`（version 1、操作ID、保存状態構成）を同期書き込みしてから `<操作ID>/` へrenameする。ファイル名はUUID、固定参照は保存ルートID・相対パス・サイズ・SHA-256。ハードリンクを使わない。
- DBにはコピー前に受付キー・内容・対象・操作ID・保存状態ID・予定先を確定する。同作品の未解決操作は新しい保存と競合させない。既存本文記録の操作と受付キーを共有し、異内容を拒否する。
- 完成記録と全実体を検証後、DBを確定して公開する。実体確定後DB失敗・応答喪失では、同じ受付キーの再送で同じ操作を照合し、一度だけ公開する。再起動後、元ファイルがなくても固定実体で照合できる。完成記録不一致・破損は照合待ちを保ち、現在状態を切り替えない。
- 未完成の登録は同じ内容で再試行できる。完成領域がない場合だけ、人間が「未完成の登録を中止」できる。履歴・一時コピーは残し、中止を新しい成功状態に読み替えない。完成実体がある場合は中止より照合を優先する。
- 固定実体のダウンロードはサイズ・ハッシュ検査後に提供する。添付済みPNG/JPEG/WebPは署名検査後に画面表示する。自動プレビュー生成は後続入口へ引き継ぐ。

## 公開操作と試験

`POST /api/conversations/:id/imports`、`GET /api/works/:id/states`、`GET /api/works/:id/imports`、`GET /api/states/:id/files/:fileId`、`POST /api/imports/:id/abandon`。変更要求は#58と同じOrigin・Host・セッション・CSRF検査を通す。

`tests/imports.test.ts`は公開HTTP操作から一時SQLite・制作領域の保存結果を確認する。実ファイルシステムとSQLiteを使い、DBロック・ファイル収集中変更・完成配置境界で故障を再現する。`tests/browser/imports.spec.ts`は取り込み・前後表示・再表示・失敗時の入力保持と中止を確認する。既存`npm run check`とPRの`verify`で毎回実行する。

Windows確認は既存の`Test-Local.ps1`を拡張した。Windows上の分離した制作領域とWSLの分離したDBでコピー・二重送信・前後の保全を確認し、対象commit・OS・Node・期待/実結果・IDの証跡を残す。自動項目のPSDは合成したファイル内容であり、実PSD互換性の証明ではない。実blend/PSD/PSB、Blender検査、Windowsドライブ切断・保存中断と人間の画面確認は個別の`not_run`項目として残す。このLinux環境ではWindows・Blender・Photoshop実機の成功を宣言しない。
