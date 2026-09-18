#!/usr/bin/env node
/* ============================================================
   納品前の検品。基準を外れたら 0 以外で終了する。

     node tools/qa.js                  # すべて見る
     node tools/qa.js --skip-video     # 書き出し前にレイアウトと可読性だけ見る
     node tools/qa.js --preset 16x9    # 1つの書き出しだけ見る

   見るもの:
     1. 表記      入稿先のルールに触れる文言がないか（tools/lint-copy.js）
     2. レイアウト 各シーンの中身が余白の内側に収まっているか
     3. 可読性    文字が小さすぎないか、背景とのコントラストが足りているか
     4. ページ    JS エラーが出ていないか
     5. 動画仕様  解像度・コーデック・fps・音声トラック・ファイルサイズ
     6. 音声      ラウドネスとトゥルーピーク
     7. 整合      設計どおりの尺か、映像と音声がずれていないか

   基準値は project.json の qa。入稿先が変わったらそこを直す。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');
const { ROOT, load, outputName, ffmpegPath, launchOptions } = require('./config.js');

const cfg = load();
const L = cfg.qa;
const has = n => process.argv.includes('--' + n);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };

const results = [];
const add = (area, name, ok, detail) => results.push({ area, name, ok, detail });

function ff(args) {
  // ffmpeg は -i だけの時も ebur128 の集計も stderr に書く。
  // execFileSync は成功時 stdout しか返さないので spawnSync で両方拾う。
  const r = spawnSync(ffmpegPath(), ['-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return (r.stdout || '') + (r.stderr || '');
}

function probe(file) {
  const out = ff(['-i', file]);
  const d = out.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const v = out.match(/Stream #\d+:\d+.*: Video: (\w+)[^,]*(?:\([^)]*\))?[^,]*,\s*(\w+),\s*(\d+)x(\d+)[^,]*(?:[^,]*,){0,3}[^,]*?([\d.]+) fps/);
  const a = out.match(/Stream #\d+:\d+.*: Audio: (\w+)[^,]*,\s*(\d+) Hz,\s*(\w+)/);
  return {
    duration: d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : null,
    vcodec: v && v[1], pixfmt: v && v[2], width: v && +v[3], height: v && +v[4], fps: v && parseFloat(v[5]),
    profile: (out.match(/Video: h264 \(([^)]+)\)/) || [])[1] || null,
    acodec: a && a[1], asr: a && +a[2], ach: a && a[3]
  };
}

function loudness(file) {
  const lines = ff(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']).split('\n');
  let I = null, peak = null;
  lines.forEach((l, i) => {
    const m = l.match(/^\s*I:\s*(-?[\d.]+)\s*LUFS/);
    if (m) I = parseFloat(m[1]);
    if (/True peak/.test(l)) {
      const p = (lines[i + 1] || '').match(/Peak:\s*(-?[\d.]+)\s*dBFS/);
      if (p) peak = parseFloat(p[1]);
    }
  });
  return { I, peak };
}

/* ---------- 1. 表記 ---------- */
function checkCopy() {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'lint-copy.js')],
                      { encoding: 'utf8', cwd: ROOT });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/NG (\d+) 件 \/ 要確認 (\d+) 件/);
  const ng = m ? +m[1] : (r.status === 0 ? 0 : 1);
  const warn = m ? +m[2] : 0;
  add('表記', '入稿先のルール', r.status === 0,
      ng ? `NG ${ng} 件（node tools/lint-copy.js で内容を確認）`
         : warn ? `ok（要確認 ${warn} 件。根拠の注記を見ておくこと）` : '引っかかりなし');
}

/* ---------- 2〜4. レイアウト・可読性・ページ ---------- */
const { PNG } = (() => { try { return require('pngjs'); } catch (e) { return {}; } })();

/** sRGB の相対輝度 */
function lum(r, g, b) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** 文字が乗っている背景の明るさ。
 *  背景はグラデーションや写真なので CSS からは分からない。
 *  そこで「文字だけ透明にして描いた画」を渡してもらい、その領域を測る。
 *  同じ領域を通常の画で測ると、文字自身を背景と取り違えて
 *  1.0:1 のような値になるため、必ず文字なしの画を使う。 */
function regionBgLum(png, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(png.width, Math.ceil(x1)); y1 = Math.min(png.height, Math.ceil(y1));
  if (x1 - x0 < 3 || y1 - y0 < 3) return null;
  const ls = [];
  const stepX = Math.max(1, Math.floor((x1 - x0) / 200));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 200));
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const i = (png.width * y + x) << 2;
      ls.push(lum(png.data[i], png.data[i + 1], png.data[i + 2]));
    }
  }
  if (ls.length < 12) return null;
  ls.sort((a, b) => a - b);
  return ls[Math.floor(ls.length * 0.5)];
}

/** コントラスト比。WCAG の定義。 */
function contrastRatio(a, b) {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

async function checkPage() {
  const tl = fs.readFileSync(path.join(ROOT, 'src/timeline.js'), 'utf8');
  const scenes = [...tl.matchAll(/\$\('(s\d)'\), a: ([\d.]+),\s*b: ([\d.]+)/g)]
    .map(m => ({ id: m[1], a: +m[2], b: +m[3] }));
  if (!scenes.length) { add('レイアウト', 'シーン定義の読み出し', false, 'timeline.js から SCENES を読めません'); return; }

  const browser = await chromium.launch(launchOptions());
  // 納品しないプリセット（縦型など）は作りが違うので検品の対象にしない
  const deliver = cfg.video.deliverables || Object.keys(cfg.video.presets);
  const presets = Object.entries(cfg.video.presets).filter(([k]) => deliver.includes(k));

  for (const [key, p] of presets) {
    const ctx = await browser.newContext({ viewport: { width: p.w, height: p.h }, deviceScaleFactor: 1, locale: 'ja-JP' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => { window.__CAPTURE__ = true; });
    await page.goto('file://' + path.join(ROOT, 'src', 'video.html'), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => Promise.all(
      Array.from(document.images).map(i => i.complete ? null : i.decode().catch(() => {}))));
    await page.waitForTimeout(250);

    add('ページ', `JSエラー (${key})`, errors.length === 0, errors.slice(0, 2).join(' / '));

    let worstFont = { pct: 1e9 }, worstContrast = { ratio: 1e9, floor: 1 }, overflowNg = 0, offNg = 0;

    for (const sc of scenes) {
      const t = sc.b - 0.45;
      const info = await page.evaluate(({ id, t, smallSel }) => {
        window.__video.seek(t);
        const sec = document.getElementById(id);
        const cs = getComputedStyle(sec);
        const pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom);
        const pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);

        let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9;
        sec.querySelectorAll(':scope > *').forEach(el => {
          if (el.classList.contains('bg') || el.classList.contains('grid-lines') || el.classList.contains('stripe')) return;
          const r = el.getBoundingClientRect();
          if (!r.width && !r.height) return;
          minY = Math.min(minY, r.top); maxY = Math.max(maxY, r.bottom);
          minX = Math.min(minX, r.left); maxX = Math.max(maxX, r.right);
        });

        // 実際に文字が出ている要素だけを拾う
        const texts = [];
        const isSmall = el => smallSel.some(s => el.closest(s));
        sec.querySelectorAll('*').forEach(el => {
          // 見出しは1文字ずつ span に割ってあるが、1文字ごとに測っても意味がない。
          // .ch 自体は飛ばし、その親をまとめて1つの文字要素として扱う。
          if (el.classList.contains('ch')) return;
          const own = [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim())
                   || !!el.querySelector(':scope > .ch');
          if (!own) return;
          const st = getComputedStyle(el);
          if (st.visibility === 'hidden' || +st.opacity < 0.5) return;
          const r = el.getBoundingClientRect();
          if (r.width < 8 || r.height < 6) return;
          if (r.bottom < 0 || r.top > innerHeight) return;
          // 親までさかのぼって、消えかけの要素は見ない
          let o = 1, n = el;
          while (n && n !== document.body) { o *= +getComputedStyle(n).opacity; n = n.parentElement; }
          if (o < 0.6) return;
          const rgb = (st.color.match(/[\d.]+/g) || [255, 255, 255]).map(Number);
          texts.push({
            sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''),
            px: parseFloat(st.fontSize),
            weight: parseInt(st.fontWeight, 10) || 400,
            small: isSmall(el),
            color: rgb.slice(0, 3),
            x0: r.left, y0: r.top, x1: r.right, y1: r.bottom,
            sample: (el.textContent || '').trim().slice(0, 18)
          });
        });

        return {
          over: Math.max(pt - minY, maxY - (innerHeight - pb), pl - minX, maxX - (innerWidth - pr)),
          off: Math.max(-minY, maxY - innerHeight, -minX, maxX - innerWidth),
          texts
        };
      }, { id: sc.id, t, smallSel: L.smallTextSelectors || [] });

      if (!(info.over <= L.overflowPx)) { overflowNg++; add('レイアウト', `${key} ${sc.id} 余白`, false, `${info.over.toFixed(0)}px はみ出し（上限 ${L.overflowPx}px）`); }
      if (info.off > 0) { offNg++; add('レイアウト', `${key} ${sc.id} 画面外`, false, `${info.off.toFixed(0)}px 画面外`); }

      // 文字サイズ（キャンバス高さに対する割合で見る）
      for (const tx of info.texts) {
        const pct = tx.px / p.h * 100;
        const floor = tx.small ? L.minSmallFontPctH : L.minFontPctH;
        if (pct < worstFont.pct) worstFont = { pct, floor, scene: sc.id, preset: key, ...tx };
        if (pct < floor) {
          add('可読性', `${key} ${sc.id} 文字サイズ`, false,
              `${tx.px.toFixed(0)}px = 高さの${pct.toFixed(2)}%（下限 ${floor}%）「${tx.sample}」`);
        }
      }

      // コントラスト。文字を透明にして背景だけを描いた画で測る。
      if (PNG && info.texts.length) {
        await page.addStyleTag({ content: '*{color:transparent !important;-webkit-text-fill-color:transparent !important}' });
        const bgShot = PNG.sync.read(await page.screenshot({ type: 'png' }));
        await page.evaluate(() => { const s = document.head.lastElementChild; if (s && s.tagName === 'STYLE') s.remove(); });

        for (const tx of info.texts) {
          const bg = regionBgLum(bgShot, tx.x0, tx.y0, tx.x1, tx.y1);
          if (bg === null) continue;
          const ratio = contrastRatio(lum(...tx.color), bg);
          // 大きな文字は小さな文字より低いコントラストでも読める（WCAG の考え方）
          const large = tx.px >= L.largeTextPx || (tx.px >= L.largeTextPx * 0.75 && tx.weight >= 700);
          const floor = large ? L.minContrastLarge : L.minContrast;
          if (ratio / floor < worstContrast.ratio / (worstContrast.floor || 1)) {
            worstContrast = { ratio, floor, scene: sc.id, preset: key, ...tx };
          }
          if (ratio < floor) {
            add('可読性', `${key} ${sc.id} コントラスト`, false,
                `${ratio.toFixed(1)}:1（下限 ${floor}:1・${tx.px.toFixed(0)}px）「${tx.sample}」`);
          }
        }
      }
    }

    if (!overflowNg) add('レイアウト', `${key} 余白`, true, `${scenes.length} シーンすべて内側`);
    if (!offNg) add('レイアウト', `${key} 画面外`, true, 'はみ出しなし');
    if (worstFont.pct < 1e9) {
      add('可読性', `${key} 最小文字`, worstFont.pct >= worstFont.floor,
          `${worstFont.px.toFixed(0)}px = 高さの${worstFont.pct.toFixed(2)}%  ${worstFont.scene} ${worstFont.sel}`);
    }
    if (worstContrast.ratio < 1e9) {
      add('可読性', `${key} 最小コントラスト`, worstContrast.ratio >= worstContrast.floor,
          `${worstContrast.ratio.toFixed(1)}:1（下限 ${worstContrast.floor}:1）  ${worstContrast.scene} ${worstContrast.sel}`);
    } else if (!PNG) {
      add('可読性', `${key} コントラスト`, true, '未計測（npm install pngjs で計測できます）');
    }

    await ctx.close();
  }
  await browser.close();
}

/* ---------- 5〜7. 動画・音声・整合 ---------- */
function checkVideo(file) {
  const name = path.basename(file);
  if (!fs.existsSync(file)) { add('動画', name, false, '書き出されていません'); return; }
  const p = probe(file);
  const mb = fs.statSync(file).size / 1024 / 1024;

  add('動画', `${name} 解像度`, p.height >= L.minHeight, `${p.width}x${p.height}`);
  add('動画', `${name} コーデック`, p.vcodec === 'h264' && p.pixfmt === 'yuv420p', `${p.vcodec} / ${p.pixfmt} / ${p.profile}`);
  add('動画', `${name} fps`, p.fps >= L.minFps, `${p.fps} fps`);
  add('動画', `${name} 音声トラック`, !!p.acodec, p.acodec ? `${p.acodec} ${p.asr}Hz ${p.ach}` : 'なし');
  add('動画', `${name} サイズ`, mb <= L.maxFileMB, `${mb.toFixed(1)} MB（上限 ${L.maxFileMB}MB）`);

  const l = loudness(file);
  if (p.acodec) {
    add('音声', `${name} ラウドネス`, l.I !== null && l.I >= L.lufs[0] && l.I <= L.lufs[1],
        l.I === null ? '測れません' : `${l.I.toFixed(1)} LUFS（目標 ${L.lufs[0]}〜${L.lufs[1]}）`);
    add('音声', `${name} トゥルーピーク`, l.peak !== null && l.peak <= L.truePeakMax,
        l.peak === null ? '測れません' : `${l.peak.toFixed(1)} dBFS（上限 ${L.truePeakMax}）`);
  }

  const tl = fs.readFileSync(path.join(ROOT, 'src/timeline.js'), 'utf8');
  const dur = parseFloat((tl.match(/var DUR = ([\d.]+);/) || [])[1]);
  if (dur && p.duration) {
    add('整合', `${name} 尺`, Math.abs(p.duration - dur) <= 0.2,
        `動画 ${p.duration.toFixed(2)}s / 設計 ${dur.toFixed(2)}s`);
  }
  const nar = path.join(ROOT, 'dist/narration.m4a');
  if (fs.existsSync(nar)) {
    const np = probe(nar);
    add('整合', `${name} 映像と音声の尺`, Math.abs(np.duration - p.duration) <= L.avSkewSec,
        `差 ${Math.abs(np.duration - p.duration).toFixed(2)}s`);
  }
}

(async () => {
  console.log(`検品: ${cfg.product.name || cfg.product.slug}\n`);
  checkCopy();
  await checkPage();

  if (!has('skip-video')) {
    const only = arg('preset', null);
    const deliver = cfg.video.deliverables || Object.keys(cfg.video.presets);
    const files = (only ? [only] : deliver)
      .map(k => path.join(ROOT, 'dist', outputName(cfg, k)))
      .filter(f => fs.existsSync(f) || !only);
    const existing = files.filter(f => fs.existsSync(f));
    if (!existing.length) add('動画', '書き出し', false, 'dist/ に mp4 がありません。node tools/render.js を先に実行してください');
    existing.forEach(checkVideo);
  }

  let area = null, ng = 0;
  for (const r of results) {
    if (r.area !== area) { area = r.area; console.log(`[${area}]`); }
    if (!r.ok) ng++;
    console.log(`  ${r.ok ? 'ok  ' : 'NG  '}${r.name.padEnd(36)} ${r.detail || ''}`);
  }
  console.log(`\n${results.length} 項目中 ${results.length - ng} 件 ok`);
  if (ng) { console.log(`${ng} 件が基準を外れています。`); process.exit(1); }
  console.log('納品して問題ありません。');
})().catch(e => { console.error(e); process.exit(1); });
