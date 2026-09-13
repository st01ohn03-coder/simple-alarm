/* 結婚式2次会スライド（手作り風）を PowerPoint で生成する */
const pptxgen = require("pptxgenjs");
const path = require("path");

const A = (f) => path.join(__dirname, "assets", f);  // make_assets.py が出力する素材
const W = 13.333, H = 7.5;

/* ---- 色 ---- */
const PAPER = "F7F0E3", INK = "4A3A2E", SOFT = "7D6A5A", MARKER = "D9534F";
const NOTE = { cream: "FFF8DC", pink: "FDE2DF", green: "E2ECD9", blue: "DFE9F1", white: "FFFDF7" };
const SKY = "A9C6D9";

/* 紙の色に寄せて「はずれ」を淡くする */
function fade(hex, t = 0.62) {
  const p = [0xf7, 0xf0, 0xe3];
  const c = [0, 2, 4].map((i) => parseInt(hex.substr(i, 2), 16));
  return c.map((v, i) => Math.round(v + (p[i] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/* ---- 書体 ---- */
const HAND = "Yusei Magic";      // 見出し（手書き風）
const PEN = "Zen Kurenaido";     // 本文
const LATIN = "Caveat";          // 英字の飾り

const pres = new pptxgen();
pres.defineLayout({ name: "W16x9", width: W, height: H });
pres.layout = "W16x9";
pres.author = "";
pres.title = "結婚式2次会";

/* 紙の背景はマスターに置く（各スライドに埋め込むとファイルが数十MBになる） */
pres.defineSlideMaster({ title: "PAPER", background: { path: A("bg-paper.jpg") } });

const newSlide = (notes) => {
  const s = pres.addSlide({ masterName: "PAPER" });
  if (notes) s.addNotes(notes);
  return s;
};

const shadow = () => ({ type: "outer", color: "4A3A2E", blur: 6, offset: 2, angle: 60, opacity: 0.18 });

/* 装飾 */
const garland = (s) => s.addImage({ path: A("garland.png"), x: 0, y: 0, w: W, h: 1.6, transparency: 8 });
const heart = (s, x, y, w = 0.62) => s.addImage({ path: A("heart.png"), x, y, w, h: w, rotate: -10 });
const star = (s, x, y, w = 0.6) => s.addImage({ path: A("star.png"), x, y, w, h: w, rotate: 12 });
const tape = (s, kind, x, y, w = 1.5, rot = -6) =>
  s.addImage({ path: A(`tape-${kind}.png`), x, y, w, h: w * 78 / 360, rotate: rot });

/* 未確定メモ（本番前に消す用の付箋ラベル） */
function todo(s, text, x, y, w = 2.6) {
  s.addText(text, {
    shape: pres.ShapeType.roundRect, rectRadius: 0.05, fill: { color: SKY }, line: { color: SKY },
    x, y, w, h: 0.34, isTextBox: true, margin: 2, rotate: -2,
    fontFace: PEN, fontSize: 11, color: "FFFFFF", align: "center", valign: "middle",
  });
}

/* 英字の見出し（Caveat） */
const eyebrow = (s, text, x, y, opt = {}) =>
  s.addText(text, {
    x, y, w: opt.w || 5, h: 0.6, isTextBox: true, margin: 0,
    fontFace: LATIN, fontSize: opt.size || 30, color: opt.color || MARKER, bold: true,
    align: opt.align || "left", rotate: opt.rotate === undefined ? -2 : opt.rotate,
  });

/* 文字列の見た目の幅（全角=1em、半角=0.5em）を em で見積もる */
function emWidth(text) {
  let n = 0;
  for (const ch of text) n += /[　-ヿ㐀-鿿！-｠]/.test(ch) ? 1 : 0.52;
  return n;
}

/* 見出しに引く黄色いマーカー（文字幅に合わせて線も揃える） */
function marked(s, text, x, y, w, size = 40, align = "left") {
  const h = size / 72 * 1.7;
  const bw = Math.min(w, emWidth(text) * size / 72 * 1.04);
  const bx = align === "center" ? x + (w - bw) / 2 : x + 0.05;
  s.addShape(pres.ShapeType.rect, {
    x: bx, y: y + h * 0.60, w: bw, h: h * 0.30,
    fill: { color: "E6BB55", transparency: 48 }, line: { type: "none" }, rotate: -0.6,
  });
  s.addText(text, {
    x, y, w, h, isTextBox: true, margin: 0,
    fontFace: HAND, fontSize: size, color: INK, align, valign: "middle",
  });
}

/* ============================================================
   1. タイトル
   ============================================================ */
{
  const s = newSlide("開演。BGMを絞って司会が挨拶。名前と日付を本番用に差し替えること。");
  garland(s);
  heart(s, 1.1, 5.9, 0.7); star(s, 11.5, 5.7, 0.65);
  eyebrow(s, "Happy Wedding!!", 0, 1.75, { w: W, align: "center", size: 34 });
  s.addText(
    [{ text: "新郎", options: { fontFace: HAND, fontSize: 60, color: INK } },
     { text: " & ", options: { fontFace: LATIN, fontSize: 76, color: "E7A9A6", bold: true } },
     { text: "新婦", options: { fontFace: HAND, fontSize: 60, color: INK } }],
    { x: 0, y: 2.45, w: W, h: 1.5, isTextBox: true, align: "center", valign: "middle", margin: 0 }
  );
  s.addText("ご結婚おめでとう", { x: 0, y: 4.05, w: W, h: 0.6, isTextBox: true, margin: 0, fontFace: HAND, fontSize: 26, color: INK, align: "center" });
  s.addText("2次会、はじまります", { x: 0, y: 4.75, w: W, h: 0.5, isTextBox: true, margin: 0, fontFace: PEN, fontSize: 17, color: SOFT, align: "center" });
  todo(s, "名前と日付を入れる", (W - 2.6) / 2, 5.35);
}

/* ============================================================
   2. 今日やること
   ============================================================ */
{
  const s = newSlide("全体の流れを先に見せる。ビンゴは別アプリで実施する。");
  star(s, 0.75, 0.7, 0.55); heart(s, 12.0, 0.75, 0.6);
  marked(s, "今日やること", 0, 0.95, W, 40, "center");
  const items = [
    { n: "1", t: "クイズ大会", sub: "ふたりのこと、どれだけ知ってる？", c: NOTE.cream, tp: "kraft", rot: -2.5 },
    { n: "2", t: "中村になろうよ", sub: "ルールは当日のお楽しみ", c: NOTE.pink, tp: "blue", rot: 1.5 },
    { n: "3", t: "ビンゴ大会", sub: "景品あります", c: NOTE.green, tp: "pink", rot: -1 },
  ];
  items.forEach((it, i) => {
    const x = 0.95 + i * 3.95, y = 2.5, w = 3.4, h = 2.55;
    s.addShape(pres.ShapeType.rect, { x, y, w, h, fill: { color: it.c }, line: { type: "none" }, shadow: shadow(), rotate: it.rot });
    tape(s, it.tp, x + w / 2 - 0.75, y - 0.28, 1.5, it.rot - 4);
    s.addText(it.n, { x, y: y + 0.35, w, h: 0.7, isTextBox: true, margin: 0, fontFace: LATIN, fontSize: 40, bold: true, color: MARKER, align: "center", rotate: it.rot });
    s.addText(it.t, { x, y: y + 1.1, w, h: 0.6, isTextBox: true, margin: 0, fontFace: HAND, fontSize: 24, color: INK, align: "center", rotate: it.rot });
    s.addText(it.sub, { x: x + 0.2, y: y + 1.75, w: w - 0.4, h: 0.6, isTextBox: true, margin: 0, fontFace: PEN, fontSize: 13, color: SOFT, align: "center", rotate: it.rot });
  });
}

/* ============================================================
   共通：扉スライド
   ============================================================ */
function partSlide(part, title, lead, notes) {
  const s = newSlide(notes);
  garland(s);
  heart(s, 1.2, 5.85, 0.66); star(s, 11.6, 5.75, 0.6);
  eyebrow(s, part, 0, 2.0, { w: W, align: "center", size: 30 });
  marked(s, title, 0, 2.75, W, 52, "center");
  s.addText(lead, { x: 0, y: 4.5, w: W, h: 0.6, isTextBox: true, margin: 0, fontFace: PEN, fontSize: 19, color: SOFT, align: "center" });
  return s;
}

/* 共通：箇条書きのルールスライド */
function rulesSlide(title, lines, notes, todoText) {
  const s = newSlide(notes);
  star(s, 12.1, 0.8, 0.55);
  marked(s, title, 0.9, 0.85, 6, 38);
  lines.forEach((ln, i) => {
    const y = 2.25 + i * 0.95;
    s.addShape(pres.ShapeType.ellipse, { x: 1.0, y: y + 0.12, w: 0.22, h: 0.22, fill: { type: "none" }, line: { color: INK, width: 1.75 }, rotate: 8 });
    s.addText(ln, { x: 1.45, y, w: 10.6, h: 0.75, isTextBox: true, margin: 0, fontFace: PEN, fontSize: 19, color: INK, valign: "top" });
  });
  if (todoText) todo(s, todoText, 1.45, 2.25 + lines.length * 0.95 + 0.15, 3.4);
  return s;
}

/* ============================================================
   共通：4択クイズ（問題スライド＋正解スライド）
   ============================================================ */
const CH_COLORS = [NOTE.cream, NOTE.pink, NOTE.green, NOTE.blue];
const CH_POS = [
  { x: 0.85, y: 3.35, rot: -1.2 }, { x: 6.95, y: 3.35, rot: 0.8 },
  { x: 0.85, y: 5.05, rot: 0.6 }, { x: 6.95, y: 5.05, rot: -0.9 },
];
const CH_W = 5.5, CH_H = 1.42;

function choiceNote(s, i, letter, text, opts = {}) {
  const p = CH_POS[i];
  const fill = opts.faded ? fade(CH_COLORS[i]) : CH_COLORS[i];
  s.addShape(pres.ShapeType.rect, {
    x: p.x, y: p.y, w: CH_W, h: CH_H, fill: { color: fill },
    line: { type: "none" }, shadow: opts.faded ? undefined : shadow(), rotate: p.rot,
  });
  /* 長い選択肢は自動で少し縮める（1文字だけ次行に落ちるのを防ぐ） */
  const size = emWidth(text) > 17 ? 16 : 19;
  s.addText(
    [{ text: letter, options: { fontFace: LATIN, fontSize: 30, bold: true, color: opts.faded ? "B9AE9E" : MARKER } },
     { text: "  " + text, options: { fontFace: PEN, fontSize: size, color: opts.faded ? "A99C8B" : INK } },
     ...(opts.extra ? [{ text: "  " + opts.extra, options: { fontFace: HAND, fontSize: 15, color: MARKER } }] : [])],
    { x: p.x + 0.28, y: p.y, w: CH_W - 0.56, h: CH_H, isTextBox: true, margin: 0, valign: "middle", rotate: p.rot, fit: "shrink" }
  );
}

const Q_Y = 1.35, Q_H = 1.25;   /* 設問の位置（正解スライドと共通） */

function quizSlides(no, question, choices, correct, answerLine, notes) {
  /* --- 問題 --- */
  const q = newSlide(notes || `Q${no} を読み上げる。全員が選び終えたら次のスライドで正解を出す。`);
  eyebrow(q, `Q.${no}`, 0.9, 0.62, { w: 3, size: 44, rotate: -4 });
  q.addText(question, { x: 0.9, y: Q_Y, w: 11.6, h: Q_H, isTextBox: true, margin: 0, fontFace: HAND, fontSize: 34, color: INK, valign: "middle", fit: "shrink" });
  choices.forEach((c, i) => choiceNote(q, i, "ABCD"[i], c));

  /* --- 正解 --- */
  const a = newSlide("正解を発表。正解した人に手を挙げてもらい、司会が数える。");
  eyebrow(a, `Q.${no}`, 0.9, 0.62, { w: 3, size: 44, rotate: -4 });
  a.addText(question, { x: 0.9, y: Q_Y, w: 11.6, h: Q_H, isTextBox: true, margin: 0, fontFace: HAND, fontSize: 34, color: INK, valign: "middle", fit: "shrink" });
  choices.forEach((c, i) =>
    choiceNote(a, i, "ABCD"[i], c, { faded: i !== correct, extra: i === correct ? answerLine.extra : null })
  );
  const p = CH_POS[correct];
  a.addImage({ path: A("circle-wide.png"), x: p.x - 0.22, y: p.y - 0.2, w: CH_W + 0.44, h: CH_H + 0.4, rotate: p.rot - 1 });
  a.addText(answerLine.banner, { x: 0.9, y: 2.62, w: 11.6, h: 0.52, isTextBox: true, margin: 0, fontFace: HAND, fontSize: 23, color: MARKER, valign: "middle", rotate: -1 });
  return { q, a };
}

/* ============================================================
   Part 1 クイズ大会
   ============================================================ */
partSlide("Part 1", "クイズ大会", "ふたりのこと、どれだけ知ってる？", "第1部の開始。拍手をもらってから始める。");

rulesSlide("ルール", [
  "全部で7問。4択の問題は A〜D から1つ選んで手を挙げてね",
  "正解がいちばん多かった人が優勝",
  "同点のときは新郎とじゃんけん",
  "優勝した人にはプレゼント",
], "ルール説明。ここは手短に。", "同点の決め方と景品を確定させる");

quizSlides(1, "初めてのデートで新郎がやらかした失敗は？",
  ["待ち合わせに遅刻", "服に値札がついていた", "飲み物を新婦の服にこぼした", "店を別日で予約していた"],
  0, { banner: "正解は A！ 待ち合わせに1時間の遅刻でした", extra: "…しかも1時間" });

quizSlides(2, "新婦が新郎に「これだけはやめて！」と思っている癖は？",
  ["酔って帰ってきてダル絡み", "いびきがうるさい", "服脱ぎっぱなし", "身支度に時間がかかる"],
  0, { banner: "正解は A！ 酔って帰ってきてダル絡み" });

quizSlides(3, "喧嘩したとき、新郎が必ずすることは？",
  ["コンビニでアイスを買ってくる", "許してもらえるまで土下座する", "義母に助けを求める", "拗ねる"],
  0, { banner: "正解は A！ コンビニでアイスを買ってくる" });

quizSlides(4, "新婦が思う「新郎の手料理でいちばん美味しいもの」は？",
  ["参鶏湯", "ガパオライス", "生姜焼き", "トマトカレー"],
  0, { banner: "正解は A！ 参鶏湯" });

/* --- Q5 写真クイズ --- */
{
  const PH = [
    { x: 1.15, rot: -3, tp: "kraft" }, { x: 4.05, rot: 2, tp: "blue" },
    { x: 6.95, rot: -1.5, tp: "pink" }, { x: 9.85, rot: 3, tp: "kraft" },
  ];
  const PW = 2.3, PHh = 3.15, PY = 3.25;

  function polaroids(s, correct) {
    PH.forEach((p, i) => {
      const isC = correct === i, dim = correct !== null && !isC;
      s.addShape(pres.ShapeType.rect, {
        x: p.x, y: PY, w: PW, h: PHh, fill: { color: dim ? "F3EDE2" : NOTE.white },
        line: { type: "none" }, shadow: dim ? undefined : shadow(), rotate: p.rot,
      });
      s.addShape(pres.ShapeType.rect, {
        x: p.x + 0.18, y: PY + 0.18, w: PW - 0.36, h: PHh - 0.95,
        fill: { color: dim ? "EDE7DB" : "E9E0CE" }, line: { type: "none" }, rotate: p.rot,
      });
      s.addText("ここに写真", {
        x: p.x + 0.18, y: PY + 0.18, w: PW - 0.36, h: PHh - 0.95, isTextBox: true, margin: 0,
        fontFace: PEN, fontSize: 12, color: dim ? "C0B5A2" : SOFT, align: "center", valign: "middle", rotate: p.rot,
      });
      s.addText("ABCD"[i], {
        x: p.x, y: PY + PHh - 0.72, w: PW, h: 0.6, isTextBox: true, margin: 0,
        fontFace: LATIN, fontSize: 30, bold: true, color: dim ? "B9AE9E" : SOFT, align: "center", valign: "middle", rotate: p.rot,
      });
      tape(s, p.tp, p.x + PW / 2 - 0.6, PY - 0.2, 1.2, p.rot - 5);
    });
  }

  const q = newSlide("幼少期の写真クイズ。4枚を差し替えてから本番に臨むこと。");
  eyebrow(q, "Q.5", 0.9, 0.62, { w: 3, size: 44, rotate: -4 });
  q.addText("この中で、新郎はどれ？", { x: 0.9, y: Q_Y, w: 8.5, h: Q_H, isTextBox: true, margin: 0, fontFace: HAND, fontSize: 34, color: INK, valign: "middle" });
  todo(q, "写真4枚を差し替える", 9.6, 1.75, 2.9);
  polaroids(q, null);

  const a = newSlide("正解の位置に合わせて赤丸を移動させること。初期状態は A に置いてある。");
  eyebrow(a, "Q.5", 0.9, 0.62, { w: 3, size: 44, rotate: -4 });
  a.addText("この中で、新郎はどれ？", { x: 0.9, y: Q_Y, w: 8.5, h: Q_H, isTextBox: true, margin: 0, fontFace: HAND, fontSize: 34, color: INK, valign: "middle" });
  polaroids(a, 0);
  a.addImage({ path: A("circle-tall.png"), x: PH[0].x - 0.28, y: PY - 0.25, w: PW + 0.56, h: PHh + 0.5, rotate: PH[0].rot });
  a.addText("正解はこの子！", { x: 0.9, y: 2.50, w: 6, h: 0.45, isTextBox: true, margin: 0, fontFace: HAND, fontSize: 23, color: MARKER, valign: "middle", rotate: -1 });
  todo(a, "赤丸を正解の位置へ", 9.6, 1.75, 2.9);
}

/* --- Q6 腕立て伏せ --- */
{
  const STEPS = [
    { n: "1", t: "数字を予想して\n紙に書く", c: NOTE.cream, tp: "kraft", rot: -2.5 },
    { n: "2", t: "せーの、で\nいっせいに見せる", c: NOTE.pink, tp: "blue", rot: 1.5 },
    { n: "3", t: "いちばん近い人が\n優勝", c: NOTE.green, tp: "pink", rot: -1 },
  ];
  const steps = (s) => STEPS.forEach((it, i) => {
    const x = 1.55 + i * 3.5, y = 3.65, w = 3.0, h = 2.3;
    s.addShape(pres.ShapeType.rect, { x, y, w, h, fill: { color: it.c }, line: { type: "none" }, shadow: shadow(), rotate: it.rot });
    tape(s, it.tp, x + w / 2 - 0.6, y - 0.22, 1.2, it.rot - 4);
    s.addText(it.n, { x, y: y + 0.28, w, h: 0.6, isTextBox: true, margin: 0, fontFace: LATIN, fontSize: 34, bold: true, color: MARKER, align: "center", rotate: it.rot });
    s.addText(it.t, { x: x + 0.15, y: y + 0.95, w: w - 0.3, h: 1.1, isTextBox: true, margin: 0, fontFace: PEN, fontSize: 16, color: INK, align: "center", valign: "top", rotate: it.rot });
  });

  const q = newSlide("ニアピン方式。紙とペンを配っておくか、口頭で数人に予想を聞く。");
  eyebrow(q, "Q.6", 0.9, 0.62, { w: 3, size: 44, rotate: -4 });
  q.addText("新郎は腕立て伏せを何回できる？", { x: 0.9, y: Q_Y, w: 11.6, h: Q_H, isTextBox: true, margin: 0, fontFace: HAND, fontSize: 38, color: INK, valign: "middle" });
  q.addText("いちばん近い数字を答えた人が正解", { x: 0.9, y: 2.72, w: 11.6, h: 0.5, isTextBox: true, margin: 0, fontFace: PEN, fontSize: 19, color: SOFT, valign: "middle" });
  steps(q);
  star(q, 12.0, 1.5, 0.62); heart(q, 0.7, 6.4, 0.58);

  const a = newSlide("回数を発表。その場で新郎に実演してもらうと盛り上がる。");
  eyebrow(a, "Q.6", 0.9, 0.62, { w: 3, size: 44, rotate: -4 });
  a.addText("新郎は腕立て伏せを何回できる？", { x: 0.9, y: Q_Y, w: 11.6, h: Q_H, isTextBox: true, margin: 0, fontFace: HAND, fontSize: 38, color: INK, valign: "middle" });
  a.addText("正解は…", { x: 0.9, y: 2.72, w: 11.6, h: 0.5, isTextBox: true, margin: 0, fontFace: HAND, fontSize: 23, color: MARKER, valign: "middle", rotate: -1 });
  a.addImage({ path: A("circle-small.png"), x: 4.32, y: 3.55, w: 4.7, h: 2.6, rotate: -2 });
  a.addText("？？回", { x: 4.32, y: 3.55, w: 4.7, h: 2.6, isTextBox: true, margin: 0, fontFace: HAND, fontSize: 66, color: MARKER, align: "center", valign: "middle", rotate: -2 });
  todo(a, "回数を入れる", 5.47, 6.35, 2.4);
  star(a, 11.9, 4.2, 0.66); heart(a, 1.0, 4.4, 0.6);
}

quizSlides(7, "ふたりが入籍前にやらかしたエピソードは？",
  ["新郎が社員旅行で左手薬指を負傷", "新婦が婚約指輪を落として無くしてしまう", "新郎が入籍日前日に終電を逃す", "新婦が義両親との顔合わせの日に道に迷って遅刻"],
  0, { banner: "正解は A！ 社員旅行で左手薬指を負傷…" });

/* --- 結果発表 --- */
{
  const s = partSlide("Result", "結果発表", "いちばん正解した人は前へどうぞ！", "正解数を挙手で確認して優勝者を決める。");
  s.addText("優勝者の決め方と景品をここに書く。「るい or るいぴー」の質問を入れるなら Q7 までのどこかに追加。",
    { x: 2.6, y: 5.5, w: 8.1, h: 0.9, isTextBox: true, margin: 8, fontFace: PEN, fontSize: 13, color: SOFT, align: "center",
      shape: pres.ShapeType.roundRect, rectRadius: 0.06, fill: { color: "FFFDF7" }, line: { color: SKY, width: 1.25, dashType: "dash" } });
}

/* ============================================================
   Part 2 中村になろうよ
   ============================================================ */
partSlide("Part 2", "中村になろうよ", "今日だけ、みんな中村家", "第2部。ルールが固まったら次のスライドを書き換える。");

{
  const s = newSlide("向井さんとルールを詰めてから、このスライドを完成させる。");
  marked(s, "ルール", 0.9, 0.85, 4, 38);
  todo(s, "ゲーム内容の確定待ち", 4.4, 1.05, 3.0);
  const items = [
    "参加人数・参加者の選び方（全員？代表者？）",
    "何をしたら「中村になれる」のか（お題・勝敗条件）",
    "ラウンド数と1ラウンドの時間",
    "必要な小道具・BGM",
  ];
  s.addShape(pres.ShapeType.roundRect, { x: 0.9, y: 2.15, w: 11.5, h: 4.15, rectRadius: 0.06,
    fill: { color: "FFFDF7" }, line: { color: SKY, width: 1.5, dashType: "dash" } });
  s.addText("決めることリスト", { x: 1.35, y: 2.45, w: 6, h: 0.5, isTextBox: true, margin: 0, fontFace: HAND, fontSize: 22, color: INK });
  items.forEach((t, i) => {
    const y = 3.2 + i * 0.72;
    s.addShape(pres.ShapeType.rect, { x: 1.4, y: y + 0.1, w: 0.24, h: 0.24, fill: { type: "none" }, line: { color: SOFT, width: 1.5 }, rotate: -4 });
    s.addText(t, { x: 1.85, y, w: 10, h: 0.5, isTextBox: true, margin: 0, fontFace: PEN, fontSize: 17, color: INK });
  });
}

{
  const s = newSlide("ラウンドごとにこのスライドを複製して使う。");
  eyebrow(s, "Round 1", 0.9, 0.75, { w: 4, size: 38, rotate: -3 });
  marked(s, "お題", 0.9, 1.7, 4, 44);
  todo(s, "お題を入れる", 4.6, 2.0, 2.6);
  s.addShape(pres.ShapeType.rect, { x: 1.6, y: 3.3, w: 10.1, h: 3.0, fill: { color: NOTE.cream }, line: { type: "none" }, shadow: shadow(), rotate: -1 });
  tape(s, "kraft", 6.0, 3.05, 1.6, -5);
  s.addText("お題・制限時間・判定方法をここに書く", { x: 1.6, y: 3.3, w: 10.1, h: 3.0, isTextBox: true, margin: 0, fontFace: PEN, fontSize: 18, color: SOFT, align: "center", valign: "middle", rotate: -1 });
}

{
  const s = partSlide("Result", "中村家、新メンバー発表", "おめでとうございます！", "勝者を呼んで景品を渡す。写真を撮るなら司会が誘導する。");
  todo(s, "発表の演出と景品を決める", (W - 3.4) / 2, 5.5, 3.4);
}

/* ============================================================
   Part 3 ビンゴ大会
   ============================================================ */
partSlide("Part 3", "ビンゴ大会", "カードの準備はいいですか？", "第3部。抽選は別アプリで行う。");

rulesSlide("ルール", [
  "番号が出たら、カードの数字に穴をあけてね",
  "リーチになったら「リーチ！」と大きな声で",
  "ビンゴになったら前へ。早い人から景品を選べます",
], "ルール説明のあと、抽選アプリに切り替える。", "選択制か順位制かを決める");

{
  const s = newSlide("景品を見せてから抽選に入る。ここから先はビンゴアプリの画面に切り替える。");
  marked(s, "景品", 0.9, 0.8, 4, 38);
  todo(s, "景品名を埋める", 3.9, 1.0, 2.6);
  const ranks = [
    { r: "1st", c: NOTE.cream, tp: "kraft", rot: -1.5 }, { r: "2nd", c: NOTE.pink, tp: "blue", rot: 1.2 },
    { r: "3rd", c: NOTE.green, tp: "pink", rot: -1.5 }, { r: "4th", c: NOTE.blue, tp: "kraft", rot: 1.2 },
    { r: "5th", c: NOTE.cream, tp: "pink", rot: -1.5 }, { r: "…", c: NOTE.green, tp: "blue", rot: 1.2 },
  ];
  ranks.forEach((it, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 0.95 + col * 4.1, y = 2.15 + row * 2.35, w = 3.6, h = 1.95;
    s.addShape(pres.ShapeType.rect, { x, y, w, h, fill: { color: it.c }, line: { type: "none" }, shadow: shadow(), rotate: it.rot });
    tape(s, it.tp, x + w / 2 - 0.6, y - 0.2, 1.2, it.rot - 5);
    s.addText(it.r, { x: x + 0.25, y: y + 0.3, w: w - 0.5, h: 0.55, isTextBox: true, margin: 0, fontFace: LATIN, fontSize: 30, bold: true, color: MARKER, rotate: it.rot });
    s.addText(i === 5 ? "参加賞など" : "景品名を入れる", { x: x + 0.25, y: y + 0.95, w: w - 0.5, h: 0.6, isTextBox: true, margin: 0, fontFace: PEN, fontSize: 17, color: SOFT, rotate: it.rot });
  });
}

{
  const s = newSlide("運営メモ：ここでビンゴアプリの画面に切り替える。終わったら次のスライドに戻る。このスライドは本番前に非表示にしてもよい。");
  star(s, 1.2, 1.2, 0.6); heart(s, 11.6, 1.3, 0.62);
  eyebrow(s, "Staff only", 0, 1.9, { w: W, align: "center", size: 26, color: SOFT });
  marked(s, "ここで抽選アプリに切り替え", 0, 2.6, W, 40, "center");
  s.addText("抽選が終わったら、このスライドの次に進む", { x: 0, y: 4.15, w: W, h: 0.6, isTextBox: true, margin: 0, fontFace: PEN, fontSize: 18, color: SOFT, align: "center" });
  todo(s, "本番前に非表示にしてもOK", (W - 3.4) / 2, 5.1, 3.4);
}

/* ============================================================
   エンディング
   ============================================================ */
{
  const s = partSlide("Closing", "新郎新婦からひとこと", "", "マイクを新郎新婦に渡す。");
  s.addText("挨拶の順番（新郎→新婦、または連名）と、写真撮影の案内をここに書く",
    { x: 2.6, y: 5.2, w: 8.1, h: 0.85, isTextBox: true, margin: 8, fontFace: PEN, fontSize: 14, color: SOFT, align: "center",
      shape: pres.ShapeType.roundRect, rectRadius: 0.06, fill: { color: "FFFDF7" }, line: { color: SKY, width: 1.25, dashType: "dash" } });
}

{
  const s = newSlide("お開き。BGMを上げて、集合写真の案内をする。");
  garland(s);
  heart(s, 1.15, 5.85, 0.7); heart(s, 11.6, 5.7, 0.62);
  eyebrow(s, "Thank you!!", 0, 1.85, { w: W, align: "center", size: 34 });
  s.addText(
    [{ text: "新郎", options: { fontFace: HAND, fontSize: 54, color: INK } },
     { text: " & ", options: { fontFace: LATIN, fontSize: 68, color: "E7A9A6", bold: true } },
     { text: "新婦", options: { fontFace: HAND, fontSize: 54, color: INK } }],
    { x: 0, y: 2.5, w: W, h: 1.4, isTextBox: true, align: "center", valign: "middle", margin: 0 }
  );
  s.addText("今日はありがとうございました", { x: 0, y: 4.0, w: W, h: 0.6, isTextBox: true, margin: 0, fontFace: HAND, fontSize: 26, color: INK, align: "center" });
  s.addText("末永くお幸せに", { x: 0, y: 4.7, w: W, h: 0.5, isTextBox: true, margin: 0, fontFace: PEN, fontSize: 18, color: SOFT, align: "center" });
}

const out = path.join(__dirname, "結婚式2次会スライド.pptx");
pres.writeFile({ fileName: out }).then(() => console.log("written:", out));
