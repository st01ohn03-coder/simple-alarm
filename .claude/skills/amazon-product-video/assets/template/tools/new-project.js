#!/usr/bin/env node
/* ============================================================
   別の商品の動画プロジェクトを、このプロジェクトを型にして作る。

     node tools/new-project.js B0XXXXXXXX --dir ../my-product
     node tools/new-project.js B0XXXXXXXX --dir ../my-product --name "商品名" --brand "ブランド"

   作られるもの:
     <dir>/                エンジン一式（src の仕組み・tools・図版・ドキュメント）
     <dir>/project.json    新しい ASIN と slug が入った設定
     <dir>/BRIEF.md        構成を決めるための問いが並んだ下書き
     <dir>/build/<ASIN>/   商品ページから集めた素材と情報

   コピーしないもの:
     dist/（書き出し）、src/assets/（前の商品の画像）、build/（前の商品の調査結果）

   src/video.html と tools/narration.py の原稿は前の商品のまま入る。
   これは「形の見本」で、BRIEF.md を埋めながら書き換えることを前提にしている。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT } = require('./config.js');

function arg(n, d) { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; }

const input = process.argv[2];
const asin = input && (/^[A-Z0-9]{10}$/i.test(input) ? input.toUpperCase()
  : (input.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i) || [])[1]);
if (!asin) {
  console.error('使い方: node tools/new-project.js <ASIN または 商品URL> --dir <作る場所>');
  process.exit(1);
}

const destRel = arg('dir', path.join('..', asin.toLowerCase()));
const dest = path.resolve(ROOT, destRel);
if (fs.existsSync(dest) && fs.readdirSync(dest).length) {
  console.error(`すでに中身があります: ${dest}`);
  console.error('空のディレクトリか、まだ無い場所を指定してください。');
  process.exit(1);
}

/* ---------- コピー ---------- */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git']);
const SKIP_PATHS = new Set(['src/assets', 'docs/workflow.png', 'docs/roles.png', 'BRIEF.md']);

function copy(from, to, rel = '') {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (SKIP_DIRS.has(e.name) || SKIP_PATHS.has(r)) continue;
    const src = path.join(from, e.name), dst = path.join(to, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) copy(src, dst, r);
    else fs.copyFileSync(src, dst);
  }
}
copy(ROOT, dest);
fs.mkdirSync(path.join(dest, 'src', 'assets'), { recursive: true });
fs.mkdirSync(path.join(dest, 'dist'), { recursive: true });

/* ---------- project.json を書き換え ---------- */
const cfgFile = path.join(dest, 'project.json');
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const slug = arg('slug', path.basename(dest).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')) || asin.toLowerCase();
cfg.product = {
  asin,
  slug,
  name: arg('name', ''),
  brand: arg('brand', ''),
  marketplace: cfg.product.marketplace,
  locale: cfg.product.locale
};
cfg.compliance.allowedClaims = [];      // 前の商品の根拠を引き継がない
fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');

/* ---------- 商品ページから集める ---------- */
console.log(`型として ${path.basename(ROOT)} を複製しました → ${destRel}\n`);
const r = spawnSync(process.execPath, [path.join(dest, 'tools', 'fetch-product.js'), asin],
                    { cwd: dest, stdio: 'inherit' });

/* ---------- BRIEF.md ---------- */
let facts = '（商品ページの取得に失敗しました。手で埋めてください）';
const pj = path.join(dest, 'build', asin, 'product.json');
if (fs.existsSync(pj)) {
  const d = JSON.parse(fs.readFileSync(pj, 'utf8'));
  facts = [
    `- **商品名**: ${d.title || '-'}`,
    `- **評価**: ${d.rating || '-'} ${d.ratingCount || ''}`,
    `- **箇条書き**:`,
    ...(d.bullets || []).map(b => `  - ${b}`),
    `- **画像**: ${d.images ? d.images.count : 0} 枚 → \`build/${asin}/img/\``,
    `- **A+本文**: ${d.aplusText ? d.aplusText.length + ' 文字（build/' + asin + '/product.json の aplusText）' : 'なし'}`
  ].join('\n');
  if (!cfg.product.name && d.title) {
    cfg.product.name = d.title.slice(0, 80);
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
  }
}

fs.writeFileSync(path.join(dest, 'BRIEF.md'), `# 制作ブリーフ — ${asin}

このファイルは工程②（構成と原稿を決める）のためのもの。
ここを埋めてから \`src/video.html\` と \`tools/narration.py\` を書き換える。
判断の基準は \`docs/WORKFLOW.md\` の②にある。

---

## 1. 商品ページから分かったこと

${facts}

## 2. 上位版と下位版の差

比較表を見て、この商品だけができることを書き出す。
上位版を選ぶ理由が無ければ、そこを訴求しても意味がない。

| 機能 | この商品 | 下位版・競合 |
|---|:--:|:--:|
|  |  |  |

## 3. 潰すべき購買障壁

見込み客が買う直前に引っかかることを、根拠つきで4つ前後に絞る。
指名検索で来る商品は、認知ではなく「買う直前の引っかかり」を外すのが動画の仕事。

| 障壁 | そう考える根拠 | 動画での打ち手 | 担当シーン |
|---|---|---|---|
|  |  |  |  |
|  |  |  |  |
|  |  |  |  |
|  |  |  |  |

**評価が割れているか**（星1が2割を超えるなら「思っていたものと違った」が主因のことが多い）

- 星の分布:
- 期待値をそろえるために、最後に出す仕様:

## 4. シーン構成

\`src/timeline.js\` の \`SCENES\` と \`tools/narration.py\` の \`LINES\` がこの表に対応する。

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

\`build/${asin}/img/\` から選んで \`src/assets/\` に切り出す。

| ファイル | 何が写っているか | 使うシーン |
|---|---|---|
|  |  |  |

## 6. 根拠が要る主張

実績や最上級の表現を使うなら、調査主体・対象・期間を画面に出す。
ここに書いた語は \`project.json\` の \`compliance.allowedClaims\` にも入れる。

| 主張 | 注記に書く根拠 | 出すシーン |
|---|---|---|
|  |  |  |

## 7. 確認

- [ ] 価格・割引・キャンペーンを画面に入れていない
- [ ] 競合の実名を出していない
- [ ] URL・連絡先・カート誘導を入れていない
- [ ] 実績数値に注記を付けた
- [ ] 音を消しても意味が通る
- [ ] \`node tools/lint-copy.js\` が通る
- [ ] \`python3 tools/narration.py --check\` が通る
- [ ] \`node tools/qa.js\` が通る
`);

console.log(`\n作成しました: ${destRel}`);
console.log('\n次の順で進めます。');
console.log(`  cd ${destRel}`);
console.log('  npm install && node tools/doctor.js     # 動く環境か確かめる');
console.log('  （BRIEF.md を埋めながら src/video.html と tools/narration.py を書き換える）');
console.log('  tools/pipeline.sh build && tools/pipeline.sh qa');
process.exit(r.status === 0 ? 0 : 0);
