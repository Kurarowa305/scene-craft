#!/usr/bin/env python3
"""Open scene-craft's records database as a read-only SQL console."""

import argparse
import json
from pathlib import Path
import sqlite3
import sys


HELP = """SQLは末尾に ; を付けて入力してください（複数行可）。
.tables  テーブル一覧
.schema  テーブル定義
.help    この説明
.quit    終了（Ctrl+Dでも終了）
例: SELECT name, intent FROM works;
例: SELECT body, created_at FROM records ORDER BY sequence;
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "database",
        nargs="?",
        type=Path,
        default=Path.home() / ".local/share/scene-craft/records.sqlite",
        help="SQLiteファイル（省略時: ~/.local/share/scene-craft/records.sqlite）",
    )
    args = parser.parse_args()
    path = args.database.expanduser().resolve()
    try:
        db = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=2)
        db.execute("PRAGMA query_only = ON")
    except sqlite3.Error as error:
        parser.exit(1, f"DBを開けません: {path}\n{error}\n")

    db.row_factory = sqlite3.Row
    interactive = sys.stdin.isatty()
    if interactive:
        print(f"読み取り専用: {path}\n{HELP}")
    pending = ""
    failed = False
    try:
        while True:
            try:
                line = input(("...> " if pending else "sqlite> ") if interactive else "")
            except EOFError:
                if pending.strip():
                    print("未完了のSQLです。末尾に ; を付けてください。", file=sys.stderr)
                    failed = True
                break
            except KeyboardInterrupt:
                pending = ""
                if interactive:
                    print()
                continue

            command = line.strip()
            if not pending and not command:
                continue
            if not pending and command in (".quit", ".exit"):
                break
            if not pending and command == ".help":
                print(HELP)
                continue
            if not pending and command == ".tables":
                sql = "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name"
            elif not pending and command == ".schema":
                sql = "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name"
            else:
                pending += line + "\n"
                if not sqlite3.complete_statement(pending):
                    continue
                sql, pending = pending, ""
            try:
                cursor = db.execute(sql)
                for row in cursor:
                    print(json.dumps(dict(row), ensure_ascii=False))
            except sqlite3.Error as error:
                print(f"SQLエラー: {error}", file=sys.stderr)
                failed = True
    finally:
        db.close()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
