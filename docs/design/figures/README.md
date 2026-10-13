# 概念の関係図の生成

`domain-concepts.mmd` を関係とスタイルの編集元とし、`domain-concepts.svg` と `domain-concepts.png` を設計資料に掲載する。`domain-concepts-before.png` はコミット `502dcdd` の関係図をレンダリングした比較用画像。

2026-10-13 の生成には `@mermaid-js/mermaid-cli` 12.0.0（Mermaid 12.2.0）、Chromium、Meiryoを使用。依存ツールは一時作業領域へ導入し、製品の依存関係には追加していない。フォントは成果物に同梱・埋め込みしていない。

1. `mmdc -i domain-concepts.mmd -o raw.svg --no-font-embed -b white` で描画する。必要に応じ `-p` でローカルのChromium実行ファイルを指定する。
2. `python3 layout-domain-concepts.py raw.svg domain-concepts.svg` でグループを左から右に並べる。図形・線・矢印を一体で水平反転し、ラベルを再反転して文字の向きを戻すため、参照の意味は変わらない。「親実行」のラベル位置も補正する。
3. SVGをChromiumで開き、幅2500 CSS px・高さ自動でSVG要素をスクリーンショットし、`domain-concepts.png` に保存する。日本語フォントを利用できる環境で行う。
4. PNGを目視し、文字切れ・ラベルの重なり・矢印を確認する。ソースの15ノード・49関係（ID、名称、参照元、参照先、ラベル）とレンダリング結果も照合する。

ノードと関係の意味を変更しない配置修正では、変更前の組の集合だけでなく重複数も比較する。グループの見出しは概念ノードに数えない。`linkStyle` はソースの関係の宣言順を参照するため、線の順序を変更した場合は分類も更新する。

リポジトリのルートで `python3 docs/design/figures/verify-domain-concepts.py` を実行すると、コミット `502dcdd` の変更前とソース、生成SVGのノード・ラベル・参照方向を照合できる。
