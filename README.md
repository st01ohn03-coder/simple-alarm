# Simple Alarm

すごくシンプルな UI のアラーム Web アプリ。**HTML 1 ファイルだけ**で動きます。ビルド不要、依存ゼロ。

![preview](https://img.shields.io/badge/single--file-HTML-7cc4ff?style=flat-square)

## 特徴

- 単一の `index.html` のみ。ダブルクリックで起動。
- 大きなデジタル時計（秒まで表示）
- アラーム時刻を 1 つセットできる
- 発火時：画面が赤く点滅 + Web Audio API で生成したビープ音
- 「停止」ボタンを押すまで鳴り続ける
- ダークテーマ、レスポンシブ

## 使い方

1. `index.html` をブラウザで開く（ダブルクリックでも OK）
2. アラーム時刻を入力
3. **セット** を押す
4. 設定時刻になると鳴るので **停止** を押す

途中で止めたいときは **解除** を押してください。

> ブラウザのオートプレイ制限により、初回は **セット** を 1 度押す（＝ユーザー操作を経る）まで音が鳴らない場合があります。

## ライブで試す

ローカルで開くだけ。サーバー不要：

```bash
# Windows
start index.html

# macOS
open index.html

# Linux
xdg-open index.html
```

## 動作環境

最近のモダンブラウザ（Chrome / Edge / Firefox / Safari）。Web Audio API 必須。

## ライセンス

MIT
