# SQLiteへ接続して保存データを確認する

scene-craftの作品・会話・本文記録を、付属の `scripts/db-console.py` で確認する手順。SQLiteはファイルへ直接接続するため、DBサーバーの起動やユーザー名・パスワードは不要。Python 3の標準ライブラリだけを使う。

コンソールは読み取り専用で接続し、通常の更新SQLを拒否する。指定したDBが存在しない場合はエラーで終了し、空のDBを作成しない。scene-craftを起動していなくても確認できる。

## 1. WSLへ入る

Windows PowerShellで実行する。

```powershell
wsl -d Ubuntu
```

以降のシェルコマンドはWSL内で実行する。

## 2. リポジトリへ移動して接続する

```bash
cd ~/scene-craft
python3 scripts/db-console.py
```

通常は次のDBを開く。

```text
~/.local/share/scene-craft/records.sqlite
```

このPCの絶対パスは `/home/oyadomaritaiki/.local/share/scene-craft/records.sqlite`。接続後に `読み取り専用: ...` と `sqlite>` が表示される。

保存先を変更した場合や、実機確認用DBを開く場合は、ディレクトリではなく `records.sqlite` のファイルパスを指定する。空白を含むパスは引用符で囲む。

```bash
python3 scripts/db-console.py "/path/to/data/records.sqlite"
```

ショートカットの保存先設定は、Windows PowerShellで確認できる。`dataDirectory` の下にある `records.sqlite` を指定する。

```powershell
Get-Content "$env:LOCALAPPDATA\scene-craft\launcher.json"
```

実機確認用の `/tmp/scene-craft-acceptance-.../records.sqlite` と、通常の保存先は別DB。

## 3. テーブルとデータを確認する

コンソール内で入力する。ドットで始まるコマンドにはセミコロン不要、SQLには末尾の `;` が必要。

| コマンド | 内容 |
| --- | --- |
| `.tables` | テーブル一覧 |
| `.schema` | テーブル・インデックスなどの定義 |
| `.help` | 操作説明 |
| `.quit` / `.exit` | 接続を閉じて終了 |

主なテーブルは次のとおり。

| テーブル | 内容 |
| --- | --- |
| `works` | 作品名・制作意図 |
| `conversations` | 会話と所属作品 |
| `records` | 本文記録と所属会話 |
| `receipts` | 同じ要求の重複登録を防ぐ受付結果 |

作品と会話を確認する。

```sql
SELECT id, name, intent, created_at FROM works ORDER BY sequence;
SELECT id, work_id, created_at FROM conversations ORDER BY sequence;
```

本文記録を保存順に確認する。SQLは複数行でも入力できる。

```sql
SELECT conversation_id, body, created_at
FROM records
ORDER BY sequence;
```

作品名と本文をまとめて確認する。

```sql
SELECT w.name AS work_name, r.body, r.created_at
FROM records AS r
JOIN conversations AS c ON c.id = r.conversation_id
JOIN works AS w ON w.id = c.work_id
ORDER BY r.sequence;
```

結果は1行につき1件のJSON。本文の改行は `\n` と表示されるため、末尾の改行も確認できる。`created_at` はUTCで、末尾の `Z` はUTCを表す。

## 4. 終了する

```text
.quit
```

Ctrl+Dでも終了する。入力中のSQLはCtrl+Cで取り消せる。DBコンソールを終了しても、scene-craft本体は終了しない。

## 接続・入力に失敗した場合

- `DBを開けません`：ファイルパスと権限を確認する。初回利用前なら、scene-craftを一度起動してDBを作成する。
- `SQLエラー: attempt to write a readonly database`：読み取り専用のため更新SQLは使えない。確認には `SELECT` を使う。
- `...>` のまま：SQLが未完了。末尾に `;` を入力するか、Ctrl+Cで取り消す。
- SQLエラー後も入力は続けられる。終了コードは、正常終了が0、接続失敗・SQLエラー・EOF時の未完了SQLが1。

## 確認済みの範囲

WSLの実保存先から作品・本文を読み取れることを確認した。一時DBを用い、更新拒否、複数行SQL、空白を含むDBパス、存在しないDBを作成しないことも確認した。実データの変更は行っていない。
