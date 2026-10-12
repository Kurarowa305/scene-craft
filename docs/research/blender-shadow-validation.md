# Cycles の指定受け面から影の情報を出力する検証

2026-10-12、[設計 Issue #4](https://github.com/Kurarowa305/scene-craft/issues/4)。利用者が希望する Shadows は影の選択・調整に使う画像で、元画像から影を完全に除去するための分解ではない。この用途に向け、**指定した地面を受け面にした Shadow Catcher の出力は成立した。ただし、全シーンの影を網羅する汎用マスクの成立は確認していない**。

## 検証条件と結果

[先行する検証](psd-export-validation.md) で利用した合成シーン `render-input.blend` を Windows Blender 5.2.2 LTS の background プロセスで読み込み、地面 `Probe_Ground` だけを受け面にした。実際の作品は使っていない。Cycles CPU、96×96、16 samples、32bit multilayer EXR を一度レンダーした。

```python
receiver.is_shadow_catcher = True
bpy.context.view_layer.cycles.use_pass_shadow_catcher = True
```

[実行スクリプト](evidence/blender-shadow-probe.py)、[実行結果](evidence/blender-shadow-render.json)、[EXR チャンネルの独立検査](evidence/blender-shadow-channels.json)。EXR は OpenEXR 3.5.2 で読み、実際に `ViewLayer.Shadow Catcher` と `ViewLayer.Noisy Shadow Catcher` の存在を確認した。前回の一般的な `use_pass_shadow` の指定だけでは得られなかった出力である。

| Shadow Catcher チャンネル | 最小値 | 最大値 |
| --- | --- | --- |
| R | 0.0754 | 1.4210 |
| G | 0.0258 | 1.1412 |
| B | 0.0167 | 1.1209 |

各チャンネルは有限値を持つ 96×96 float32 画像だった。RGB が異なり、1 を超える値もあり、そのまま白黒の0〜1影マスクとして解釈できる出力ではなかった。元のシーンには赤い立方体があるが、色の差を特定の原因だけに帰属させる追加対照試験はしていない。

出力先は `C:\Users\oy_ta\AppData\Local\Temp\scene-craft-issue4-probe\shadow-catcher-passes.exr`。設定変更はこの一時プロセスだけに適用し、入力の `.blend` は上書き保存していない。

## 設計に使える事実と限界

[Blender 5.2 の Passes](https://docs.blender.org/manual/en/latest/render/layers/passes.html) は、Shadow Catcher を指定受け面の影の出力として説明する。[公式 Object 文書（4.4）](https://docs.blender.org/manual/sr/4.4/render/cycles/object_settings/object_data.html) は Shadow Catcher が間接光相互作用も扱い、パスを有効にした場合と無効の場合で結果が異なると説明する。後者は旧版の概念説明であり、現行版の実機事実は今回の出力で区別して確認した。

- **指定した地面の受け面**については、値が変化する影関連出力の取得を確認できた。壁も受け面にする構成は機能上の候補だが、今回壁や複数受け面は検証していない。
- 地面を Shadow Catcher にすると同じレンダーの Combined も地面の通常表示から変わる。元の合成済み画像を維持するなら、影用の設定を適用した追加の作業コピーでレンダーする等の分離が必要となる。これは実装候補で、利用者が方式を選んだという意味ではない。
- 白黒の選択用画像へ加工するには、RGB のどの情報を使うか、1超をどう扱うか、受け面以外をどう除外するか、輪郭をどう扱うかを決める必要がある。今回、その加工や Photoshop での調整効果は検証していない。
- 全物体を一律に Shadow Catcher にすれば、全ての自己影・接触影・透過影等を集められるとは確認していない。指定地面の成功を、利用者の希望する全シーンの Shadows の完成として扱わない。
- 反射・間接光・透明材質・曲面・複数受け面・低照度での品質、ノイズ、通常レンダーへの重ね方も未検証。AO を同じ意味の Shadows に置き換えていない。

利用者が任意の地面・壁などを指定して調整する方式を許容するなら、この出力を加工する追加検証へ進める。全ての影を一律に選べることが必要なら、対象とする影の定義を維持したまま別方式を検討する必要がある。今回の試験だけで要件を「地面の影だけ」に狭めない。

## 再現

Windows 一時フォルダに合成シーンとスクリプトを配置し、Windows の `blender.exe --background --factory-startup --python-exit-code 1 --python <スクリプトのWindowsパス>` で実行する。検査には既存の [EXR 検査スクリプト](evidence/psd-exr-channels.py) と `/tmp/scene-craft-psd-probe` の OpenEXR を使用した。ユーザー作品を入力に差し替える試験ではない。

## 採否

2026-10-12、利用者は指定した地面・壁などの受け面を対象とする標準Shadow Catcher方式を採用した。今回の実機確認は地面一面に限られ、PSDへの変換方法と他の受け面での品質は引き続き未検証。現在の契約は [Blender連携設計](../design/blender-integration.md) を参照する。
