#!/usr/bin/env node
/* ============================================================
   指定したファイルで実際に使っている文字だけを集めて、
   Noto Sans JP のサブセット woff2 を取り直す。
   文言に新しい漢字を足したら、これを実行しないと豆腐になる。

     node tools/subset-fonts.js            # 動画本編 → src/fonts/
     node tools/subset-fonts.js --diagrams # 図版     → docs/diagrams/fonts/
     node tools/subset-fonts.js --sources src/video.html --out src/fonts
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT    = path.resolve(__dirname, '..');
const WEIGHTS = [400, 500, 700, 900];

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

// 既定は動画本編。--diagrams なら図版用。--sources / --out で任意に指定できる。
const DIAGRAMS = process.argv.includes('--diagrams');
const SOURCES = arg('sources',
  DIAGRAMS ? 'docs/diagrams/workflow.html,docs/diagrams/roles.html,docs/diagrams/style.css'
           : 'src/video.html,src/timeline.js'
).split(',').map(f => path.resolve(ROOT, f.trim()));
const FONT_DIR = path.resolve(ROOT, arg('out', DIAGRAMS ? 'docs/diagrams/fonts' : 'src/fonts'));
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/* 常に入れておく文字（記号・英数字） */
const ALWAYS =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~' +
  '※／・〜〔〕「」『』（）【】←→↑↓●○◯■□★☆＋－×÷＝％￥…‥、。›‹➜';

function collect() {
  let text = ALWAYS;
  for (const file of SOURCES) {
    if (!fs.existsSync(file)) { console.warn('  見つかりません（飛ばします）: ' + file); continue; }
    const raw = fs.readFileSync(file, 'utf8');
    if (/\.html?$/i.test(file)) {
      // HTML: タグと script/style を落として本文だけ。
      // ただし content: '…' など CSS 側の文字も拾いたいので style は文字列だけ残す。
      const styles = (raw.match(/<style\b[^>]*>([\s\S]*?)<\/style>/g) || []).join('');
      let body = raw.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '');
      body = body.replace(/<[^>]+>/g, '\n').replace(/&[a-z]+;|&#\d+;/gi, ' ');
      text += body + quoted(styles);
    } else {
      // JS / CSS: 文字列リテラル（注記やラベル、content の値）
      text += quoted(raw);
    }
  }
  const set = new Set(text.split(''));
  return [...set].filter(c => c.trim() && c.codePointAt(0) > 31).sort().join('');
}

/** ソース中のクォートで囲まれた文字列をすべて連結して返す */
function quoted(src) {
  return (src.match(/'[^'\\\n]*'/g) || [])
    .concat(src.match(/"[^"\\\n]*"/g) || [])
    .join('');
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
  console.log(`対象: ${SOURCES.map(f => path.relative(ROOT, f)).join(', ')}`);
  console.log('使用文字数:', text.length);
  fs.mkdirSync(FONT_DIR, { recursive: true });
  fs.writeFileSync(path.join(FONT_DIR, 'subset-chars.txt'), text);

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
  writeFontCss();
  console.log(`完了。${path.relative(ROOT, FONT_DIR)}/ を更新しました。`);
})().catch(e => { console.error(e.message); process.exit(1); });

/** @font-face を書き出す（フォントと同じ場所に置く） */
function writeFontCss() {
  const faces = WEIGHTS.map(w => `@font-face{
  font-family:'Noto Sans JP'; font-style:normal; font-weight:${w};
  src:url('NotoSansJP-${w}.woff2') format('woff2'); font-display:block;
}`).join('\n');
  fs.writeFileSync(path.join(FONT_DIR, 'fonts.css'),
`/* Noto Sans JP (SIL Open Font License 1.1)
   ここで使う文字だけをサブセット化した woff2。
   再生成: node tools/subset-fonts.js${DIAGRAMS ? ' --diagrams' : ''} */
${faces}
`);
}
