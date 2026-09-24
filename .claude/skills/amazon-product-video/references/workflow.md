# 制作ワークフロー

Amazon の ASIN を渡してから動画を納品するまでの手順。
他の商品でも同じ手順で回せるように、判断が要る工程と機械に任せる工程を分けてある。

---

## 全体像

| 工程 | 内容 | 自動 | 実行時間 |
|---|---|:--:|---|
| ⓪ 環境 | 必要なものが揃っているか確かめる | ○ | 5秒 |
| ① 調査 | 商品ページから素材と情報を集める | ○ | 30秒 |
| ② 設計 | 構成と原稿を決める | **人が判断** | 2〜4時間 |
| ③ 準備 | 設定を反映し、文字を切り出し、表記を点検する | ○ | 15秒 |
| ④ 音声 | ナレーションを合成する | ○ | 2分 |
| ⑤ 映像 | 動画を書き出す（16:9 と 1:1） | ○ | 100秒 |
| ⑥ 検品 | 納品できる状態か機械で確かめる | ○ | 40秒 |

②を除けば実行時間は5分ほど。時間を使うのは②だけで、ここが品質を決める。

```bash
tools/pipeline.sh all <ASIN>     # ⓪①を実行し、②の指示を出して止まる
# ② を終えたら
tools/pipeline.sh build && tools/pipeline.sh qa
```

別の人に渡すとき、別の商品で始めるときに何が要るかは
`references/design.md` にまとめてある。

---

## ⓪ 環境

```bash
tools/pipeline.sh doctor
```

Node・Chromium・ffmpeg（libx264 と AAC の有無まで）・Python・edge-tts・フォント・
`project.json` の妥当性を調べ、足りないものは直し方まで出す。
必須が1つでも欠けると終了コードが 0 にならないので、CI に置いてもそのまま使える。

---

## ① 調査

```bash
tools/pipeline.sh fetch <ASIN>
# または  node tools/fetch-product.js "<商品URL>"
```

`build/<ASIN>/` に次が落ちる。

| ファイル | 中身 |
|---|---|
| `product.json` | タイトル・箇条書き・A+（商品紹介）本文・比較表のテキスト・評価と件数 |
| `page.html` | 取得した生HTML（あとから読み直せる） |
| `img/main_*.jpg` | 商品画像（高解像度） |
| `img/aplus_*.jpg` | A+ の画像 |

**取れないもの**

- **レビュー本文**。Amazon がログインを要求する。星の分布と件数までは取れるので、
  評価が割れているかどうかは判断できる。
- **価格**。配送先で表示が変わるうえ、そもそも動画に入れない方針なので取得していない。

**うまくいかないとき**
`商品タイトルが取れませんでした` と出たら Amazon 側で弾かれている。時間をおいて再試行するか、
`build/<ASIN>/page.html` を開いて中身を確認する。

---

## ② 設計 — ここだけは人が判断する

**この工程がやること**：商品ごとに「何が購買障壁か」を決めて、それを潰す構成に落とす。
機械的な変換では決まらないので、自動化していない。

### 手順

1. **`product.json` と `img/` を読む。**
   特に A+ 本文と比較表。メーカーが自分で「何を売りにしているか」を書いているので、
   訴求の候補はここに全部ある。

2. **購買障壁を4つ前後に絞る。** 実例（PDF編集ソフト）ではこうだった。詳しくは `references/example.md`。

   | 障壁 | 根拠 | 打ち手 |
   |---|---|---|
   | 自分の用途に足りるか分からない | 機能が多く、何ができるか伝わりにくい | 実画面で基本機能を並べる |
   | 上位版を買う理由が分からない | STANDARD との差が比較表の奥にある | 「上位版だけの機能」を明示する |
   | 買い切りは損しないか | A+ が買い切りを推している | 支払い回数を可視化する |
   | 買ってから違ったと思いたくない | ★3.3 で星1が21% | 対応環境を最後に隠さず出す |

   **指名検索で来る商品は中〜下層の見込み客が多い。**
   認知ではなく、買う直前の引っかかりを外すのが動画の仕事になる。

3. **評価が割れている商品は、期待値をそろえる要素を必ず入れる。**
   星1が多い商品は「思っていたものと違った」が主因のことが多い。
   対応OS・台数・ライセンス形態を最後に出すと、CVR だけでなく返品とレビューにも効く。

4. **書き換える。**

   | 変えたいもの | ファイル |
   |---|---|
   | 画面文字・構成要素 | `src/video.html` |
   | シーンの長さ・出るタイミング | `src/timeline.js` の `SCENES` |
   | 製品画面・パッケージ画像 | `src/assets/*.jpg` |
   | ナレーション原稿 | `tools/narration.py` の `LINES` |

5. **尺を確認する。**

   ```bash
   python3 tools/narration.py --check
   ```

   セリフがシーンの終わりをはみ出していないかを実測で出す。
   はみ出したら、原稿を短くするか、`--rate +10%` で速く読ませるか、
   `src/timeline.js` でそのシーンを長くする。

   **シーンの長さは `src/timeline.js` が唯一の正。**
   `tools/narration.py` はそこから区間を読むので、片方だけ古くなることはない。

### 守ること

- **価格・割引・キャンペーンは動画に入れない。** Amazon の商品動画ガイドラインで認められていない。
  買い切りの訴求は「支払い回数」の比較に置き換える。詳しくは `references/example.md` 第4章。
- **競合の名指しをしない。** 「サブスクリプション型」のような一般名詞にとどめる。
- **Amazon への言及・カート誘導・URL・連絡先を入れない。**
- **自社調べの数値には注記を付ける。** 調査主体・対象・期間を画面に出したまま使う。注記を消して使い回さない。
- **ミュートで成立させる。** 商品ページの動画は音が出ない状態で再生される。
  伝えたいことは画面文字に出し、ナレーションは補助に留める。

---

## ③ 準備

```bash
node tools/apply-config.js   # project.json の配色を src/theme.css に反映
node tools/subset-fonts.js   # 画面に出る文字だけを切り出す
node tools/lint-copy.js      # 入稿できない表記がないか
```

**②で新しい漢字を足したら `subset-fonts.js` を必ず実行する。** 飛ばすとその字が豆腐になる。
`lint-copy.js` は価格・URL・競合名・根拠なしの最上級などを拾う。

図版用は別サブセット。

```bash
node tools/subset-fonts.js --diagrams    # → docs/diagrams/fonts/
```

---

## ④ 音声

```bash
python3 tools/narration.py                      # 既定（女性・+6%）
python3 tools/narration.py --voice ja-JP-KeitaNeural
python3 tools/narration.py --rate +10%
python3 tools/narration.py --no-music           # 環境音を入れない
```

`dist/narration.m4a` ができる。仕様は `references/design.md` の「音」。

---

## ⑤ 映像

```bash
node tools/render.js --preset 16x9
node tools/render.js --preset 1x1
node tools/render.js --preset 9x16              # 縦型も出せる
node tools/render.js --audio none               # 無音で出す
```

`dist/narration.m4a` があれば自動で多重化される。無ければ無音トラックになり、警告が出る。

---

## ⑥ 検品

```bash
node tools/qa.js
node tools/qa.js --skip-video    # 書き出し前にレイアウトだけ見る
```

34項目を見て、1件でも外れると終了コードが 0 にならない。

| 見るもの | 基準 |
|---|---|
| 表記 | 入稿できない文言が無いこと（`tools/lint-copy.js`） |
| レイアウト | 全シーンの中身が余白の内側（16:9・1:1 とも）。画面外にはみ出していないこと |
| 文字の大きさ | キャンバス高さの `qa.minFontPctH`% 以上。注記だけ `qa.minSmallFontPctH`% |
| コントラスト | `qa.minContrast`:1 以上。大きな文字は `qa.minContrastLarge`:1 |
| ページ | `video.html` に JS エラーが出ていないこと |
| 動画仕様 | 720p 以上／H.264・yuv420p／23.976fps 以上／音声トラックあり |
| ラウドネス | -17〜-15 LUFS |
| トゥルーピーク | -1.0 dBFS 以下 |
| 整合 | 動画の尺が `timeline.js` の `DUR` と一致。映像と音声の尺差 0.15 秒以内 |

基準値は `project.json` の `qa` にまとまっている。入稿先が変わったらここを直す。

**落ちたときの読み方**

| 落ちた項目 | だいたいの原因 |
|---|---|
| 表記 | ②で価格や URL を書いてしまった。`node tools/lint-copy.js` に理由と直し方が出る |
| レイアウト | ②で文言を足してはみ出した。文字を減らすかフォントサイズを下げる |
| コントラスト | 明るい背景に淡い文字を乗せた。`project.json` の色を直して `apply-config.js` |
| 整合（尺） | `timeline.js` を変えたあと書き出し直していない |
| 整合（映像と音声） | ナレーションを作り直していない。`python3 tools/narration.py` |
| ラウドネス | 音声を手で加工した。`tools/narration.py` から作り直す |

---

## 他の商品でやるとき

作り替えるのは②だけ。①③④⑤⑥ はそのまま使える。

1. `tools/pipeline.sh fetch <新しいASIN>`
2. `src/assets/` の画像を差し替える（`build/<ASIN>/img/` から選んで切り出す）
3. `src/video.html` の文言を書き換える
4. `tools/narration.py` の `LINES` を書き換える
5. 必要なら `src/timeline.js` の `SCENES` でシーンの長さを調整する
6. `tools/pipeline.sh build && tools/pipeline.sh qa`

素材の権利は商品ごとに確認すること。
このリポジトリに入っている画像は商品ページ掲載画像から切り出したもの。

---

---

踏んだ落とし穴は `references/design.md` にまとめてある。
