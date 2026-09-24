#!/usr/bin/env node
/* ============================================================
   動かすのに必要なものが揃っているかを調べ、足りなければ直し方を出す。

     node tools/doctor.js

   別の環境に持っていったとき、まずこれを走らせる。
   1つでも「必須」が欠けていると終了コードが 0 にならない。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const rows = [];
const add = (req, name, ok, detail, fix) => rows.push({ req, name, ok, detail, fix });

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, ...opts });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), err: r.error };
}

/* ---------- Node ---------- */
(() => {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  add(true, 'Node.js', major >= 18, `v${process.versions.node}`,
      'Node 18 以上を入れてください（https://nodejs.org）。');
})();

/* ---------- npm の依存 ---------- */
(() => {
  const nm = path.join(ROOT, 'node_modules');
  const has = fs.existsSync(nm);
  add(true, 'node_modules', has, has ? 'あり' : 'なし', 'npm install を実行してください。');
  if (!has) return;

  let pw = false, pwVer = '';
  try { pwVer = require(path.join(nm, 'playwright/package.json')).version; pw = true; } catch (e) {}
  add(true, 'playwright', pw, pw ? `v${pwVer}` : 'なし', 'npm install playwright');

  let ffi = false;
  try { require.resolve('@ffmpeg-installer/ffmpeg', { paths: [ROOT] }); ffi = true; } catch (e) {}
  add(false, '@ffmpeg-installer/ffmpeg', ffi, ffi ? 'あり' : 'なし（PATH の ffmpeg を使います）',
      'npm install @ffmpeg-installer/ffmpeg');
})();

/* ---------- Chromium ---------- */
(() => {
  let exe = process.env.CHROMIUM_PATH;
  let how = exe ? 'CHROMIUM_PATH' : null;
  if (!exe && fs.existsSync('/opt/pw-browsers/chromium')) { exe = '/opt/pw-browsers/chromium'; how = '/opt/pw-browsers'; }
  if (!exe) {
    try {
      const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
      exe = chromium.executablePath();
      how = 'playwright 同梱';
    } catch (e) { /* 未取得 */ }
  }
  const ok = !!exe && fs.existsSync(exe);
  let ver = '';
  if (ok) {
    const r = run(exe, ['--version']);
    ver = (r.out || '').trim().split('\n')[0];
  }
  add(true, 'Chromium', ok, ok ? `${ver || 'あり'}（${how}）` : 'なし',
      'npx playwright install chromium を実行するか、CHROMIUM_PATH に実行ファイルを指定してください。');
})();

/* ---------- ffmpeg（libx264 が要る）---------- */
(() => {
  let ffmpeg;
  try { ffmpeg = require('./config.js').ffmpegPath(); } catch (e) { ffmpeg = 'ffmpeg'; }
  const v = run(ffmpeg, ['-hide_banner', '-version']);
  const ok = v.code === 0;
  const ver = ok ? (v.out.split('\n')[0] || '').replace('ffmpeg version ', '') : '';
  add(true, 'ffmpeg', ok, ok ? ver.slice(0, 48) : 'なし',
      'npm install @ffmpeg-installer/ffmpeg を実行するか、FFMPEG_PATH を設定してください。');
  if (!ok) return;

  const enc = run(ffmpeg, ['-hide_banner', '-encoders']).out;
  const x264 = /libx264/.test(enc);
  add(true, 'ffmpeg の libx264', x264, x264 ? 'あり' : 'なし',
      'H.264 で書き出せない ffmpeg です。同梱版を使ってください: npm install @ffmpeg-installer/ffmpeg');
  const aac = /\baac\b/.test(enc);
  add(true, 'ffmpeg の AAC', aac, aac ? 'あり' : 'なし', '同上。');

  const filt = run(ffmpeg, ['-hide_banner', '-filters']).out;
  for (const f of ['ebur128', 'alimiter', 'silenceremove', 'acompressor']) {
    add(false, `ffmpeg の ${f}`, filt.includes(f), filt.includes(f) ? 'あり' : 'なし',
        `${f} が無いと音声の一部の処理ができません。ffmpeg を入れ替えてください。`);
  }
})();

/* ---------- Python と edge-tts（ナレーション用）---------- */
(() => {
  const py = process.env.PYTHON || 'python3';
  const v = run(py, ['--version']);
  const ok = v.code === 0;
  add(false, 'Python 3', ok, ok ? v.out.trim() : 'なし',
      'ナレーションを付けるのに要ります。無くても映像は無音で書き出せます。');
  if (!ok) return;
  const t = run(py, ['-c', 'import edge_tts,sys; sys.stdout.write(getattr(edge_tts,"__version__","?"))']);
  add(false, 'edge-tts', t.code === 0, t.code === 0 ? `v${t.out.trim()}` : 'なし',
      'pip install edge-tts');
})();

/* ---------- プロジェクトのファイル ---------- */
(() => {
  const must = [
    ['project.json', '設定。無いと既定値で動きます'],
    ['src/video.html', '動画本体'],
    ['src/timeline.js', 'タイムライン'],
    ['src/styles.css', 'レイアウト'],
    ['src/theme.css', '配色（node tools/apply-config.js で生成）'],
    ['src/fonts/fonts.css', 'フォント（node tools/subset-fonts.js で生成）']
  ];
  for (const [f, what] of must) {
    const ok = fs.existsSync(path.join(ROOT, f));
    add(f !== 'project.json', f, ok, ok ? what : 'なし',
        f === 'src/theme.css' ? 'node tools/apply-config.js'
        : f.startsWith('src/fonts') ? 'node tools/subset-fonts.js'
        : 'リポジトリが壊れています。取得し直してください。');
  }
  const assets = path.join(ROOT, 'src/assets');
  const n = fs.existsSync(assets) ? fs.readdirSync(assets).filter(f => /\.(jpg|png)$/i.test(f)).length : 0;
  add(true, 'src/assets の画像', n > 0, `${n} 枚`,
      'tools/pipeline.sh fetch <ASIN> で集めて、切り出して置いてください。');
})();

/* ---------- 設定の妥当性 ---------- */
(() => {
  try {
    const cfg = require('./config.js').load();
    add(true, 'project.json の内容', true,
        `${cfg.product.slug} / ${Object.keys(cfg.video.presets).length} プリセット`);
  } catch (e) {
    add(true, 'project.json の内容', false, e.message.split('\n')[0],
        'project.json を直してください。詳細は node -e "require(\'./tools/config.js\').load()" で出ます。');
  }
})();

/* ---------- 外に出られるか（フォント取得に要る）---------- */
function checkNet() {
  return new Promise(res => {
    const req = https.get('https://fonts.googleapis.com/css2?family=Noto+Sans+JP&text=%E3%81%82',
      { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
        r.resume();
        res(r.statusCode === 200);
      });
    req.on('timeout', () => { req.destroy(); res(false); });
    req.on('error', () => res(false));
  });
}

(async () => {
  const net = await checkNet();
  add(false, 'fonts.googleapis.com', net, net ? '到達できます' : '到達できません',
      'フォントのサブセット作り直しにだけ必要です。src/fonts/ が既にあるなら無くても動きます。' +
      ' プロキシ環境では NODE_EXTRA_CA_CERTS に CA を指定してください。');

  /* ---------- 表示 ---------- */
  console.log(`環境: ${os.platform()} ${os.arch()} / Node ${process.versions.node}\n`);
  let ngReq = 0, ngOpt = 0;
  for (const r of rows) {
    if (!r.ok) (r.req ? ngReq++ : ngOpt++);
    const mark = r.ok ? 'ok  ' : (r.req ? 'NG  ' : '任意 ');
    console.log(`  ${mark}${r.name.padEnd(26)} ${r.detail || ''}`);
  }

  const broken = rows.filter(r => !r.ok);
  if (broken.length) {
    console.log('\n直し方');
    for (const r of broken) console.log(`  ${r.name}\n    ${r.fix}`);
  }

  console.log(`\n必須 ${rows.filter(r => r.req).length} 件中 ${rows.filter(r => r.req && r.ok).length} 件 ok` +
              (ngOpt ? ` / 任意が ${ngOpt} 件不足` : ''));
  if (ngReq) { console.log(`\n必須が ${ngReq} 件足りません。上の「直し方」を先に片づけてください。`); process.exit(1); }
  console.log('必要なものは揃っています。');
})();
