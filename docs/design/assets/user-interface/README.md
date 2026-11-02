# 画面・制作導線のスクリーンショット

画面設計が参照する固定コミット `5298534c2939aa44683baa6ebd3ced8285801466` の
`docs/design/prototypes/user-interface/` を実際に操作し、Chromium・1512×960・倍率1で撮影した。
画像のために試作のUIや応答を追加していない。固定版に表示がない仕様は本文で説明し、
対応する入口や最も近い操作状態を撮影した画像のキャプションで表示範囲を明記する。

`capture.py` はローカルの試作に対する操作と撮影だけを行う。
試作のLLM・ファイル操作・Git操作はすべてメモリ上の模擬動作であり、外部接続はない。
`screenshots.json` に画像の画面名・寸法・出典コミット、`screen-examples.json` に
各カード・箇条書き項目と画像の対応を記録する。同じ画面を説明する項目は画像ファイルを共有する。

## 再撮影

PlaywrightとChromiumを用意し、リポジトリルートから実行する。

```sh
git fetch origin 5298534c2939aa44683baa6ebd3ced8285801466
mkdir -p /tmp/scene-craft-ui-capture
git archive 5298534c2939aa44683baa6ebd3ced8285801466 docs/design/prototypes/user-interface | tar -x -C /tmp/scene-craft-ui-capture
python docs/design/assets/user-interface/capture.py /tmp/scene-craft-ui-capture/docs/design/prototypes/user-interface
```

ブラウザのパスは `--chromium`、保存先は `--output` で指定できる。
画面に含まれる時刻は再現性のため撮影スクリプトで固定している。
