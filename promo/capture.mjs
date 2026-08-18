/**
 * promo.html を 1920x1080 で開き、SEEK(t) を進めながら 1 フレームずつ PNG に書き出す。
 *
 *   node capture.mjs              … 全フレーム
 *   node capture.mjs --preview    … 各シーンの代表カットだけ work/preview/ に出す
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const WORK = path.join(HERE, 'work');
const TL = JSON.parse(fs.readFileSync(path.join(WORK, 'timeline.json'), 'utf8'));
const preview = process.argv.includes('--preview');
const OUT = path.join(WORK, preview ? 'preview' : 'frames');

fs.mkdirSync(OUT, { recursive: true });
if (!preview) {
  for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));
}

const browser = await chromium.launch({
  args: ['--no-sandbox', '--force-device-scale-factor=1', '--font-render-hinting=none',
         '--disable-lcd-text', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript(() => { window.__CAPTURE__ = true; });
await page.goto('file://' + path.join(HERE, 'promo.html'));
await page.evaluate(() => document.fonts.ready);
// 画像の読み込み完了を待つ
await page.waitForFunction(() => Array.from(document.images).every(i => i.complete && i.naturalWidth > 0),
  null, { timeout: 120000 });
const info = await page.evaluate((tl) => window.INIT(tl), TL);
console.log('timeline', JSON.stringify(info.scenes));

const fps = TL.fps;
const total = TL.total;

if (preview) {
  const marks = [];
  for (const [k, [a, b]] of Object.entries(info.scenes)) {
    marks.push([k, a + (b - a) * 0.35], [k + 'b', a + (b - a) * 0.75]);
  }
  for (const [name, t] of marks) {
    await page.evaluate((tt) => window.SEEK(tt), t);
    await page.screenshot({ path: path.join(OUT, `${name}_${t.toFixed(2)}.png`) });
  }
  console.log('preview frames:', marks.length);
} else {
  const n = Math.round(total * fps);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    await page.evaluate((tt) => window.SEEK(tt), t);
    await page.screenshot({
      path: path.join(OUT, 'f' + String(i).padStart(5, '0') + '.jpg'),
      type: 'jpeg', quality: 96, animations: 'disabled',
    });
    if (i % 60 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`frame ${i}/${n}  ${el.toFixed(1)}s elapsed`);
    }
  }
  console.log(`done ${n} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

await browser.close();
