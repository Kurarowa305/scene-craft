# PSD/PSB書き込みライブラリの一次資料確認

2026-10-31。[13レイヤーPSD出力の変換方式とライブラリを検証する](https://github.com/Kurarowa305/scene-craft/issues/16)の補助調査。既存の[合成データ検証](psd-export-validation.md)を受け、PhotoshopAPIの制約の原因と、アプリ側で必要な処理を調べた。ここに記載した補修案はソースからの推論であり、単独では実行検証・採用合意を意味しない。

## 調査対象の固定

- 既存検証のPhotoshopAPI 0.9.1は、公式タグ`v0.9.1`のコミット`055cad5254390d164b9a2ee8591d5b8f4f6758cc`を確認。[固定ソース](https://github.com/EmilDohne/PhotoshopAPI/tree/055cad5254390d164b9a2ee8591d5b8f4f6758cc)。[PyPIの同版メタデータ](https://pypi.org/project/PhotoshopAPI/0.9.1/)も確認した。
- 調査時の公式masterは`51bb741ba623a69d7a02b29e0e6645494bf4a9c6`。[固定ソース](https://github.com/EmilDohne/PhotoshopAPI/tree/51bb741ba623a69d7a02b29e0e6645494bf4a9c6)。UnicodeStringの終端NULの処理とImageDataの空プレビュー生成は0.9.1と同じ。最新版に更新するだけで解決する根拠はない。
- 補助候補psd-tools 1.24.0は、公式タグ`v1.24.0`のコミット`1b8c1d404d1b976748e7dbbca33ed5898663371b`を確認。[固定ソース](https://github.com/psd-tools/psd-tools/tree/1b8c1d404d1b976748e7dbbca33ed5898663371b)。配布wheelとソースのバイナリ同一性までは確認していない。

## 名前末尾NUL

PhotoshopAPIの`UnicodeString::write`は末尾にUTF-16のゼロを追加し、その分も長さへ含める。読み取り側ではゼロを除去する。このため同ライブラリ内の往復だけでは他パーサーが示す末尾NULを検出できない。[UnicodeString.cpp](https://github.com/EmilDohne/PhotoshopAPI/blob/055cad5254390d164b9a2ee8591d5b8f4f6758cc/PhotoshopAPI/src/Core/Struct/UnicodeString.cpp)。Adobe仕様のUnicode文字列にも終端の説明はあるが、Photoshop実機のレイヤー名表示については別途観察が必要。[Adobe形式仕様](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)。

psd-toolsの`Layer.name`設定はPascal名とUnicode名タグを更新する。既存検証のように、入力で指定した13名称を期待値として設定し直す方法が候補になる。未知の名前を無条件に切り詰めたり、比較時にだけNULを無視してファイルの名称を検証済みと扱ったりしない。[name実装](https://github.com/psd-tools/psd-tools/blob/1b8c1d404d1b976748e7dbbca33ed5898663371b/src/psd_tools/api/layers.py)。

## 合成プレビュー

PhotoshopAPIは統合画像に相当するImageDataをレンダーパスから生成せず、ゼロ画素をRLEで書く。16bitでも同じ処理である。[ImageData.h](https://github.com/EmilDohne/PhotoshopAPI/blob/055cad5254390d164b9a2ee8591d5b8f4f6758cc/PhotoshopAPI/src/PhotoshopFile/ImageData.h)。公式READMEもmerged image非対応を説明しており、13枚のレイヤーが正しくても、プレビューを読む外部アプリの表示まで正しいとはいえない。[固定README](https://github.com/EmilDohne/PhotoshopAPI/blob/055cad5254390d164b9a2ee8591d5b8f4f6758cc/README.md)。

scene-craftの初期表示はCombinedのみなので、13枚を再合成する必要はなく、変換済みCombinedのチャンネルをImageDataへ格納する補修が候補となる。psd-toolsの低レベル`ImageData.set_data`はチャンネルの生バイト列を圧縮できる。[ImageData実装](https://github.com/psd-tools/psd-tools/blob/1b8c1d404d1b976748e7dbbca33ed5898663371b/src/psd_tools/psd/image_data.py)。これは内部APIの利用となる。

`PSDImage.save`は更新状態によってプレビューを再合成する。補修には低レベルレコードの書き出しを使い、意図しないcompositor処理を避ける方法を検証する。再保存後にRGB全チャンネルとImageDataの16bit値を別々に確認する必要がある。[save実装](https://github.com/psd-tools/psd-tools/blob/1b8c1d404d1b976748e7dbbca33ed5898663371b/src/psd_tools/api/psd_image.py)。透明Combinedのmerged alphaとPhotoshop実機の解釈は、RGBのみの補修とは別の確認事項である。

## 色と16bit

PhotoshopAPIのICCプロパティはプロファイルを付与するが画素の色変換は行わない。[LayeredFileの説明](https://github.com/EmilDohne/PhotoshopAPI/blob/055cad5254390d164b9a2ee8591d5b8f4f6758cc/PhotoshopAPI/src/LayeredFile/LayeredFile.h)。scene-craftはEXRのシーンリニア値を契約に従って変換してから書き込む必要がある。ICCバイト一致、16bit保存、AgX等の表示変換、Photoshopの表示は別々に検証する。既存の合成検証で確認したuint16値の保持だけでは、Photoshop内部の値域やレタッチ結果は確定しない。

Blenderのパス資料は材質色と照明成分を区別し、Indexパス等の制約を説明している。[Blender Passes](https://docs.blender.org/manual/en/latest/render/layers/passes.html)。ただし`latest`は調査時5.2 LTSへ進んでいるため、将来の別バージョンの実行結果の代用にしない。AgXはsRGBの単なる転送関数とは異なる表示変換である。[Blender 4.0公式AgX導入説明](https://developer.blender.org/docs/release_notes/4.0/color_management/)。

## PSD/PSBの選択とメモリ

AdobeはPSDを2GBまでとし、幅または高さ30,000pxを超える文書、または2GBを超える文書には別形式を案内する。[形式別の容量](https://helpx.adobe.com/ca/photoshop/desktop/save-and-export/export-files-to-different-formats/photoshop-file-formats-overview.html)、[大容量文書の保存](https://helpx.adobe.com/photoshop/desktop/save-and-export/save-files/save-large-documents.html)。形式仕様ではPSBの寸法上限は300,000pxで、ヘッダーversion=2、PSDはversion=1。[Adobe形式仕様](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)。

PhotoshopAPIは`FileHeader::write`で拡張子からversionを選ぶ。容量を根拠にPSDからPSBへ自動変更する責務を同ライブラリへ委ねることはできない。[FileHeader.cpp](https://github.com/EmilDohne/PhotoshopAPI/blob/055cad5254390d164b9a2ee8591d5b8f4f6758cc/PhotoshopAPI/src/PhotoshopFile/FileHeader.cpp)。アプリ側で寸法、圧縮後サイズ、形式の各長さフィールド上限を確認し、PSB用の拡張子を使って生成し直す。既存PSDの拡張子だけを変える操作では形式は変わらない。

次のメモリ見積もりは配列形状からの計算で、実測ピークではない。13枚すべてをRGB uint16で同時保持するだけで`78×幅×高さ`バイト、RGBAなら`104×幅×高さ`バイトとなる。8000×8000ではそれぞれ約4.65GiB、6.20GiB。float32 EXR、変換途中の配列、内部圧縮、検証用展開、merged imageは別途必要である。

PhotoshopAPIのチャンネルラッパーは内部圧縮チャンネルを持ち、ImageData生成では全画面の作業配列を作る。[ImageChannel.h](https://github.com/EmilDohne/PhotoshopAPI/blob/055cad5254390d164b9a2ee8591d5b8f4f6758cc/PhotoshopAPI/src/Core/Struct/ImageChannel.h)、[ImageData.h](https://github.com/EmilDohne/PhotoshopAPI/blob/055cad5254390d164b9a2ee8591d5b8f4f6758cc/PhotoshopAPI/src/PhotoshopFile/ImageData.h)。psd-toolsの`ImageData.set_data`にも全チャンネル結合がある。したがって「PSBへ切り替えれば大容量も処理できる」とは扱わず、1枚ずつの変換・解放、別プロセス化、空きメモリ・ディスク不足での失敗を実装仕様へ渡す。中間EXRから生成を再開できても、メモリ不足を理由に画像を縮小して成功扱いにはしない。

## ライセンスと残る確認

PhotoshopAPIはBSD-3-Clause。[同版LICENSE](https://github.com/EmilDohne/PhotoshopAPI/blob/055cad5254390d164b9a2ee8591d5b8f4f6758cc/LICENSE)。psd-toolsはMIT。[同版LICENSE](https://github.com/psd-tools/psd-tools/blob/1b8c1d404d1b976748e7dbbca33ed5898663371b/LICENSE)。ライブラリの配布時には各ライセンスの表示条件に従う。これはバンドルする全依存のライセンス確認完了を意味しない。

本資料はソース確認の記録であり、補修済みファイルのPhotoshop受け入れ、2GB超の実保存、ピークメモリ計測を実施していない。採用判断は実EXRからの一貫変換と独立検証の結果へ統合する。Photoshopでの観察は[テスト境界・診断情報・初期版の受け入れ手順を決める](https://github.com/Kurarowa305/scene-craft/issues/14)へ引き継ぐ。
