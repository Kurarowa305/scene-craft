# Blender 操作経路とレンダー出力の調査

2026-10-12。[設計 Issue #4](https://github.com/Kurarowa305/scene-craft/issues/4) の判断材料。ローカルの読み取り専用確認と Blender 公式文書の調査であり、制作データの編集・保存・レンダー・Photoshop への読み込みは試していない。現在採用する設計は設計資料で管理する。

## 導入済み環境で確認したこと

WSL から次の Windows 実行ファイルに `--version` と `--help` を指定して実行した。GUI や制作ファイルは開いていない。

```text
C:\Program Files\Blender Foundation\Blender 5.2\blender.exe
Blender 5.2.2 LTS
build date: 2026-09-15
build hash: d13f752e3b9c
build platform: Windows
build type: Release
```

導入済み版のヘルプで、`--background`、`--python`、`--python-exit-code`、`--render-frame`、`--render-output` を確認した。Python 例外の終了コードを指定できるが、終了コードだけで期待した保存・出力がすべて揃ったとは判定できない。引数は指定順に実行され、ファイルのロードが先に指定した出力設定を上書きし得る。コマンドラインレンダーは [公式の説明](https://docs.blender.org/manual/en/latest/advanced/command_line/render.html) にもある。

`%APPDATA%\Blender Foundation\Blender\5.2` の列挙では設定ファイルのみを確認し、ユーザーアドオンや extensions のファイルは見つからなかった。組み込みアドオンの配置にも通信ブリッジは見当たらない。ただし、設定内の有効状態や別配置を網羅しておらず、導入されていないと断定するものではない。

| 操作経路 | 根拠と制約 | 未検証 |
| --- | --- | --- |
| 保存済み入力から別の background プロセスで編集案を作る | 導入済み CLI が Python とレンダーを受け付ける。WSL から Windows 実行ファイルの起動を確認した | 実際の編集・保存・レンダー、OS をまたぐ停止、途中状態とプロセスの照合 |
| 開いている GUI Blender に接続する | 今回の調査では既存の接続手段を確認できない。別途アドオン等が必要となる候補 | 接続、未保存状態、GUI コンテキスト、復旧、人間操作との協調 |

利用者は今回の設計対話で保存済み入力から別の編集案を作る運用を選択した。この選択と、実機で操作経路が成立したことは区別する。

## 「分けて出力」の意味

| 種類 | 公式機能で確認したこと | 設計への含意 |
| --- | --- | --- |
| 光などの成分 | Diffuse、Glossy、Emission などのパスがあり、エンジンで種類・制約が異なる。Light Groups は Cycles の機能 | 対応する成分をエンジンごとに検証し、任意の成分を一律に保証しない |
| 物体・材質のマスク | Cryptomatte は物体・材質等のマスクを作る。Cycles では透明・被写界深度等も扱う | マスク出力と物体だけの独立画像を別の契約にする |
| 物体群の別レンダー | View Layer ごとに Collection の表示・寄与を制御できる | 別レンダーで残す影・反射・遮蔽も指定する必要がある |

根拠は [Passes（5.2 LTS）](https://docs.blender.org/manual/en/latest/render/layers/passes.html)、[View Layers（5.2、公式インドネシア語版内の英語説明）](https://docs.blender.org/manual/id/5.2/render/layers/introduction.html)。推論として、マスクで既存画像を切り抜くだけでは、他の物体に隠れてレンダーされていない部分を取り戻せない。また、周囲を除いた別レンダーは影・反射等の寄与が変わり得るため、単純に重ねて合成済み画像を復元できるとは限らない。

利用者は物体別と成分別の両方を初期対象に選択した。どちらも「透明画像」とだけ記録せず、出力の用途と合成方法を区別する必要がある。

## 色・形式・アルファ

Blender はシーンリニアでレンダーと合成を行い、中間成果物には高精度の OpenEXR を推奨する。作業色空間と表示色空間は別であり、法線等の非色情報には色変換を適用しない。[Color Spaces（5.2 LTS、公式スペイン語版内の英語説明）](https://docs.blender.org/manual/es/latest/render/color_management/color_spaces.html)

表示用画像へ保存する際の `Save as Render` は View、露出等を適用する。PNG と TIFF は表示用の色空間に書き出せるが、拡張子だけでは変換条件を特定できない。[Displays and Views（5.2、公式インドネシア語版内の英語説明）](https://docs.blender.org/manual/id/5.2/render/color_management/displays_views.html)

| 用途の候補 | 形式の根拠 | 限界 |
| --- | --- | --- |
| 後で成分を合成・調整する原本 | OpenEXR は 16/32 bit float と alpha に対応 | Photoshop の実機でのチャンネル・レイヤー取り込み、色の解釈は未検証 |
| 見た目を確認し手作業へ渡す画像 | PNG / TIFF は 8/16 bit と alpha に対応 | 表示変換済み成分の合成で原本を復元できるとは扱わない |

形式の根拠は [Supported Graphics Formats（5.0）](https://docs.blender.org/manual/en/5.0/files/media/image_formats.html)。この形式表は 5.0 の説明であり、導入済み 5.2.2 でのファイル生成は未確認。

Straight alpha は RGB と alpha を別に持ち、PNG 等で用いられる。Premultiplied alpha は RGB に alpha を乗算し、レンダーや OpenEXR で用いられる。両者は同じ解釈ではない。[画像の設定（5.2）](https://docs.blender.org/manual/ja/5.2/editors/image/image_settings.html)。したがって出力契約には色空間、表示変換の有無、bit depth、alpha の解釈を持たせ、半透明の縁や発光を実機で確認する案が妥当である。これは設計上の推論で、採用形式の確定ではない。

## Vue に似たパス一覧との対応調査

同日の追加対話で、利用者は次表の Vue 風のパス名を希望した。5 クエリの限定調査では [Bentley の e-on 公式ページ](https://www.bentley.com/en/products/e-on-software/) を取得したが、指定パスの厳密な定義を確認できなかった。第三者サイト上の旧 Vue マニュアルや別製品の同名パスは、Vue の意味を確定する根拠に採用していない。

以下は Blender 側の候補と確認事項であり、Vue との互換表でも採用済みの出力契約でもない。特に **Vue の Diffuse Lighting が材質色を含むか、Shadows の合成方法、Specular Lighting と Reflections の区分は未確認**。利用者はレンダーエンジンをまだ選択していない。

| 希望する名称 | Blender 側の候補・根拠 | 対応を決める前に確認する意味 |
| --- | --- | --- |
| Combined | Combined。コンポジット適用前のレンダー | 最終合成済み画像との区別 |
| Material ID / Object ID | Cryptomatte の Material / Object | 色分けした ID 画像か、個別の選択用マスクか |
| Material color | Diffuse Color、または用途別 AOV | 材質全体の色か拡散成分の色か |
| Diffuse Lighting | Cycles の Diffuse Direct / Indirect は表面色を含まない | 直接光のみか、材質色を掛ける前か後か |
| Specular Lighting / Reflections | Cycles の Glossy Direct / Indirect / Color | 二つの希望パスへどう区分するか。名称だけで Direct / Indirect と同一視しない |
| Z Depth | Depth は最も近い可視表面への距離 | 実距離の原本か、範囲を正規化した調整用画像か |
| Global Alpha Mask | Render Layers の Alpha 出力 | 背景・透明材質を含む対象と alpha の解釈 |
| Shadows | EEVEE の Shadow と Cycles の Shadow Catcher は異なる機能 | 全シーンの影か、指定面に落ちる影か。Shadow Catcher への単純置換は未決 |
| Refractions | Cycles の Transmission。Transparent BSDF は含まない | 透過と屈折をどこまで含むか |
| Indirect Lighting | 各成分の Indirect 等から用途を定義する候補 | 拡散のみか、反射・透過も合算するか。ほかの出力との重複 |
| Ambient Occlusion | Cycles / EEVEE の AO パス | 距離等の条件と後処理での使い方 |

Blender 側の根拠は [Passes（5.2 LTS）](https://docs.blender.org/manual/en/latest/render/layers/passes.html) と [Render Layers Node（5.2 LTS）](https://docs.blender.org/manual/en/latest/compositing/types/input/scene/render_layers.html)。この一覧だけでは Combined を再構成する完全な分解にもならない。用途別に一部成分が重なる出力と、重複なく加算する出力は分けて契約する必要がある、という設計上の推論に留める。Vue の忠実な再現を求める場合は、対象版の一次資料または利用者の実例による追加確認が必要になる。

## 残る実機確認と判断

- 保存済み入力から編集案を生成し、元の制作データを変えずに保存・開き直せること。
- 成功・失敗・停止・再起動時に、Windows 側処理と出力を照合できること。
- 物体別画像の遮蔽・影・反射と、成分別画像の合成を意図どおりに扱えること。
- Photoshop の導入済み版で色、alpha、成分の取り込みが成立すること。Blender 公式文書だけでは Photoshop 側の成立を保証しない。
- 利用者が選んだ手続き的な配置と個別調整用の取り出しについて、取り出した個体の二重生成防止や再配置時の扱いを具体化すること。今回、その操作経路は検証していない。

英語 URL の直接取得は一部失敗したため、公式検索結果と取得できた公式翻訳版を参照した。最新 URL の内容は変わり得るため、確認時の版を本文に明記した。今回、形式・色変換の採用、レンダーエンジン、アドオン実装を調査だけで確定していない。

## 調査後の範囲変更

2026-10-12、利用者は初期構築をシーン全体の13種類の出力に限定し、Material ID／Object ID は色分け画像にすると指定した。本資料の物体別レンダー・隠れた部分・個別マスクに関する調査は検討経緯として残すが、初期版の要求や採用済み設計とは扱わない。現在の範囲は [Blender 連携設計](../design/blender-integration.md) を参照する。
