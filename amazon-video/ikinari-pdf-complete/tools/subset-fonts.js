#!/usr/bin/env node
/* ============================================================
   src/video.html と src/timeline.js で実際に使っている文字だけを
   集めて、Noto Sans JP のサブセット woff2 を取り直す。
   文言に新しい漢字を足したら、これを実行しないと豆腐になる。

     node tools/subset-fonts.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT     = path.resolve(__dirname, '..');
const SRC      = path.join(ROOT, 'src');
const FONT_DIR = path.join(SRC, 'fonts');
const WEIGHTS  = [400, 500, 700, 900];
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/* 常に入れておく文字（記号・英数字） */
const ALWAYS =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~' +
  '※／・〜〔〕「」『』（）【】←→↑↓●○◯■□★☆＋－×÷＝％￥…‥、。›‹➜';

function collect() {
  const html = fs.readFileSync(path.join(SRC, 'video.html'), 'utf8');
  const js   = fs.readFileSync(path.join(SRC, 'timeline.js'), 'utf8');

  // HTML: タグと script/style を落として本文だけ
  let body = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '');
  body = body.replace(/<[^>]+>/g, '\n');
  body = body.replace(/&[a-z]+;|&#\d+;/gi, ' ');

  // JS: 文字列リテラル（注記やラベル）
  const lits = (js.match(/'[^'\\\n]*'/g) || []).concat(js.match(/"[^"\\\n]*"/g) || []).join('');

  const set = new Set((body + lits + ALWAYS).split(''));
  return [...set].filter(c => c.trim() && c.codePointAt(0) > 31).sort().join('');
}

function get(url) {
  return new Promise((res, rej) => {
    const opts = { headers: { 'User-Agent': UA } };
    https.get(url, opts, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume(); return get(r.headers.location).then(res, rej);
      }
      if (r.statusCode !== 200) { r.resume(); return rej(new Error(url + ' -> HTTP ' + r.statusCode)); }
      const bufs = []; r.on('data', b => bufs.push(b)); r.on('end', () => res(Buffer.concat(bufs)));
    }).on('error', rej);
  });
}

(async () => {
  const text = collect();
  console.log('使用文字数:', text.length);
  fs.mkdirSync(FONT_DIR, { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'subset-chars.txt'), text);

  for (const w of WEIGHTS) {
    const cssUrl = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@' + w +
                   '&text=' + encodeURIComponent(text);
    const css = (await get(cssUrl)).toString('utf8');
    const m = css.match(/src:\s*url\((https:\/\/[^)]+)\)/);
    if (!m) throw new Error('weight ' + w + ': woff2 の URL が取れませんでした');
    const buf = await get(m[1]);
    const out = path.join(FONT_DIR, 'NotoSansJP-' + w + '.woff2');
    fs.writeFileSync(out, buf);
    console.log('  ' + path.basename(out), buf.length, 'bytes');
  }
  console.log('完了。src/fonts/ を更新しました。');
})().catch(e => { console.error(e.message); process.exit(1); });
