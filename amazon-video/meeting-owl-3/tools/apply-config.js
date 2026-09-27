#!/usr/bin/env node
/* ============================================================
   project.json から、ブラウザ側が読むファイルを書き出す。

     node tools/apply-config.js

   書き出すもの:
     src/theme.css   配色のカスタムプロパティ（:root）
     src/meta.json   商品名などを図版やドキュメントから参照するため

   video.html は theme.css を styles.css より先に読む。
   色を変えたいときは project.json を直してこれを実行する。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, load } = require('./config.js');

const cfg = load();

/* ---------- src/theme.css ---------- */
const colors = cfg.theme.colors || {};
const names = Object.keys(colors);
if (!names.length) {
  console.error('project.json の theme.colors が空です。色を1つ以上定義してください。');
  process.exit(1);
}
const pad = Math.max(...names.map(n => n.length));
const vars = names.map(n => `  --${n}:${' '.repeat(pad - n.length + 1)}${colors[n]};`).join('\n');

fs.writeFileSync(path.join(ROOT, 'src', 'theme.css'),
`/* project.json の theme.colors から生成。直接編集しないこと。
   作り直す: node tools/apply-config.js */
:root{
${vars}
}
`);

/* ---------- src/meta.json ---------- */
fs.writeFileSync(path.join(ROOT, 'src', 'meta.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    product: cfg.product,
    fontFamily: cfg.theme.font.family
  }, null, 2) + '\n');

console.log(`src/theme.css   ${names.length} 色`);
console.log(`src/meta.json   ${cfg.product.name || cfg.product.slug}`);
