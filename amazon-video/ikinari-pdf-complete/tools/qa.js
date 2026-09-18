#!/usr/bin/env node
/* ============================================================
   納品前の検品。落ちたら 0 以外で終了する。

     node tools/qa.js                       # 既定の2本を見る
     node tools/qa.js --preset 16x9
     node tools/qa.js --skip-video          # レイアウトだけ見る（書き出し前）

   見るもの:
     1. レイアウト  各シーンの中身が余白の内側に収まっているか（16:9 と 1:1）
     2. ページ      video.html に JS エラーが出ていないか
     3. 動画仕様    解像度・fps・コーデック・音声の有無・尺
     4. 音声        ラウドネス(-16 LUFS 目標)とトゥルーピーク
     5. 整合        映像の尺と音声の尺がずれていないか
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const has = n => process.argv.includes('--' + n);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };

/* 動画に許す幅 */
const LIMITS = {
  overflowPx: 40,        // 余白からのはみ出し（拡大演出ぶんを見込む）
  lufs: [-17.0, -15.0],  // 統合ラウドネス
  truePeakMax: -1.0,     // トゥルーピーク上限 dBFS
  avSkewSec: 0.15,       // 映像と音声の尺の差
  minFps: 23.976,
  minHeight: 720
};

const results = [];
const add = (area, name, ok, detail) => results.push({ area, name, ok, detail });

function ffmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const p = path.join(ROOT, 'node_modules/@ffmpeg-installer/linux-x64/ffmpeg');
  return fs.existsSync(p) ? p : 'ffmpeg';
}
function chromePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const p = '/opt/pw-browsers/chromium';
  return fs.existsSync(p) ? p : undefined;
}
function ff(args) {
  // ffmpeg は -i だけの時も ebur128 の集計も stderr に書く。
  // execFileSync は成功時 stdout しか返さないので spawnSync で両方拾う。
  const r = spawnSync(ffmpeg(), ['-hide_banner', ...args],
                      { encoding: 'utf8', maxBuffer: 1 << 28 });
  return (r.stdout || '') + (r.stderr || '');
}
function probe(file) {
  const out = ff(['-i', file]);
  const d = out.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const v = out.match(/Stream #\d+:\d+.*: Video: (\w+)[^,]*(?:\([^)]*\))?[^,]*,\s*(\w+),\s*(\d+)x(\d+)[^,]*(?:[^,]*,){0,3}[^,]*?([\d.]+) fps/);
  const a = out.match(/Stream #\d+:\d+.*: Audio: (\w+)[^,]*,\s*(\d+) Hz,\s*(\w+)/);
  return {
    duration: d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : null,
    vcodec: v && v[1], pixfmt: v && v[2],
    width: v && +v[3], height: v && +v[4], fps: v && parseFloat(v[5]),
    profile: (out.match(/Video: h264 \(([^)]+)\)/) || [])[1] || null,
    acodec: a && a[1], asr: a && +a[2], ach: a && a[3],
    raw: out
  };
}
function loudness(file) {
  const out = ff(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const lines = out.split('\n');
  let I = null, peak = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*I:\s*(-?[\d.]+)\s*LUFS/);
    if (m) I = parseFloat(m[1]);
    if (/True peak/.test(lines[i])) {
      const p = (lines[i + 1] || '').match(/Peak:\s*(-?[\d.]+)\s*dBFS/);
      if (p) peak = parseFloat(p[1]);
    }
  }
  return { I, peak };
}

/* ---------- 1. レイアウト ---------- */
async function checkLayout() {
  const tl = fs.readFileSync(path.join(ROOT, 'src/timeline.js'), 'utf8');
  const scenes = [...tl.matchAll(/\$\('(s\d)'\), a: ([\d.]+),\s*b: ([\d.]+)/g)]
    .map(m => ({ id: m[1], a: +m[2], b: +m[3] }));
  if (!scenes.length) { add('レイアウト', 'シーン定義の読み出し', false, 'timeline.js から SCENES を読めません'); return; }

  const launch = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  const exe = chromePath();
  if (exe) launch.executablePath = exe;
  const browser = await chromium.launch(launch);

  for (const [w, h, label] of [[1920, 1080, '16:9'], [1080, 1080, '1:1']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, locale: 'ja-JP' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => { window.__CAPTURE__ = true; });
    await page.goto('file://' + path.join(ROOT, 'src', 'video.html'), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => Promise.all(
      Array.from(document.images).map(i => i.complete ? null : i.decode().catch(() => {}))));
    await page.waitForTimeout(300);

    add('ページ', `JSエラー (${label})`, errors.length === 0, errors.slice(0, 3).join(' / '));

    // 各シーンが一番落ち着いた時刻で測る
    const rows = await page.evaluate(scs => scs.map(sc => {
      const t = sc.b - 0.45;
      window.__video.seek(t);
      const sec = document.getElementById(sc.id);
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
      return {
        id: sc.id, t,
        over: Math.max(pt - minY, maxY - (innerHeight - pb), pl - minX, maxX - (innerWidth - pr)),
        offCanvas: Math.max(-minY, maxY - innerHeight, -minX, maxX - innerWidth)
      };
    }), scenes);

    for (const r of rows) {
      add('レイアウト', `${label} ${r.id}`,
          r.over <= LIMITS.overflowPx && r.offCanvas <= 0,
          `余白から ${r.over.toFixed(0)}px / 画面外 ${r.offCanvas.toFixed(0)}px`);
    }
    await ctx.close();
  }
  await browser.close();
}

/* ---------- 2. 動画と音声 ---------- */
function checkVideo(file) {
  const name = path.basename(file);
  if (!fs.existsSync(file)) { add('動画', name, false, '書き出されていません'); return; }
  const p = probe(file);

  add('動画', `${name} 解像度`, p.height >= LIMITS.minHeight, `${p.width}x${p.height}`);
  add('動画', `${name} コーデック`, p.vcodec === 'h264' && p.pixfmt === 'yuv420p', `${p.vcodec} / ${p.pixfmt} / ${p.profile}`);
  add('動画', `${name} fps`, p.fps >= LIMITS.minFps, `${p.fps} fps`);
  add('動画', `${name} 音声トラック`, !!p.acodec, p.acodec ? `${p.acodec} ${p.asr}Hz ${p.ach}` : 'なし');

  const l = loudness(file);
  add('音声', `${name} ラウドネス`,
      l.I !== null && l.I >= LIMITS.lufs[0] && l.I <= LIMITS.lufs[1],
      l.I === null ? '測れません' : `${l.I.toFixed(1)} LUFS（目標 ${LIMITS.lufs[0]}〜${LIMITS.lufs[1]}）`);
  add('音声', `${name} トゥルーピーク`,
      l.peak !== null && l.peak <= LIMITS.truePeakMax,
      l.peak === null ? '測れません' : `${l.peak.toFixed(1)} dBFS（上限 ${LIMITS.truePeakMax}）`);

  // 映像の尺は timeline.js の DUR と合っているか
  const tl = fs.readFileSync(path.join(ROOT, 'src/timeline.js'), 'utf8');
  const dur = parseFloat((tl.match(/var DUR = ([\d.]+);/) || [])[1]);
  if (dur && p.duration) {
    add('整合', `${name} 尺`, Math.abs(p.duration - dur) <= 0.2,
        `動画 ${p.duration.toFixed(2)}s / 設計 ${dur.toFixed(2)}s`);
  }

  // ナレーションとの尺ずれ
  const nar = path.join(ROOT, 'dist/narration.m4a');
  if (fs.existsSync(nar)) {
    const np = probe(nar);
    add('整合', `${name} 映像と音声の尺`,
        Math.abs(np.duration - p.duration) <= LIMITS.avSkewSec,
        `差 ${Math.abs(np.duration - p.duration).toFixed(2)}s`);
  }
}

(async () => {
  console.log('検品を開始します\n');
  await checkLayout();

  if (!has('skip-video')) {
    const preset = arg('preset', null);
    const files = preset
      ? [path.join(ROOT, 'dist', preset === '1x1'
          ? 'ikinari-pdf-complete_1x1_1080.mp4' : 'ikinari-pdf-complete_16x9_1080p.mp4')]
      : fs.existsSync(path.join(ROOT, 'dist'))
        ? fs.readdirSync(path.join(ROOT, 'dist')).filter(f => f.endsWith('.mp4'))
            .map(f => path.join(ROOT, 'dist', f))
        : [];
    if (!files.length) add('動画', '書き出し', false, 'dist/ に mp4 がありません');
    files.forEach(checkVideo);
  }

  // ---- 表示 ----
  let area = null, ng = 0;
  for (const r of results) {
    if (r.area !== area) { area = r.area; console.log(`[${area}]`); }
    if (!r.ok) ng++;
    console.log(`  ${r.ok ? 'ok  ' : 'NG  '}${r.name.padEnd(34)} ${r.detail || ''}`);
  }
  console.log(`\n${results.length} 項目中 ${results.length - ng} 件 ok`);
  if (ng) { console.log(`${ng} 件が基準を外れています。`); process.exit(1); }
  console.log('納品して問題ありません。');
})().catch(e => { console.error(e); process.exit(1); });
