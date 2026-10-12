# Windows Blender の保存・レンダー・停止の実機確認

2026-10-12、設計 Issue「Blender の操作経路とレンダー出力契約を決める」の根拠。制作ファイルは使わず、Windows の一時フォルダで合成シーンだけを操作した。本実装・GPU・大規模シーンの動作保証ではない。

## 成功と失敗

WSL から Windows Blender 5.2.2 LTS を `--background --factory-startup --disable-autoexec --python-exit-code 17 --python <Windows側スクリプト>` で起動した。96×96、Cycles CPU、4 samples のシーンを作り、入力 `.blend` 保存、32bit multilayer EXR、16bit PNG、結果 `.blend` 保存まで成功した。レンダー処理部分は約0.33秒で、起動・終了を含む性能測定ではない。表示設定は AgX / sRGB。

導入済み5.2では `file_format = OPEN_EXR_MULTILAYER` だけでは Python 例外になる。`media_type = MULTI_LAYER_IMAGE` を先に指定すると成功した。PNG保存前は `IMAGE` へ戻す。失敗実行は終了コード17、修正後は0。静的なRNAの選択肢にあることと、現在の設定でその値を指定できることを区別する。

[再現スクリプト](evidence/blender-render-probe.py)、[結果](evidence/blender-execution-probe.json)。実 EXR の15 partsは [PSD検証メモ](psd-export-validation.md) の独立読み取りで確認した。`use_pass_shadow` を有効にしても当該 Cycles 出力に Shadow は含まれず、13種類全部を生成できた検証ではない。

## 停止と保存済みデータ

別の新規Blenderプロセスで、停止前の `.blend` を保存してから長いレンダーを開始した。`render_init` 到達時に実行PIDを一時ファイルへ記録し、Windows側で実行ファイルパスと検証スクリプトのコマンドラインを照合した対象だけを `Stop-Process -Force` で終了した。人間が起動したプロセスを対象にしていない。

停止直後の `Get-Process` では対象がまだ存在した。WSL側の子プロセス終了（exit 255）を回収した後の照合では対象は不在だった。したがって停止コマンドの成功だけで停止済みと扱わず、終了を待って再照合する必要がある。これはチェックポイントを先に保存したうえでの強制終了であり、協調的キャンセルや処理途中の自動保存の成功を意味しない。

完成通知と出力画像は生成されず、保存済み `.blend` は残った。別の background Blender で開き直し、Camera/Cube/Light、Cycles と設定値を読み取れた。保存中の終了・GPU実行中の終了・全子プロセス回収・バックエンド異常終了後の復旧は未検証。

停止用の [Blenderスクリプト](evidence/blender-render-stop-probe.py) と [Windows側停止スクリプト](evidence/blender-stop-owned-probe.ps1) は一組の検証用。単独で長いレンダーを走らせない。今回の固定名・PID照合だけを製品用の所有権管理に流用せず、実装では実行ID・起動時刻等との照合を具体化する。

## 再現環境と成果物

各スクリプトは `C:\Users\oy_ta\AppData\Local\Temp\scene-craft-issue4-probe` を使用する検証専用コード。根拠スクリプトは元のファイル名でこの一時フォルダに配置して実行した。製品の保存先を確定するものではない。`.blend`、EXR、PNG、実行時ログは一時領域に置き、リポジトリには小さな再現スクリプトと検証結果だけを記録する。

実機で残る確認は13種類の意味・色管理・ID色の生成・Shadows、外部素材の依存、途中保存の破損検知、PSDへの一貫した変換、Photoshopでの表示である。
