#!/usr/bin/env bash
# ============================================================
# スキル同梱の雛形を展開して、新しい商品動画プロジェクトを作る。
#
#   bash scripts/new-video-project.sh <ASIN または 商品URL> <作る場所>
#
# 例:
#   bash scripts/new-video-project.sh B0FVFTZSM7 ~/work/my-video
#
# やること:
#   1. 雛形を <作る場所> にコピーする（そのままでも書き出せる状態）
#   2. project.json に ASIN と slug を入れる
#   3. 商品ページから素材と情報を集める（ネットに出られる場合）
#   4. 判断用の BRIEF.md を、集めた事実入りで作る
#
# このあと:
#   cd <作る場所> && npm install && node tools/doctor.js
# ============================================================
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$SKILL_DIR/assets/template"

die() { printf '\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

[ $# -ge 2 ] || die "使い方: bash scripts/new-video-project.sh <ASIN または 商品URL> <作る場所>"
[ -d "$TEMPLATE" ] || die "雛形が見つかりません: $TEMPLATE"

RAW="$1"; DEST="$2"

# ASIN を取り出す（URL でも受ける）
if [[ "$RAW" =~ ^[A-Za-z0-9]{10}$ ]]; then
  ASIN="$(printf '%s' "$RAW" | tr '[:lower:]' '[:upper:]')"
elif [[ "$RAW" =~ /(dp|gp/product)/([A-Za-z0-9]{10}) ]]; then
  ASIN="$(printf '%s' "${BASH_REMATCH[2]}" | tr '[:lower:]' '[:upper:]')"
else
  die "ASIN を読み取れませんでした: $RAW"
fi

if [ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ]; then
  die "すでに中身があります: $DEST"
fi

mkdir -p "$DEST"
cp -R "$TEMPLATE"/. "$DEST"/
mkdir -p "$DEST/dist" "$DEST/build"

# slug は作る場所の名前から作る
SLUG="$(basename "$DEST" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]\+/-/g; s/^-//; s/-$//')"
[ -n "$SLUG" ] || SLUG="$(printf '%s' "$ASIN" | tr '[:upper:]' '[:lower:]')"

cd "$DEST"
node -e "
const fs=require('fs');
const c=JSON.parse(fs.readFileSync('project.json','utf8'));
c.product.asin='$ASIN';
c.product.slug='$SLUG';
c.compliance.allowedClaims=[];
fs.writeFileSync('project.json', JSON.stringify(c,null,2)+'\n');
" || die "project.json を書き換えられませんでした（Node は入っていますか）"

printf '\n雛形を展開しました: %s\n' "$DEST"
printf 'ASIN: %s / slug: %s\n\n' "$ASIN" "$SLUG"

# 商品ページから集める。ネットに出られないこともあるので、失敗しても止めない。
if node tools/fetch-product.js "$ASIN"; then
  FETCHED=1
else
  printf '\n商品ページを取得できませんでした。BRIEF.md は手で埋めてください。\n'
  FETCHED=0
fi

# BRIEF.md を作る
node -e "
const fs=require('fs'), path=require('path');
const asin='$ASIN';
let facts='（商品ページの取得に失敗しました。手で埋めてください）';
const pj=path.join('build',asin,'product.json');
if (fs.existsSync(pj)) {
  const d=JSON.parse(fs.readFileSync(pj,'utf8'));
  facts=[
    '- **商品名**: '+(d.title||'-'),
    '- **評価**: '+(d.rating||'-')+' '+(d.ratingCount||''),
    '- **箇条書き**:',
    ...(d.bullets||[]).map(b=>'  - '+b),
    '- **画像**: '+(d.images?d.images.count:0)+' 枚 → \`build/'+asin+'/img/\`',
    '- **A+本文**: '+(d.aplusText? d.aplusText.length+' 文字（build/'+asin+'/product.json の aplusText）':'なし')
  ].join('\n');
  const c=JSON.parse(fs.readFileSync('project.json','utf8'));
  if(!c.product.name && d.title){ c.product.name=d.title.slice(0,80); fs.writeFileSync('project.json', JSON.stringify(c,null,2)+'\n'); }
}
fs.writeFileSync('BRIEF.md', \`# 制作ブリーフ — \${asin}

工程②（構成と原稿を決める）のためのファイル。
ここを埋めてから src/video.html と tools/narration.py を書き換える。
判断の基準はスキルの references/workflow.md、実例は references/example.md。

---

## 1. 商品ページから分かったこと

\${facts}

## 2. 上位版と下位版の差

比較表を見て、この商品だけができることを書き出す。
上位版を選ぶ理由が無ければ、そこを訴求しても意味がない。

| 機能 | この商品 | 下位版・競合 |
|---|:--:|:--:|
|  |  |  |

## 3. 潰すべき購買障壁

買う直前に引っかかることを、根拠つきで4つ前後に絞る。

| 障壁 | そう考える根拠 | 動画での打ち手 | 担当シーン |
|---|---|---|---|
|  |  |  |  |
|  |  |  |  |
|  |  |  |  |
|  |  |  |  |

**評価が割れているか**（星1が2割を超えるなら「思っていたものと違った」が主因のことが多い）

- 星の分布:
- 期待値をそろえるために最後に出す仕様:

## 4. シーン構成

src/timeline.js の SCENES と tools/narration.py の LINES がこの表に対応する。

| # | 役割 | 画面で言うこと | ナレーション | 長さ |
|---|---|---|---|---|
| S1 | フック |  |  |  |
| S2 | 製品提示 |  |  |  |
| S3 |  |  |  |  |
| S4 |  |  |  |  |
| S5 |  |  |  |  |
| S6 |  |  |  |  |
| S7 |  |  |  |  |
| S8 | クロージング |  |  |  |

## 5. 使う画像

build/\${asin}/img/ から選んで src/assets/ に切り出す。
雛形の placeholder（pkg.jpg / shot_1〜4.jpg / shot_main.jpg）を置き換える。

| ファイル | 何が写っているか | 使うシーン |
|---|---|---|
|  |  |  |

## 6. 根拠が要る主張

実績や最上級を使うなら、調査主体・対象・期間を画面に出す。
ここに書いた語は project.json の compliance.allowedClaims にも入れる。

| 主張 | 注記に書く根拠 | 出すシーン |
|---|---|---|
|  |  |  |

## 7. 確認

- [ ] 価格・割引・キャンペーンを画面に入れていない
- [ ] 競合の実名を出していない
- [ ] URL・連絡先・カート誘導を入れていない
- [ ] 実績数値に注記を付けた
- [ ] 音を消しても意味が通る
- [ ] placeholder 画像を全部置き換えた
- [ ] node tools/lint-copy.js が通る
- [ ] python3 tools/narration.py --check が通る
- [ ] node tools/qa.js が通る
\`);
"

printf '\nBRIEF.md を作りました。次の順で進めます。\n\n'
printf '  cd %s\n' "$DEST"
printf '  npm install\n'
printf '  node tools/doctor.js          # 動く環境か確かめる\n'
printf '  tools/pipeline.sh build       # まず雛形のまま一度書き出してみる\n'
printf '  （BRIEF.md を埋めながら src/video.html と tools/narration.py を書き換える）\n'
printf '  tools/pipeline.sh build && tools/pipeline.sh qa\n\n'
