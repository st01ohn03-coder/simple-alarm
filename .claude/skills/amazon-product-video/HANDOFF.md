# このスキルを他の人に渡す

配るファイルは **`amazon-product-video.skill` 1つだけ**。
中に雛形・スクリプト・ドキュメントが全部入っている（37ファイル / 約340KB）。

---

## 受け取る側の導入方法

### claude.ai を使っている場合

1. 設定 → Capabilities → Skills を開く
2. `amazon-product-video.skill` をアップロードする
3. 有効にする

チャットで `.skill` ファイルを受け取った場合は、ファイルカードの
**「Save skill」** ボタンからそのまま入れられる（組織の設定で許可されている場合）。

### Claude Code を使っている場合

`.skill` は zip なので、展開して skills ディレクトリに置く。

```bash
# 自分だけで使う
mkdir -p ~/.claude/skills
unzip amazon-product-video.skill -d ~/.claude/skills/

# チームのリポジトリで共有する
mkdir -p <リポジトリ>/.claude/skills
unzip amazon-product-video.skill -d <リポジトリ>/.claude/skills/
```

`~/.claude/skills/amazon-product-video/SKILL.md` ができていれば入っている。

---

## 受け取る側に必要なもの

| | 用途 | 無いとどうなるか |
|---|---|---|
| Node.js 18 以上 | 全体 | 動かない |
| npm パッケージ | Playwright・ffmpeg・pngjs | 動かない（`npm install`） |
| Chromium | 映像の描画 | 動かない（`npx playwright install chromium`） |
| Python 3 + edge-tts | ナレーション | 映像は無音で書き出せる |
| ネット接続 | 商品ページ取得・フォント取得 | 雛形のフォントだけなら不要 |

**最初に `node tools/doctor.js` を走らせれば、足りないものと直し方が全部出る。**

---

## 渡すときに伝えること

- **雛形はそのままでも書き出せる。** まず一度通して動かしてもらうと、
  以降の変更の影響が分かりやすい。
- **`src/assets/` の画像は placeholder。** 自分の商品の画像に置き換える。
- **`BRIEF.md` を埋めてから文言を書き換える。** ここが品質を決める工程。
- **`node tools/qa.js` が通るまで納品しない。** 1件でも外れたら終了コードが 0 にならない。

---

## 入れ替えるとよい設定

渡した相手の商材・ブランドに合わせて、`project.json` の次を見直す。

| 項目 | 何を変えるか |
|---|---|
| `theme.colors` | ブランドカラー。変えたら `node tools/apply-config.js` |
| `narration.voice` | `ja-JP-NanamiNeural`（女性）／`ja-JP-KeitaNeural`（男性） |
| `video.deliverables` | 納品する縦横比。16:9 と 1:1 が既定 |
| `qa` | 入稿先の基準。別媒体なら要調整 |
| `compliance.profile` | 別マーケットプレイスなら `docs/compliance/` に新規作成 |
| `compliance.competitorNames` | 出してはいけない競合名 |

**`compliance.allowedClaims` は空のまま渡す。** 根拠のある主張は商品ごとに違うので、
前の商品のものを引き継ぐと誤った注記のまま出てしまう。

---

## 色を変えたときの注意

白文字を乗せると危ないのは橙・黄・明るい緑。
ブランドカラーをそのまま背景にすると、検品のコントラストで落ちることがある。

落ちたら `references/design.md` の「色を決めるときの注意」を見る。
暗くするか、乗せる文字を濃くするかのどちらか。

---

## このスキルが含まないもの

- **商品画像**。権利の問題があるので placeholder だけ入れてある。
- **図版（フロー図・役割分担図）**。容量のため。内容は `references/` に文章で入っている。
- **書き出し済みの動画**。
