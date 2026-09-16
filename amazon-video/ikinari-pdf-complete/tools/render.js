#!/usr/bin/env node
/* ============================================================
   src/video.html を 1 フレームずつキャプチャして MP4 に書き出す。
   フレームは一切ディスクに落とさず、JPEG を ffmpeg の stdin へ
   直接流し込む（image2pipe）。
   ------------------------------------------------------------
   使い方:
     node tools/render.js                 # 16:9 1920x1080
     node tools/render.js --preset 1x1    # 1:1  1080x1080
     node tools/render.js --w 1280 --h 720 --fps 30 --out dist/foo.mp4
   ============================================================ */
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

/* ---------- 引数 ---------- */
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const PRESETS = {
  '16x9': { w: 1920, h: 1080, out: 'ikinari-pdf-complete_16x9_1080p.mp4' },
  '1x1':  { w: 1080, h: 1080, out: 'ikinari-pdf-complete_1x1_1080.mp4' },
  '9x16': { w: 1080, h: 1920, out: 'ikinari-pdf-complete_9x16_1080.mp4' }
};
const preset = PRESETS[arg('preset', '16x9')] || PRESETS['16x9'];

const ROOT = path.resolve(__dirname, '..');
const W    = parseInt(arg('w', preset.w), 10);
const H    = parseInt(arg('h', preset.h), 10);
const FPS  = parseInt(arg('fps', '30'), 10);
const CRF  = arg('crf', '18');
const QUAL = parseInt(arg('quality', '96'), 10);
const OUT  = path.resolve(ROOT, arg('out', path.join('dist', preset.out)));
const PAGE = 'file://' + path.join(ROOT, 'src', 'video.html');

/* ---------- 実行ファイルの場所 ---------- */
function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { return require('@ffmpeg-installer/ffmpeg').path; } catch (e) {}
  return 'ffmpeg';
}
function chromePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const p = '/opt/pw-browsers/chromium';
  return fs.existsSync(p) ? p : undefined;
}

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const launchOpts = { args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb',
                              '--font-render-hinting=none', '--disable-lcd-text'] };
  const exe = chromePath();
  if (exe) launchOpts.executablePath = exe;

  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    locale: 'ja-JP',
    reducedMotion: 'no-preference'
  });
  const page = await ctx.newPage();

  // プレビュー用の rAF ループを止めて、seek だけで描画させる
  await page.addInitScript(() => { window.__CAPTURE__ = true; });

  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(PAGE, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  // 画像のデコード完了を待つ
  await page.evaluate(() => Promise.all(
    Array.from(document.images).map(img => img.complete ? Promise.resolve() : img.decode().catch(() => {}))
  ));
  await page.waitForTimeout(400);

  const meta = await page.evaluate(() => ({ duration: window.__video.duration, fps: window.__video.fps }));
  const total = Math.round(meta.duration * FPS);
  if (errors.length) { console.error('ページ内エラー:\n' + errors.join('\n')); process.exit(1); }

  console.log(`▶ ${path.basename(OUT)}  ${W}x${H} @ ${FPS}fps  ${meta.duration}s  (${total} frames)`);

  /* ---------- ffmpeg: JPEG パイプ → H.264 MP4 ---------- */
  const ff = spawn(ffmpegPath(), [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0',
    // Amazon 入稿用に無音の AAC トラックを付けておく（音声なしで弾かれるのを防ぐ）
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF,
    '-profile:v', 'high', '-level', '4.1',
    '-pix_fmt', 'yuv420p',
    '-x264-params', 'keyint=' + (FPS * 2) + ':min-keyint=' + FPS + ':scenecut=0',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-shortest',
    '-movflags', '+faststart',
    '-r', String(FPS),
    OUT
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  let ffClosed = false, ffCode = null;
  const ffDone = new Promise(res => ff.on('close', c => { ffClosed = true; ffCode = c; res(c); }));
  ff.stdin.on('error', () => {}); // EPIPE 抑止

  function write(buf) {
    if (ffClosed) return Promise.resolve();
    return ff.stdin.write(buf) ? Promise.resolve()
                               : new Promise(res => ff.stdin.once('drain', res));
  }

  const t0 = Date.now();
  for (let f = 0; f < total; f++) {
    await page.evaluate(fr => window.__video.seekFrame(fr), f * (meta.fps / FPS));
    const buf = await page.screenshot({ type: 'jpeg', quality: QUAL });
    await write(buf);
    if (f % 60 === 0 || f === total - 1) {
      const pct = ((f + 1) / total * 100).toFixed(0);
      const el = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write(`\r   ${pct}%  frame ${f + 1}/${total}  ${el}s   `);
    }
  }
  process.stdout.write('\n');

  ff.stdin.end();
  await ffDone;
  await browser.close();

  if (ffCode !== 0) { console.error('ffmpeg が異常終了しました (code ' + ffCode + ')'); process.exit(1); }
  const kb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
  console.log(`✔ 完成: ${OUT}  (${kb} MB)`);
})().catch(e => { console.error(e); process.exit(1); });
