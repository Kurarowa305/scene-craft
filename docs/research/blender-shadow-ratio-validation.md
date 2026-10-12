# 影の有無の比率から調整用マスクを作る検証

2026-10-12、[Issue #4](https://github.com/Kurarowa305/scene-craft/issues/4)。[指定受け面の Shadow Catcher](blender-shadow-validation.md) の代案として、通常の不透明な物体を受け面として残し、影を落とす設定だけを変えた二つのレンダーから選択用画像を作れるか確認した。**合成シーンの地面に落ちる影を白黒画像として抽出できた。任意のシーンの全ての影を表す保証や、方式の採用判断はしていない。**

## 方法

既存の合成 `render-input.blend` を読み、Blender 5.2.2 LTS / Cycles CPU / 96×96 / 64 samples で二度レンダーした。seed は173固定、adaptive sampling と denoising は無効。カメラ、材質、ライト、位置は変えず、全 mesh（`Cube` と `Probe_Ground`）の `visible_shadow` だけを True → False に切り替えた。実行時の RNA に同プロパティが存在することも確認した。元ファイルは保存し直していない。

OpenEXR 3.5.2 で双方の `ViewLayer.Diffuse Direct` を読み、表示変換を適用していない float32 の RGB から次を計算した。

```text
L = 0.2126 R + 0.7152 G + 0.0722 B
mask = clamp(1 - L(通常) / L(影なし), 0, 1)
L(影なし) <= 0.000001 の画素は mask = 0
```

係数・ゼロ除算の扱いはこの実験の設定で、制作時の作業色空間にかかわらず採用する契約ではない。比較対象は材質色を含まない Cycles の Diffuse Direct である。[Blender 公式 Passes](https://docs.blender.org/manual/en/latest/render/layers/passes.html)

## 結果

- 最大値は 0.93655。対応する画素は、通常の輝度 0.02018、影なしの輝度 0.31807。
- 9216画素中、338画素がマスク値0.05超、282画素が0.5超。今回、分母のしきい値以下やクリップ前の負値はなかった。
- 16bit グレースケール PNG を生成し、黒地に投影された影の領域が白く現れることを目視した。AI 画像生成や手描きのマスクではなく、上記計算の直接出力。

```text
C:\Users\oy_ta\AppData\Local\Temp\scene-craft-issue4-probe\shadow-ratio-normal.exr
C:\Users\oy_ta\AppData\Local\Temp\scene-craft-issue4-probe\shadow-ratio-no_shadow.exr
C:\Users\oy_ta\AppData\Local\Temp\scene-craft-issue4-probe\shadow-ratio-mask.png
```

[レンダースクリプト](evidence/blender-shadow-ratio-probe.py)、[数値処理スクリプト](evidence/blender-shadow-ratio-analyze.py)、[レンダー条件](evidence/blender-shadow-ratio-render.json)、[数値結果と入力ハッシュ](evidence/blender-shadow-ratio-analysis.json)。PSD 化や Photoshop での選択・調整操作は試していない。

## 適用範囲と未確認事項

この方式は「影の設定を変えると直接拡散光がどれだけ増えるか」の近似マスクである。物体の表面を Shadow Catcher に置き換えない利点はあるが、完全な Shadows パスや物理的な再合成成分とは異なる。

- 今回確かめたのは不透明な立方体から平面へ落ちる影だけ。任意の不透明な可視受け面へ拡張できる候補だが、全物体・曲面・複雑な自己遮蔽は未検証。
- 表面の向きによる暗さ、間接光不足、AO、反射中の影等を同じ意味の影として抽出するものではない。自己影のうち、どの現象が `visible_shadow` の切替で変わるかは形状による確認が必要。
- 透明・屈折材質、volume、発光 mesh、髪・曲線、非 mesh オブジェクトや複雑なインスタンスは対象にしていない。全 mesh の設定変更だけでこれらの影を網羅できるとはしない。
- RGB を一つの輝度にするため色付きの影の情報を失う。分母が小さい場所では比率が不安定になり得る。しきい値でゼロにする扱いは有効な影を消す可能性もある。
- 同じ seed でも遮蔽条件を変えると光路が変わり得る。今回問題が見えなかったことは、別シーンでのノイズ、縁の品質、ちらつきの保証にはならない。
- 二つのレンダーを要する。既存の通常レンダーとの再利用、所要時間、保存量、失敗・停止時の扱いは未設計。

利用者に示せる選択肢は、指定受け面の native Shadow Catcher を加工する方式と、今回のような通常／影なし比較による近似マスクを使う方式である。それぞれの対象範囲を説明し、全シーンの Shadows 要求を暗黙に狭めずに選ぶ必要がある。試験成功だけで初期版の方式を確定しない。

## 採否

2026-10-12、利用者は指定受け面に対する標準Shadow Catcher方式を選び、本資料の比率による近似マスク方式は採用しなかった。本資料は比較の根拠として残し、実装すべき仕様とは扱わない。
