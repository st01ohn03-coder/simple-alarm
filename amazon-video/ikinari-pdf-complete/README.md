# いきなりPDF Ver.13 COMPLETE — Amazon 商品動画

ASIN **B0FVFTZSM7** 向けの商品動画。HTML/CSS/JS でアニメーションを組み、
ヘッドレス Chromium で 1 フレームずつキャプチャして H.264 の MP4 に書き出す。

| | 16:9 | 1:1 |
|---|---|---|
| 解像度 | 1920×1080 | 1080×1080 |
| 尺 | 34.0秒 | 34.0秒 |
| fps | 30 | 30 |
| 映像 | H.264 High / yuv420p | H.264 High / yuv420p |
| 音声 | 無音 AAC 48kHz | 無音 AAC 48kHz |
| サイズ | 約10MB | 約6MB |

出力先: `dist/`

- [`docs/ANALYSIS.md`](docs/ANALYSIS.md) — 商品ページ・A+ の分析と、動画構成の根拠
- [`docs/SCRIPT.md`](docs/SCRIPT.md) — 絵コンテ・台本・ナレーション原稿

---

## 作り直す

```bash
npm install                 # playwright と ffmpeg を入れる
node tools/render.js --preset 16x9
node tools/render.js --preset 1x1
```

その他のオプション:

```bash
node tools/render.js --preset 9x16              # 縦型 1080×1920
node tools/render.js --w 1280 --h 720 --fps 30  # 任意サイズ
node tools/render.js --crf 20 --out dist/a.mp4  # 画質と出力先を指定
```

環境変数で実行ファイルを差し替えられる。

- `CHROMIUM_PATH` — 既定は `/opt/pw-browsers/chromium`、なければ Playwright 同梱版
- `FFMPEG_PATH` — 既定は `@ffmpeg-installer/ffmpeg`

レンダリングはフレームをディスクに書かず、JPEG を ffmpeg の標準入力へ直接流している。
1920×1080 / 1020フレームで約60秒。

---

## 中身を編集する

| 変えたいもの | 触るファイル |
|---|---|
| 文言・構成要素 | `src/video.html` |
| 出るタイミング・動き・尺 | `src/timeline.js` |
| 色・文字サイズ・レイアウト | `src/styles.css` |
| 製品画面・パッケージ画像 | `src/assets/*.jpg` |

`src/video.html` をそのままブラウザで開くとループ再生でプレビューできる。

### 仕組み

CSS の transition / animation は一切使っていない。
`render(t)` が時刻 `t` からすべての要素の opacity と transform を計算する純関数になっていて、
レンダラは `window.__video.seekFrame(n)` を呼んでから撮る。
これでフレームの取りこぼしや中途半端な補間が起きない。

```
window.__video = { fps, duration, frames, seek(t), seekFrame(n) }
```

### 尺を変える

`src/timeline.js` の `DUR` と `SCENES` の `a` / `b`（各シーンの開始・終了秒）を変える。
シーンは 0.34 秒かけてフェードインし、0.30 秒かけてフェードアウトする。

### レイアウトが崩れていないか確かめる

`1rem = キャンバス幅の1%` に固定してあるので、16:9 と 1:1 で同じ比率のレイアウトになる。
文言を長くしたときは、各シーンの中身が余白の内側に収まっているか確認すること。
`docs/ANALYSIS.md` の入稿仕様表も合わせて見直す。

---

## 注意

- **価格は動画に入れていない。** 理由は `docs/ANALYSIS.md` 第4章。
- **実績数値の注記（※1・※3）を消さないこと。** 自社調べの数値なので、調査主体・対象・期間の表示が要る。
- 画像素材は商品ページ掲載画像から切り出したもの。公開前に権利関係を確認すること。
- フォントは Noto Sans JP（SIL Open Font License 1.1）。使用文字だけをサブセット化して `src/fonts/` に同梱している。
  文言に新しい漢字を足したときは、サブセットを作り直さないと豆腐になる。

### フォントのサブセットを作り直す

```bash
node tools/subset-fonts.js
```

`src/video.html` と `src/timeline.js` に出てくる文字を集めて Google Fonts から取り直し、
`src/fonts/` の woff2 と `tools/subset-chars.txt` を更新する。
