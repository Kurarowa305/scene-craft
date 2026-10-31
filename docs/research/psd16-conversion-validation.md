# 実レンダーパスから13レイヤーPSD/PSBへの変換

2026-10-31（日本時間）。[13レイヤーPSD出力の変換方式とライブラリを検証する](https://github.com/Kurarowa305/scene-craft/issues/16)の結果。[Blender連携の出力契約](../design/blender-integration.md)は維持する。本実装ではなく、仕様統合前の技術調査である。

**PhotoshopAPI 0.9.1で画像レイヤーを書き、psd-tools 1.24.0で名称とmerged imageを補修する方式を採用する。** 小さなCycles実EXRから13種類を一貫変換し、PSD/PSBのレイヤー画素とmerged imageを検証した。Photoshop実機での表示・編集、大容量ファイル、透明・ボリュームの品質は確認していない。

## 構成と採否

```text
Windows Blender / Cycles
  ├─ 通常レンダー → Combined / 材質色 / 光・反射・屈折 / ID / Z / AO
  ├─ Alpha用作業コピー → 空のカメラ可視性を除外したCombined Alpha
  └─ 影用作業コピー → 指定受け面のShadow Catcher
       ↓ 32bit float EXRを保持
WSL / OpenEXR + NumPy → 契約の数式 / ID色 / データ画像
       ↓ 色の見た目はWindows Blender付属の色管理で16bit PNGへ
PhotoshopAPI → 一時PSDまたはPSB
       ↓ psd-toolsで名前とmerged imageを補修
独立した読み取りと全サンプル検証 → 完成ファイルへrename
```

[一次資料の確認](psd-library-source-review.md)に固定コミットと根拠URLをまとめた。PhotoshopAPI単独は、Unicode名末尾のNULとゼロのmerged imageが残るため採用しない。更新版だけで直る根拠もない。psd-toolsの通常の`save()`による再合成は、16bit値と初期表示を明示管理する今回の経路には使わない。

1. PhotoshopAPIへ入力する13名称を固定し、RGB uint16配列と表示状態、ICCを設定する。
2. 生成した原本を残し、psd-toolsで読み直す。名前が「期待した名称＋NUL」であることを確認してから、期待した名称を設定する。比較時だけNULを無視する処理にしない。
3. 変換済みCombinedのRGBをbig-endian uint16のmerged ImageDataへ直接格納する。`VERSION_INFO.has_composite`も設定する。13枚を再合成しない。
4. 低レベル`_record.write()`で一時ファイルを書き、改めて全フィールド・全レイヤー画素・merged imageを確認してから公開する。

psd-toolsの内部APIを使うため、版を固定し、更新時はこの検証を再実行する。PhotoshopAPIと補修処理の双方を、通常のプログラムとして扱う。LLMによる画像調整とPhotoshopの自動操作は行わない。

## 再現環境と入力

- Windows Blender **5.2.2 LTS / d13f752e3b9c**。前回の調査と同じ実体であることを`--version`で確認した。
- WSL2 Linux / Python 3.14.4。PhotoshopAPI 0.9.1、psd-tools 1.24.0、NumPy 2.5.4、OpenEXR 3.5.2、pypng 0.20220715.0、Pillow 13.0.0。
- 新規に作った192×128、Cycles CPU、32 samples、seed 16の合成シーン。拡散の立方体、金属球、ガラス球、地面、空として扱う背景板、World、Area Lightを使った。実作品・外部素材・GPUは使用していない。
- 通常・Alpha・Shadowの3回をレンダー。通常入力の`.blend`を先に保存し、後の変更を保存し直さない。AlphaではWorldをFilm Transparentにし、背景板は`visible_camera=False`のみを変更する。背景板を削除せず、反射・照明への存在は維持する。Shadowでは背景板を戻し、地面をShadow Catcherにする。
- 前回の一時成果物が残っていなかったため作り直した。最初の地面は全画面を覆いAlphaが一様1になったので、有限の地面へ直して空との境界がある検証にした。

[レンダー設定](evidence/psd16-render.json)、[EXR変換結果と入力ハッシュ](evidence/psd16-mapping.json)、[表示変換設定](evidence/psd16-transform.json)、[PSD/PSB検証結果](evidence/psd16-package.json)。EXRと`.blend`の実体はWindowsの一時フォルダーにあり、リポジトリには確認用PSD/PSBと再現コードを保存する。ハッシュは今回のファイルの識別用であり、Blender保存時の付随情報・ICC作成時刻まで含むバイト同一の再生成を保証しない。

## 13種類の変換

各式はシーンリニアで計算する。実EXRのpart・チャンネル名を照合し、必須入力の欠落・寸法不一致・不正値を失敗にする。Depthの正の無限遠と背景の大きな有限値は別扱いで黒にする。寄与がゼロであっても、必須パスの存在と値の妥当性を確認する。

| レイヤー | 入力・式 | 16bit画像への変換 |
| --- | --- | --- |
| Combined | 通常レンダーのCombined RGB | AgX、露出0、look None、gamma 1、sRGB |
| Material ID | Material Index | 固定した衝突のない色表へ対応 |
| Object ID | Object Index | 固定した衝突のない色表へ対応 |
| Material color | Diffuse Color | Standard、露出0、look NoneでsRGB転送。AgXなし |
| Specular Lighting | Glossy Direct × Glossy Color | Combinedと同じ表示変換 |
| Diffuse Lighting | Diffuse Direct | 同上。Diffuse Colorを掛けない |
| Z Depth | Depth | `clamp((far-z)/(far-near),0,1)`。near=5、far=25 |
| Global Alpha Mask | Alpha用作業コピーのCombined Alpha | 0〜1をグレーRGBへ |
| Shadows | 影用作業コピーのShadow Catcher RGB | 各値を0〜1へクランプ。AgX・露出・sRGB転送なし |
| Refractions | (Transmission Direct + Transmission Indirect) × Transmission Color | Combinedと同じ表示変換 |
| Reflections | Glossy Indirect × Glossy Color | 同上 |
| Indirect Lighting | Diffuse Indirect | 同上。Diffuse Colorを掛けない |
| Ambient Occlusion | Ambient Occlusion RGB | 0〜1をそのまま補助RGBへ。AgX・露出なし |

データ画像は`round(clamp(x,0,1)×65535)`で量子化する。sRGB文書内の選択・調整用コード値として保存し、データ画像へ追加の色変換を掛けない。AOの距離は今回の設定で10、統合へ追加で重ねていない。深度範囲・受け面・背景対象・ID色表は記録する。今回のID色表は合成シーンの固定index用であり、製品では永続的対象IDに対応付けて保持し、名前変更や再レンダーで採番し直さない。

今回のCombinedはコンポジターの追加エフェクトを含まない。入力EXRを単独の線形RGB EXRとしてBlenderに読み込み、付属OCIO設定の表示変換で16bit RGB PNGを保存する。pypngで16bitのまま読み取ってPSDへ渡す。見た目用画像を事前に0〜1へ切り詰めず、表示変換してから16bitへ収める。新規作品以外は作品に記録した表示変換・露出・look・gamma・表示先を引き継ぎ、未対応設定を黙ってAgXへ置換しない。一般のコンポジター処理・別設定・別バージョンは追加検証が必要。

13枚はキャンバス全体の不透明RGB補助画像にし、Global Alpha Maskを独立した画像レイヤーに格納する。通常Combinedは空を含むため全画面Alpha=1だった。Global AlphaをCombinedの透明度へ転用しない。これは今回の合成シーンでのalphaの確認であり、透明な切り抜き材質、ガラス越しの全対象、3D雲・ボリューム境界の正しさや透明Combinedのmerged alphaを検証したものではない。

根拠となるパスの意味は[Blender Passes](https://docs.blender.org/manual/en/latest/render/layers/passes.html)、表示変換とデータ画像の区別は[Blender Color Management](https://docs.blender.org/manual/en/latest/render/color_management.html)。実際に確認した設定と範囲は上記の固定環境とevidenceに限定する。

## 確認結果

- PSDはversion 1、PSBはversion 2。双方とも192×128、RGB 16bit、画像レイヤー13枚、名前完全一致、Combinedが最上位でそれだけ表示。他は非表示、通常合成、不透明度100%。ICCバイト列も一致した。
- 各ファイルの全RGB **958,464サンプル**が変換入力と完全一致した。16bit未満へ縮退させる読み取りを介していない。
- 補修前のmerged imageは全ゼロ。補修後はCombinedの全RGB **73,728サンプル**と完全一致した。psd-toolsの展開に加え、標準ライブラリの`struct`・`zlib`だけでPSD/PSBのセクション長を辿り、merged imageを独立検証した。
- CombinedはBlenderのRender Resultから直接保存した16bit参照PNGと全画素一致。露出を1へ変えた対照PNGでは値が変わった。Material colorは独立したsRGB転送式との差が最大1/65535だった。Photoshop上の色の一致を意味する検証ではない。
- 通常Combined Alphaは全画素1。背景を除いたAlphaは0〜1、境界の中間値は366画素。Shadowsの元RGBは約0.0118〜1.6739で、1を超える13,472サンプルを含む。元EXRを保持し、PSDでは規定どおりクランプした。
- Refractionsを含む7種類の色画像に非ゼロ寄与があった。必須Transmission Directを検査から除く対照は失敗し、有限なゼロ配列は正常に量子化できた。これは全種類の取得障害・全例外の網羅テストではない。
- ファイルを80バイトで切った対照は検査で拒否された。出力は再読込・検証後に一時名から完成名へrenameした。プロセス終了コードだけで完成としない。
- 最終ファイルはPSD 838,851 bytes、PSB 839,019 bytes。パッケージ化と検証は約0.56秒、同一Pythonプロセスの実測最大RSSは118,144 KiB。Blenderのメモリと起動時間は含まず、大容量性能へ外挿しない。

## 容量・寸法と失敗時の設計

PhotoshopAPIは拡張子でPSD/PSBを選ぶため、scene-craft側で決める。PSDは30,000px、2GB、PSBは300,000pxの上限を前提とする。[Adobe形式仕様](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)、[大容量文書](https://helpx.adobe.com/photoshop/desktop/save-and-export/save-files/save-large-documents.html)。

1. 幅・高さ・予定チャンネル数、圧縮方式の最大符号長、merged image、ICC・レイヤー等のメタデータを含むサイズ上界を事前に見積もる。非圧縮画素数だけを圧縮後サイズの上界とは扱わない。
2. 寸法30,000px超、または上界が保守的な2,000,000,000 bytes以上なら最初からPSBを選ぶ。各セクション・チャンネルの長さフィールド上限も形式別に確認する。上界を安全に算出できない状態で、PhotoshopAPIへPSDを無条件に書かせない。この上界計算は製品実装の必須条件であり、今回のスクリプトは小さい固定入力と選択境界のテストに留まる。
3. 書き出した一時PSDも実サイズと構造を検査し、PSD上限を満たさなければPSBで生成し直す。元のPSDをリネームしてPSBにしない。PSBも同じ画素値・13枚・ICCで検証する。
4. 寸法300,000px超、PSBの長さ制限、ディスク不足、メモリ不足は失敗として記録する。bit depth・解像度・パス数を自動で落とさない。検証済み中間EXRと入力・設定を残し、完成名を公開しない。

30,000/30,001px、サイズ境界の直前/一致、300,001px拒否の分岐をメタデータだけで試験した。小さなPSBを本当に生成してversion 2を確認したが、**2GB超の実ファイルと実際の容量超過からの自動再生成は検証していない**。境界の単体検査と大容量処理の成立を区別する。

13枚のRGB uint16だけで`78×幅×高さ`bytes必要で、8000×8000は約4.65GiB。merged RGBだけでもさらに約0.36GiB、EXR float32、補修前後の構造、圧縮・検証配列が加わる。今回は小さいので全配列を保持したが、このコードの全画像同時保持を製品へ移植しない。色の変換は一枚ずつ一時ファイルへ出し、専用プロセスで処理・解放し、検証も一レイヤーずつ行う。PhotoshopAPI・psd-tools自体の保持や全チャンネル結合も残るため、空きメモリ・ディスクの事前検査と実サイズでのピーク計測を実装の受け入れ条件にする。PSBを選ぶだけでメモリ問題が解決するとは扱わない。

## Photoshopへ渡す確認用ファイルと観察項目

以下は今回生成して機械検証したファイル。リポジトリへ保存し、一時フォルダーを消しても参照できるようにした。

- [13-passes.psd](fixtures/psd16/13-passes.psd)
- [13-passes.psb](fixtures/psd16/13-passes.psb)
- [期待するCombined](fixtures/psd16/Combined.png)
- [埋め込んだsRGB ICC](fixtures/psd16/srgb.icc)

Windowsにも`C:\Users\oy_ta\AppData\Local\Temp\scene-craft-issue16-replay\`へ同じ成果物を残した。PSD/PSBのSHA-256は[package evidence](evidence/psd16-package.json)を参照する。以下の人間による確認は[テスト境界・診断情報・初期版の受け入れ手順を決める](https://github.com/Kurarowa305/scene-craft/issues/14)へ渡す。ここでPhotoshopを操作していない。

1. PSD・PSBをそれぞれ開き、警告や修復要求の有無、RGB/16bit、埋め込みsRGBを記録する。
2. 13名称に不可視文字や欠けがなく、Combinedだけ初期表示され、参照PNGと見た目・向き・色が合うか確認する。OS等がmerged imageを使う場合のプレビューも観察する。
3. 各補助画像を一枚ずつ表示し、ID色、近白/遠黒のZ、空黒/物体白のAlpha、地面のShadows、光・反射・屈折が想定する位置にあるか確認する。Shadowsを完全な影の除去用レイヤーとは扱わない。
4. レベル補正等のレタッチを加え、別名で保存・閉じる・開き直す。レイヤー構造・bit depth・色・表示状態、16bitの編集での値の扱いを確認する。8bit表示用プレビューの見た目だけで16bit保持を判定しない。
5. 実作品・高解像度・GPU、透明切り抜き・ガラス・ボリューム、壁/複数Shadow Catcher、ディスク不足・保存中断・生成/補修中の停止は別のケースで確認する。

## 再現手順

コードは検証専用。fixture作成は既存フォルダーを拒否し、パッケージ化は完成ファイルの上書きを拒否する。中間ファイルを生成する各段階は必ず順番に実行する。初回は新しいWindows一時フォルダーを指定する。全てのスクリプトはリポジトリのルートで実行する。BlenderとPythonの版を上記へ揃える。`/tmp`のvenvに依存を入れるだけで、グローバルPythonやBlenderのPythonは変更しない。

```bash
python3 -m venv /tmp/scene-craft-psd16-venv
# ensurepipのない環境では既存のPSD検証と同じくvenv内にPyPA get-pipでpipを入れる
/tmp/scene-craft-psd16-venv/bin/python -m pip install PhotoshopAPI==0.9.1 psd-tools==1.24.0 numpy==2.5.4 OpenEXR==3.5.2 pypng==0.20220715.0 pillow==13.0.0

cp docs/research/evidence/psd16-render-fixture.py /mnt/c/Users/oy_ta/AppData/Local/Temp/psd16-render-fixture.py
'/mnt/c/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --disable-autoexec --python-exit-code 17 --python 'C:\Users\oy_ta\AppData\Local\Temp\psd16-render-fixture.py' -- 'C:\Users\oy_ta\AppData\Local\Temp\scene-craft-issue16-replay'

/tmp/scene-craft-psd16-venv/bin/python docs/research/evidence/psd16-map-passes.py /mnt/c/Users/oy_ta/AppData/Local/Temp/scene-craft-issue16-replay
cp docs/research/evidence/psd16-display-transform.py /mnt/c/Users/oy_ta/AppData/Local/Temp/psd16-display-transform.py
'/mnt/c/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --disable-autoexec --python-exit-code 17 --python 'C:\Users\oy_ta\AppData\Local\Temp\psd16-display-transform.py' -- 'C:\Users\oy_ta\AppData\Local\Temp\scene-craft-issue16-replay'

/tmp/scene-craft-psd16-venv/bin/python docs/research/evidence/psd16-package-verify.py /mnt/c/Users/oy_ta/AppData/Local/Temp/scene-craft-issue16-replay
```

最終スクリプトを上記の手順で新規の`replay`フォルダーへ最初から実行し直し、全検査の成功を確認した。保存した確認用ファイルとevidenceはこの再実行の結果である。再現時は末尾のフォルダー名を新しいものに置き換える。
