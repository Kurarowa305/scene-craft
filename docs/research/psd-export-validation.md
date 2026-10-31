# 16bit・13画像レイヤー PSD の書き出し検証

2026-10-12、[Issue #4](https://github.com/Kurarowa305/scene-craft/issues/4) の調査。**合成データによる RGB 16bit PSD の生成と独立パーサーでの検証は成立した。Photoshop での表示・編集は未確認**。製品実装やライブラリ採用の決定ではない。

2026-10-31の後続調査で、[実EXRからの13種類の変換、名前・merged imageの補修、PSD/PSBの確認用ファイル](psd16-conversion-validation.md)を追加した。以下は2026-10-12当時の合成データ検証である。

## 方法と確認結果

WSL Linux x86_64 / Python 3.14.4 の `/tmp/scene-craft-psd-probe` にだけ依存を導入した。PhotoshopAPI 0.9.1、psd-tools 1.24.0、NumPy 2.5.4。Blender や Photoshop を操作せず、32×24 の合成 RGB uint16 配列を13枚生成した。8bit に縮退すると一致しなくなる値を使った。

[再現スクリプト](evidence/psd-probe.py) で PhotoshopAPI が生成した原本を psd-tools で読み込むと、レイヤー名末尾に `\u0000` が現れた。これは今回のパーサーで観察した表現であり、Photoshop 上の名前が壊れると判断したものではない。原本を別途保存したうえで、psd-tools 側で末尾 NUL を除いた名前を設定して別ファイルへ再保存した。二段階処理の製品採用を決めたわけではない。

正規化後の PSD を再度 psd-tools で読み、次を確認した。[機械可読の結果](evidence/psd-probe.json)

- PSD ヘッダーが version 1、RGB、16bit、32×24。
- 13 枚すべてが画像レイヤーで、名前が指定した13名称と完全一致。Combined だけが表示、残りは非表示。
- 各レイヤーの位置と寸法がキャンバスに一致。
- 独立パーサーで圧縮解除した RGB 全39チャンネル・全サンプルが入力 uint16 と完全一致。表示用の8bit変換を介さず検証した。

ファイルは Windows の一時フォルダにある。

```text
C:\Users\oy_ta\AppData\Local\Temp\scene-craft-issue4-probe\13-passes-16bit-validated.raw.psd
C:\Users\oy_ta\AppData\Local\Temp\scene-craft-issue4-probe\13-passes-16bit-validated.psd
```

## 限界

作者の [PhotoshopAPI README](https://github.com/EmilDohne/PhotoshopAPI) は 8/16/32bit と RGB の読み書きを説明する一方、有効な merged image を出力しないと明記している。今回の名称再保存も merged preview の生成・修復を目的としておらず、対応を保証しない。アプリやファイルブラウザが merged preview を使う場合の表示は別の確認事項である。

Photoshop の実機で開いて13レイヤーを確認すること、ICC・色変換、透明度、実際のレンダーパスの意味、大きな解像度での時間・メモリ・PSD上限は未検証。今回の合成画像はパス名が付いた異なるテスト画像であり、陰影や反射等の対応を検証するものではない。psd-tools の生チャンネル検証は同版の内部 API を使うため、再現時は版を固定する。

## 再現

通常は venv を作って依存を導入する。今回のシステム Python には ensurepip がなかったため、作成された隔離環境に [PyPA get-pip](https://bootstrap.pypa.io/get-pip.py) で pip を追加した。グローバル環境は変更していない。

```bash
python3 -m venv /tmp/scene-craft-psd-probe
/tmp/scene-craft-psd-probe/bin/python -m pip install PhotoshopAPI==0.9.1 psd-tools==1.24.0 numpy==2.5.4
# リポジトリのルートで実行。出力名は既存ファイルと重ならないものを指定する。
/tmp/scene-craft-psd-probe/bin/python docs/research/evidence/psd-probe.py /tmp/scene-craft-13-passes.psd /tmp/scene-craft-13-passes.json
```

## 実レンダー EXR の独立確認

別の Blender 検証で作成された `render-passes.exr` を OpenEXR 3.5.2 で読み取り、15 parts とそのチャンネル、寸法、値の範囲を取得した。[検査スクリプト](evidence/psd-exr-channels.py) と [結果](evidence/psd-exr-channels.json)。Combined、Depth、Object/Material Index、Diffuse/Glossy/Transmission の各 Direct/Indirect/Color、Ambient Occlusion、Noisy Image が存在した。**Shadow / Shadow Catcher の part はこの出力に存在しなかった**。設定プロパティを有効にできたことと、期待するチャンネルが生成されたことを区別する必要がある。

これは Blender の当該出力ファイルの検査であり、Cycles の採用、Vue 互換、13 パスへの変換の成立を意味しない。実 EXR から PSD への変換は今回実施していない。

```bash
/tmp/scene-craft-psd-probe/bin/python -m pip install OpenEXR==3.5.2
/tmp/scene-craft-psd-probe/bin/python docs/research/evidence/psd-exr-channels.py /mnt/c/Users/oy_ta/AppData/Local/Temp/scene-craft-issue4-probe/render-passes.exr /tmp/scene-craft-exr-channels.json
```

## sRGBプロファイルとPSBの追加確認

利用者によるsRGB・PSD上限時のPSB切り替えの承認後、[追加スクリプト](evidence/psd-profile-probe.py)で同じ合成画像をPSDとPSBへ書いた。PillowのLittleCMSで作ったsRGB ICCをPhotoshopAPIの`icc`へ設定し、独立したpsd-toolsの読み取りで埋め込んだバイト列の一致を確認した。[結果](evidence/psd-profile-probe.json)。

両形式で16bit・13レイヤー・統合のみ表示・全RGB画素値の一致を確認した。ファイルヘッダーのversionはPSD=1、PSB=2。小さなファイルを明示的にPSBへ保存した検証であり、2GB超での自動切り替えや大規模ファイルの性能は未検証。ICCを埋め込む検証であり、シーンリニアからsRGBへの変換・AgX・Photoshop表示の正しさは検証していない。

```bash
/tmp/scene-craft-psd-probe/bin/python docs/research/evidence/psd-profile-probe.py /path/to/new-scratch-output-directory /tmp/psd-profile-probe.json
```

出力先は事前に作成した新しい一時フォルダを指定する。元の合成データと同様に名前末尾NULは比較時だけ除外し、製品の名称処理やプレビューの問題を解決済みとは扱わない。
