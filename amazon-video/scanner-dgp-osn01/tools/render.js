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
     node tools/render.js --audio none    # ナレーションを入れず無音にする

   解像度・fps・画質・書き出し名は project.json（video.presets ほか）が既定値。
   コマンド引数はそれを一時的に上書きする。

   音声は既定で dist/narration.m4a を多重化する。無ければ無音トラックになる。
   音声の作り方は tools/narration.py を参照。
   ============================================================ */
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { ROOT, load, outputName, ffmpegPath, launchOptions } = require('./config.js');

const cfg = load();

/* ---------- 引数 ---------- */
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const presetKey = arg('preset', '16x9');
const preset = cfg.video.presets[presetKey];
if (!preset) {
  console.error(`知らないプリセットです: ${presetKey}`);
  console.error(`使えるのは ${Object.keys(cfg.video.presets).join(', ')}（project.json の video.presets）`);
  process.exit(1);
}

const W    = parseInt(arg('w', preset.w), 10);
const H    = parseInt(arg('h', preset.h), 10);
const FPS  = parseInt(arg('fps', cfg.video.fps), 10);
const CRF  = String(arg('crf', cfg.video.crf));
const QUAL = parseInt(arg('quality', cfg.video.jpegQuality), 10);
const AUDIO = arg('audio', path.join('dist', 'narration.m4a'));
const OUT  = path.resolve(ROOT, arg('out', path.join('dist', outputName(cfg, presetKey))));
const PAGE = 'file://' + path.join(ROOT, 'src', 'video.html');

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const browser = await chromium.launch(launchOptions());
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
  // 音声トラックは必ず付ける。ナレーションが無ければ無音の AAC を入れる
  // （音声トラックなしの MP4 を弾く入稿先があるため）。
  const audioPath = AUDIO === 'none' ? null : path.resolve(ROOT, AUDIO);
  const hasAudio = audioPath && fs.existsSync(audioPath);
  if (audioPath && !hasAudio) {
    console.warn(`  音声が見つかりません: ${audioPath}\n  無音で書き出します（作り方は tools/narration.py）`);
  }
  const audioIn = hasAudio
    ? ['-i', audioPath]
    : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'];

  const ff = spawn(ffmpegPath(), [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0',
    ...audioIn,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF,
    '-profile:v', 'high', '-level', '4.1',
    '-pix_fmt', 'yuv420p',
    '-x264-params', 'keyint=' + (FPS * 2) + ':min-keyint=' + FPS + ':scenecut=0',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest',
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
