#!/usr/bin/env node
/* ============================================================
   docs/diagrams/*.html を PNG に書き出す。

     node tools/render-diagrams.js
     node tools/render-diagrams.js workflow      # 1枚だけ

   HTML が原本なので、図を直すときは HTML を編集して撮り直す。
   文言に新しい漢字を足したら、先にフォントを作り直すこと:
     node tools/subset-fonts.js --diagrams
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'docs', 'diagrams');
const OUT = path.join(ROOT, 'docs');

function chromePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const p = '/opt/pw-browsers/chromium';
  return fs.existsSync(p) ? p : undefined;
}

(async () => {
  const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const files = fs.readdirSync(DIR)
    .filter(f => f.endsWith('.html'))
    .filter(f => !only.length || only.includes(path.basename(f, '.html')));
  if (!files.length) { console.error('対象の HTML がありません'); process.exit(1); }

  const launch = { args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'] };
  const exe = chromePath();
  if (exe) launch.executablePath = exe;
  const browser = await chromium.launch(launch);
  // 図は等倍だと文字が甘くなるので2倍で撮る
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2, locale: 'ja-JP' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  for (const f of files) {
    await page.goto('file://' + path.join(DIR, f), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);

    const miss = await page.evaluate(async () => {
      // サブセットに無い文字はフォールバックで描かれる。幅の差で拾えるので数えておく。
      const text = document.body.innerText.replace(/\s/g, '');
      const cv = document.createElement('canvas').getContext('2d');
      const bad = new Set();
      for (const ch of new Set(text)) {
        cv.font = '40px "Noto Sans JP"';
        const a = cv.measureText(ch).width;
        cv.font = '40px sans-serif';
        const b = cv.measureText(ch).width;
        if (a === b && !/[\x20-\x7E]/.test(ch)) bad.add(ch);
      }
      return [...bad].join('');
    });

    const el = await page.$('#board');
    const out = path.join(OUT, path.basename(f, '.html') + '.png');
    await el.screenshot({ path: out, type: 'png' });
    const box = await el.boundingBox();
    console.log(`${path.basename(out)}  ${Math.round(box.width)}x${Math.round(box.height)} (2x)  ` +
                `${(fs.statSync(out).size / 1024).toFixed(0)} KB` +
                (miss ? `  ※フォントに無いかもしれない文字: ${miss}` : ''));
  }

  if (errors.length) console.error('ページ内エラー:\n' + errors.join('\n'));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
