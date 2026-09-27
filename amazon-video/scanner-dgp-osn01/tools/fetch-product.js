#!/usr/bin/env node
/* ============================================================
   Amazon の商品ページから、動画制作に必要な素材と情報を集める。

     node tools/fetch-product.js B0FVFTZSM7
     node tools/fetch-product.js "https://www.amazon.co.jp/dp/B0FVFTZSM7"
     node tools/fetch-product.js B0FVFTZSM7 --out build/B0FVFTZSM7

   書き出すもの:
     <out>/product.json   タイトル・箇条書き・A+本文・評価・比較表のテキスト
     <out>/page.html      取得した生HTML（あとから読み直せるように）
     <out>/img/main_*.jpg 商品画像（高解像度）
     <out>/img/aplus_*.jpg A+（商品紹介）の画像

   注意:
   - Amazon はレビュー本文にログインを要求するので、本文は取れない。
     星の分布と件数までは商品ページから取れる。
   - 価格は配送先で表示が変わるうえ、動画には入れない方針なので取得しない。
   - 続けて何度も叩くと Amazon がボット検知の中間ページを返す。
     その場合は Playwright で実際に描画して取り直す（--no-browser で無効化）。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/** 引数は ASIN でも商品URLでも受ける */
function toAsin(input) {
  if (!input) return null;
  if (/^[A-Z0-9]{10}$/i.test(input)) return input.toUpperCase();
  const m = input.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}

/** ボット検知の中間ページかどうか。本文が極端に短く、商品情報が無い。 */
function isInterstitial(html) {
  if (html.length > 200000) return false;
  return /ショッピングを続ける|Continue shopping|api-services-support|captcha|Robot Check/i.test(html)
      && !/id="productTitle"/.test(html);
}

/** 素の取得で弾かれたときに、実際にブラウザで描画して取り直す。 */
async function getViaBrowser(url) {
  let chromium, launchOptions;
  try {
    ({ chromium } = require('playwright'));
    ({ launchOptions } = require('./config.js'));
  } catch (e) {
    throw new Error('playwright が入っていないのでブラウザ経由で取得できません（npm install）');
  }
  const browser = await chromium.launch(launchOptions());
  try {
    const ctx = await browser.newContext({
      locale: 'ja-JP', timezoneId: 'Asia/Tokyo', userAgent: UA,
      extraHTTPHeaders: { 'Accept-Language': 'ja-JP,ja;q=0.9' },
      viewport: { width: 1440, height: 1000 }
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    // 中間ページなら「ショッピングを続ける」を押して商品ページへ進む
    const go = await page.$('button[alt="ショッピングを続ける"], input[type="submit"], a.a-button-text, button');
    if (!(await page.$('#productTitle')) && go) {
      await go.click().catch(() => {});
      await page.waitForTimeout(2500);
    }
    // A+ は下にスクロールしないと入ってこないことがある
    for (let i = 0; i < 18; i++) { await page.mouse.wheel(0, 1400); await page.waitForTimeout(220); }
    await page.waitForTimeout(1200);
    return await page.content();
  } finally {
    await browser.close();
  }
}

function get(url, redirects = 0) {
  return new Promise((res, rej) => {
    if (redirects > 5) return rej(new Error('リダイレクトが多すぎます'));
    const u = new URL(url);
    const opts = {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'ja-JP,ja;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cookie': 'i18n-prefs=JPY; lc-acbjp=ja_JP'
      }
    };
    https.get(u, opts, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume();
        return get(new URL(r.headers.location, u).toString(), redirects + 1).then(res, rej);
      }
      if (r.statusCode !== 200) {
        r.resume();
        return rej(new Error(`HTTP ${r.statusCode} : ${url}`));
      }
      const bufs = [];
      r.on('data', b => bufs.push(b));
      r.on('end', () => {
        // Amazon は gzip / br で返してくる。Node は自動展開しないので自分でほどく。
        const raw = Buffer.concat(bufs);
        const enc = (r.headers['content-encoding'] || '').toLowerCase();
        const done = (e, out) => e ? rej(e) : res(out);
        if (enc === 'gzip') return zlib.gunzip(raw, done);
        if (enc === 'deflate') return zlib.inflate(raw, done);
        if (enc === 'br') return zlib.brotliDecompress(raw, done);
        res(raw);
      });
    }).on('error', rej);
  });
}

/* ---------- HTML からテキストを取り出す ---------- */
const stripTags = h => h
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
  .replace(/<[^>]+>/g, '');

const unescapeHtml = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

const clean = h => unescapeHtml(stripTags(h))
  .split('\n').map(l => l.replace(/[ \t　]+/g, ' ').trim()).filter(Boolean).join('\n');

function section(html, id) {
  const i = html.indexOf(`id="${id}"`);
  if (i < 0) return null;
  return html.slice(i, i + 200000);
}

function parse(html) {
  const out = {};

  const title = html.match(/id="productTitle"[^>]*>([\s\S]*?)<\/span>/);
  out.title = title ? clean(title[1]) : null;

  const brand = html.match(/id="bylineInfo"[^>]*>([\s\S]*?)<\/a>/);
  out.brand = brand ? clean(brand[1]) : null;

  // 箇条書き
  out.bullets = [];
  const fb = section(html, 'feature-bullets');
  if (fb) {
    const block = fb.slice(0, fb.indexOf('</ul>') + 5);
    for (const m of block.matchAll(/<span class="a-list-item[^"]*">([\s\S]*?)<\/span>/g)) {
      const t = clean(m[1]).replace(/\n/g, ' ').trim();
      if (t) out.bullets.push(t);
    }
  }

  // 評価
  const rating = html.match(/id="acrPopover"[^>]*title="([^"]+)"/);
  out.rating = rating ? rating[1] : null;
  const count = html.match(/id="acrCustomerReviewText"[^>]*>([^<]+)</);
  out.ratingCount = count ? count[1].trim() : null;

  // A+（商品紹介）の本文。ページ内に素で入っているので、その範囲をまとめて拾う
  const a1 = html.indexOf('aplus-v2');
  const a2 = html.lastIndexOf('aplus');
  out.aplusText = a1 > -1 && a2 > a1 ? clean(html.slice(a1, a2)) : null;

  // 画像
  out.mainImages = [...new Set([...html.matchAll(/"hiRes"\s*:\s*"([^"]+)"/g)].map(m => m[1]))];
  out.aplusImages = [...new Set(
    [...html.matchAll(/https:\/\/m\.media-amazon\.com\/images\/S\/aplus-media-library-service-media\/[^"' ]+\.jpg/g)]
      .map(m => m[0]))];

  // 対応OSなどの仕様
  const det = section(html, 'detailBullets_feature_div') || section(html, 'productDetails_techSpec_section_1');
  out.details = det ? clean(det.slice(0, det.indexOf('</table>') + 8 || 8000)).split('\n').slice(0, 40) : [];

  return out;
}

(async () => {
  const asin = toAsin(process.argv[2]);
  if (!asin) {
    console.error('使い方: node tools/fetch-product.js <ASIN または 商品URL> [--out build/<ASIN>]');
    process.exit(1);
  }
  const outDir = path.resolve(__dirname, '..', arg('out', path.join('build', asin)));
  const imgDir = path.join(outDir, 'img');
  fs.mkdirSync(imgDir, { recursive: true });

  const host = (require('./config.js').load().product.marketplace) || 'amazon.co.jp';
  const url = `https://www.${host}/dp/${asin}?language=ja_JP&th=1`;
  process.stdout.write(`取得中: ${url}\n`);
  let html = (await get(url)).toString('utf8');

  // 何度も叩くとボット検知の中間ページが返る。実ブラウザで取り直す。
  if ((isInterstitial(html) || !/id="productTitle"/.test(html)) && !process.argv.includes('--no-browser')) {
    process.stdout.write('  素の取得では商品情報が取れませんでした。ブラウザで取り直します…\n');
    try {
      html = await getViaBrowser(url);
    } catch (e) {
      process.stdout.write(`  ブラウザでの取得も失敗しました: ${e.message}\n`);
    }
  }
  fs.writeFileSync(path.join(outDir, 'page.html'), html);

  const data = parse(html);
  data.asin = asin;
  data.url = `https://www.amazon.co.jp/dp/${asin}`;
  data.fetchedAt = new Date().toISOString();

  if (!data.title) {
    console.error('商品タイトルが取れませんでした。');
    if (isInterstitial(html)) {
      console.error('Amazon のボット検知に当たっています。短時間に何度も取得すると出ます。');
      console.error('数分おいて再試行してください。');
    } else {
      console.error('ページの作りが想定と違う可能性があります。');
    }
    console.error(`取得した HTML: ${path.join(outDir, 'page.html')}`);
    process.exit(1);
  }

  // 画像を落とす
  const jobs = [];
  data.mainImages.forEach((u, i) => jobs.push(['main_' + String(i).padStart(2, '0'), u]));
  data.aplusImages.forEach((u, i) => jobs.push(['aplus_' + String(i).padStart(2, '0'), u]));
  let okCount = 0;
  for (const [name, u] of jobs) {
    try {
      fs.writeFileSync(path.join(imgDir, name + '.jpg'), await get(u));
      okCount++;
    } catch (e) {
      console.warn(`  画像を落とせませんでした: ${name}  (${e.message})`);
    }
  }

  data.images = { dir: path.relative(path.resolve(__dirname, '..'), imgDir), count: okCount };
  fs.writeFileSync(path.join(outDir, 'product.json'), JSON.stringify(data, null, 2));

  console.log(`\n商品名   : ${data.title}`);
  console.log(`評価     : ${data.rating || '-'}  ${data.ratingCount || ''}`);
  console.log(`箇条書き : ${data.bullets.length} 件`);
  console.log(`A+本文   : ${data.aplusText ? data.aplusText.length + ' 文字' : 'なし'}`);
  console.log(`画像     : ${okCount} 枚  → ${data.images.dir}`);
  console.log(`\n書き出し: ${path.join(outDir, 'product.json')}`);
  console.log('\n次は product.json と画像を読んで、src/video.html の文言と');
  console.log('src/assets/ の画像を差し替えます（判断が要る工程 / docs/WORKFLOW.md 参照）。');
})().catch(e => { console.error(e.message); process.exit(1); });
