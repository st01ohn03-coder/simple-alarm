/* ============================================================
   project.json の読み込みと、実行環境の探索をここに集約する。
   Node 側のツールは全部これを require する。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* ---------- 既定値。project.json に書かれていない項目はここが使われる ---------- */
const DEFAULTS = {
  product: { asin: '', slug: 'product-video', name: '', brand: '', marketplace: 'amazon.co.jp', locale: 'ja-JP' },
  theme: { colors: {}, font: { family: 'Noto Sans JP', googleName: 'Noto+Sans+JP', weights: [400, 500, 700, 900] } },
  video: {
    fps: 30, crf: 18, jpegQuality: 96,
    deliverables: ['16x9', '1x1'],
    presets: {
      '16x9': { w: 1920, h: 1080, suffix: '16x9_1080p' },
      '1x1':  { w: 1080, h: 1080, suffix: '1x1_1080' },
      '9x16': { w: 1080, h: 1920, suffix: '9x16_1080' }
    }
  },
  narration: {
    enabled: true, voice: 'ja-JP-NanamiNeural', rate: '+6%',
    lead: 0.45, tailMargin: 0.30, clipLufs: -19, targetLufs: -16,
    music: { enabled: true, db: -19 }
  },
  qa: {
    overflowPx: 40, lufs: [-17, -15], truePeakMax: -1.0, avSkewSec: 0.15,
    minFps: 23.976, minHeight: 720, maxFileMB: 500,
    // 文字の下限は「キャンバス高さに対する割合」で見る。
    // 画面の実寸が変わっても同じ基準で判定できるため。
    minFontPctH: 1.7, minSmallFontPctH: 1.05, smallTextSelectors: ['.notes'],
    minContrast: 4.5, minContrastLarge: 3.0, largeTextPx: 32, safeMarginPct: 4.0
  },
  compliance: { profile: 'amazon-jp', competitorNames: [], allowedClaims: [] }
};

function deepMerge(base, over) {
  if (Array.isArray(over)) return over.slice();
  if (over === null || typeof over !== 'object') return over === undefined ? base : over;
  const out = Array.isArray(base) ? {} : Object.assign({}, base);
  for (const k of Object.keys(over)) {
    if (k.startsWith('_')) continue;           // _comment などは無視
    out[k] = deepMerge(base && base[k], over[k]);
  }
  return out;
}

let cached = null;

/** project.json を読む（無ければ既定値のみ）。結果は使い回す。 */
function load() {
  if (cached) return cached;
  const file = path.join(ROOT, 'project.json');
  let user = {};
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`project.json を読めません: ${e.message}`);
    }
  }
  const cfg = deepMerge(DEFAULTS, user);
  validate(cfg);
  cfg.root = ROOT;
  cached = cfg;
  return cfg;
}

/** 設定の矛盾はここで止める。あとの工程で分かりにくく壊れるより早く落とす。 */
function validate(c) {
  const bad = [];
  if (!c.product.slug || !/^[a-z0-9][a-z0-9-]*$/.test(c.product.slug)) {
    bad.push('product.slug は英小文字・数字・ハイフンで指定してください');
  }
  if (c.product.asin && !/^[A-Z0-9]{10}$/.test(c.product.asin)) {
    bad.push('product.asin は10桁の英数字です');
  }
  if (!(c.video.fps >= 1)) bad.push('video.fps が不正です');
  if (!Object.keys(c.video.presets).length) bad.push('video.presets が空です');
  for (const [k, p] of Object.entries(c.video.presets)) {
    if (!(p.w > 0 && p.h > 0)) bad.push(`video.presets.${k} の w / h が不正です`);
  }
  const [lo, hi] = c.qa.lufs || [];
  if (!(lo < hi)) bad.push('qa.lufs は [下限, 上限] の順で指定してください');
  if (c.narration.targetLufs < lo || c.narration.targetLufs > hi) {
    bad.push(`narration.targetLufs (${c.narration.targetLufs}) が qa.lufs [${lo}, ${hi}] の外にあります`);
  }
  if (c.video.fps < c.qa.minFps) {
    bad.push(`video.fps (${c.video.fps}) が qa.minFps (${c.qa.minFps}) を下回っています`);
  }
  for (const p of Object.values(c.video.presets)) {
    if (p.h < c.qa.minHeight) {
      bad.push(`presets に qa.minHeight (${c.qa.minHeight}) 未満の高さ ${p.h} があります`);
    }
  }
  if (bad.length) throw new Error('project.json の内容に問題があります:\n  - ' + bad.join('\n  - '));
}

/** 書き出しファイル名。<slug>_<suffix>.mp4 */
function outputName(cfg, presetKey) {
  const p = cfg.video.presets[presetKey];
  if (!p) throw new Error(`知らないプリセットです: ${presetKey}（使えるのは ${Object.keys(cfg.video.presets).join(', ')}）`);
  return `${cfg.product.slug}_${p.suffix}.mp4`;
}

/* ---------- 実行環境の探索 ---------- */

/** ffmpeg を探す。環境変数 > 同梱 > PATH の順。libx264 が要る。 */
function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  for (const p of [
    path.join(ROOT, 'node_modules/@ffmpeg-installer/linux-x64/ffmpeg'),
    path.join(ROOT, 'node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg'),
    path.join(ROOT, 'node_modules/@ffmpeg-installer/darwin-x64/ffmpeg'),
    path.join(ROOT, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe')
  ]) if (fs.existsSync(p)) return p;
  try {
    return require('@ffmpeg-installer/ffmpeg').path;
  } catch (e) { /* 同梱が無ければ PATH に任せる */ }
  return 'ffmpeg';
}

/** Chromium を探す。見つからなければ undefined を返し、Playwright 同梱版に任せる。 */
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const p of ['/opt/pw-browsers/chromium']) if (fs.existsSync(p)) return p;
  return undefined;
}

/** Playwright の launch オプション。全ツールで同じ設定を使う。 */
function launchOptions() {
  const o = {
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb',
           '--font-render-hinting=none', '--disable-lcd-text']
  };
  const exe = chromiumPath();
  if (exe) o.executablePath = exe;
  return o;
}

module.exports = { ROOT, load, outputName, ffmpegPath, chromiumPath, launchOptions, DEFAULTS };
