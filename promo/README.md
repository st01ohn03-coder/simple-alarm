# SneakDraw 30秒プロモーション動画

オンラインガチャ **SneakDraw**（https://gachasni.com/ ）の 30 秒プロモ動画を、
**動画編集ソフトを一切使わずコードだけ**で生成する一式です。

出力: `out/sneakdraw_promo_30s.mp4` — 1920x1080 / 30fps / 30.6秒 / H.264 + AAC

## 何をどう作っているか

| 要素 | 作り方 |
|---|---|
| 映像 | `promo.html` を Chromium（Playwright）で 1 フレームずつ描画。`SEEK(t)` だけで全フレームが決まる決定論的レンダラ |
| 素材 | gachasni.com の実データ（ガチャのサムネイル、S〜C賞・ラストワン賞のバッジ、ポイントコイン）を `fetch_assets.py` で取得 |
| ナレーション | Microsoft Edge の日本語ニューラル音声（`edge-tts` / ja-JP-NanamiNeural）を `tts.py` で生成 |
| 字幕 | ナレーションの実測尺からタイムラインを組み、黄色＋黒縁で焼き込み |
| BGM・効果音 | `audio.py` で numpy 合成（キック／スネア／ハット／サブベース／パッド／プラック／インパクト／ライザー／ウーッシュ／コインのきらめき）。音源ファイルは未使用 |
| ミックス | ナレーションの音量に追従して BGM を下げるダッキング処理つき |
| エンコード | ffmpeg（`imageio-ffmpeg` 同梱のスタティックビルド） |

## 構成（30.6秒）

| 時間 | シーン | ナレーション |
|---|---|---|
| 0.0–4.0 | フック（スニーカーとスタンプ） | 欲しい一足は、いつも抽選で終わる。 |
| 4.0–7.8 | ブランド提示 | SneakDrawなら、1回100ポイントから。 |
| 7.8–12.3 | ラインナップ（実際のガチャ 12 種） | トラヴィス、ハイブランド、ポケカ、最新ガジェット。 |
| 12.3–17.3 | アプリUI＋賞ランク | S賞からラストワン賞まで、残り本数はリアルタイム表示。 |
| 17.3–22.1 | ポイント還元 | C賞はポイント還元。最後まで狙える。 |
| 22.1–25.7 | タグライン | 欲しいスニーカーに、いちばん近いクジ。 |
| 25.7–30.6 | CTA（gachasni.com） | スニークドロー。ガチャスニ、ドットコム。 |

動画内の数字（1回100ポイント〜、1回1,200pt、残り8,289本、賞ランク5段階、C賞300pt）は
すべて gachasni.com の掲載内容にもとづいています。

## 作り直す

```bash
cd promo
./build.sh              # 素材取得 → ナレーション → フレーム → 音 → エンコード（約5分）
./build.sh --no-tts     # ナレーションを作り直さない
```

必要なもの: Python 3（`edge-tts` `numpy` `scipy` `imageio-ffmpeg`）、Node.js（`playwright`）、Chromium。
日本語フォント（Noto Sans JP / Zen Kaku Gothic New）は `work/fonts/` に置いてください。

## 個別に動かす

```bash
python3 fetch_assets.py       # 素材を work/assets/ に取得
python3 tts.py                # ナレーション生成＋work/timeline.json 作成
node capture.mjs --preview    # 各シーンの静止画だけ確認（work/preview/）
node capture.mjs              # 全918フレームを work/frames/ に書き出し
python3 audio.py              # work/mix.wav を合成
```

## 文言・尺を変える

`script.json` のセリフを書き換えて `./build.sh` を実行すると、
ナレーションの実測尺からタイムラインと字幕が自動で組み直されます
（`tts.py` の `TARGET_TOTAL` が目標尺）。
シーンの見た目は `promo.html` の `renderS1`〜`renderS7` に 1 シーン 1 関数で入っています。

## 注意

`work/` は生成物（素材・フレーム・音声）なのでコミットしていません。
`build.sh` を流せば再生成されます。
