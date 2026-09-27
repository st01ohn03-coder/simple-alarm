#!/usr/bin/env node
/* ============================================================
   画面文字とナレーション原稿を、入稿先のルールに照らして点検する。

     node tools/lint-copy.js
     node tools/lint-copy.js --strict    # warn も失格にする
     node tools/lint-copy.js --selftest  # ルール自体が壊れていないか確かめる

   ルールは docs/compliance/<profile>.json。
   どのプロファイルを使うかは project.json の compliance.profile。

   error が1件でもあると終了コードが 0 にならない。
   warn は既定では通すが、根拠の注記が要る表現を拾うので必ず目を通すこと。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, load } = require('./config.js');

const cfg = load();
const STRICT = process.argv.includes('--strict');

/* ---------- 点検の対象を集める ---------- */

/** video.html の「画面に出る文字」だけを、行番号つきで拾う */
function screenText() {
  const file = path.join(ROOT, 'src', 'video.html');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [];
  let inSkip = false;
  let inBody = false;   // <title> や <meta> は画面に出ないので見ない
  lines.forEach((line, i) => {
    if (/<body\b/.test(line)) { inBody = true; return; }
    if (/<\/body>/.test(line)) { inBody = false; return; }
    if (!inBody) return;
    if (/<(script|style)\b/.test(line)) inSkip = true;
    if (/<\/(script|style)>/.test(line)) { inSkip = false; return; }
    if (inSkip) return;
    const text = line
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;|&#\d+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) out.push({ file: 'src/video.html', line: i + 1, text });
  });
  return out;
}

/** narration.py の LINES と、timeline.js の注記文を拾う */
function scriptText() {
  const out = [];
  const nar = path.join(ROOT, 'tools', 'narration.py');
  if (fs.existsSync(nar)) {
    const lines = fs.readFileSync(nar, 'utf8').split('\n');
    let inLines = false;
    lines.forEach((line, i) => {
      if (/^LINES\s*=\s*\[/.test(line)) { inLines = true; return; }
      if (inLines && /^\]/.test(line)) { inLines = false; return; }
      if (!inLines) return;
      const m = line.match(/"([^"]*)"\s*\)/);
      if (m && m[1].trim()) out.push({ file: 'tools/narration.py', line: i + 1, text: m[1] });
    });
  }
  const tl = path.join(ROOT, 'src', 'timeline.js');
  if (fs.existsSync(tl)) {
    fs.readFileSync(tl, 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(/^\s*var NOTE\w*\s*=\s*'([^']*)'/);
      if (m) out.push({ file: 'src/timeline.js', line: i + 1, text: m[1] });
    });
  }
  return out;
}

/* ---------- ルールを読む ---------- */
function loadProfile() {
  const file = path.join(ROOT, 'docs', 'compliance', cfg.compliance.profile + '.json');
  if (!fs.existsSync(file)) {
    console.error(`ルールが見つかりません: ${path.relative(ROOT, file)}`);
    console.error('project.json の compliance.profile を確認してください。');
    process.exit(1);
  }
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  // 競合の実名はプロジェクトごとに違うので project.json 側から足す
  const names = (cfg.compliance.competitorNames || []).filter(Boolean);
  if (names.length) {
    p.rules.push({
      id: 'competitor',
      severity: 'error',
      why: '競合の実名を出すと、比較広告として根拠の提示が必要になる。',
      fix: '「サブスクリプション型」のような一般名詞に置き換える。',
      pattern: names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    });
  }
  return p;
}

/* ---------- ルール自体の自己診断 ----------
   各ルールには「拾うべき例」と「拾ってはいけない例」を書いてある。
   正規表現を直したときに、意図せず効かなくなるのを防ぐ。 */
function selftest(profile) {
  let bad = 0;
  for (const r of profile.rules) {
    const ex = r.examples || {};
    for (const s of ex.ng || []) {
      if (!new RegExp(r.pattern, 'gu').test(s)) { console.log(`NG  [${r.id}] 拾えていません: 「${s}」`); bad++; }
    }
    for (const s of ex.ok || []) {
      if (new RegExp(r.pattern, 'gu').test(s)) { console.log(`NG  [${r.id}] 誤検出しています: 「${s}」`); bad++; }
    }
    if (!ex.ng && !ex.ok) console.log(`確認 [${r.id}] examples が書かれていません`);
  }
  const n = profile.rules.length;
  console.log(bad ? `\n${bad} 件の不一致。docs/compliance/ のルールを直してください。`
                  : `${n} 個のルールすべてが、例文どおりに動いています。`);
  return bad === 0;
}

/* ---------- 実行 ---------- */
const profile = loadProfile();

if (process.argv.includes('--selftest')) {
  process.exit(selftest(profile) ? 0 : 1);
}
const allowed = (cfg.compliance.allowedClaims || []).filter(Boolean);
const targets = [...screenText(), ...scriptText()];

if (!targets.length) {
  console.error('点検する文言が見つかりませんでした。src/video.html を確認してください。');
  process.exit(1);
}

const hits = [];
for (const rule of profile.rules) {
  const re = new RegExp(rule.pattern, 'gu');
  for (const t of targets) {
    for (const m of t.text.matchAll(re)) {
      // allowedClaims に入っている語は、注記済みの主張として見逃す
      if (rule.severity === 'warn' && allowed.some(a => m[0].includes(a) || a.includes(m[0]))) continue;
      hits.push({ rule, hit: m[0], ...t });
    }
  }
}

console.log(`点検: ${profile.name}`);
console.log(`対象: ${targets.length} 行（画面文字・ナレーション原稿・注記）\n`);

const errors = hits.filter(h => h.rule.severity === 'error');
const warns = hits.filter(h => h.rule.severity === 'warn');

function show(list, label) {
  if (!list.length) return;
  const byRule = new Map();
  for (const h of list) {
    if (!byRule.has(h.rule.id)) byRule.set(h.rule.id, []);
    byRule.get(h.rule.id).push(h);
  }
  for (const [id, group] of byRule) {
    const r = group[0].rule;
    console.log(`${label} [${id}]`);
    console.log(`  なぜ  ${r.why}`);
    console.log(`  直し方 ${r.fix}`);
    for (const h of group.slice(0, 8)) {
      console.log(`    ${h.file}:${h.line}  「${h.hit}」  … ${h.text.slice(0, 60)}`);
    }
    if (group.length > 8) console.log(`    ほか ${group.length - 8} 件`);
    console.log('');
  }
}

show(errors, 'NG ');
show(warns, '確認');

if (!hits.length) console.log('引っかかった表現はありません。');
else console.log(`NG ${errors.length} 件 / 要確認 ${warns.length} 件`);

if (errors.length || (STRICT && warns.length)) process.exit(1);
