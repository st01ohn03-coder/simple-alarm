/* ============================================================
   いきなりPDF Ver.13 COMPLETE — Amazon 商品動画 タイムライン
   ------------------------------------------------------------
   すべてのアニメーションは render(t) が時刻 t から決定的に
   算出する（CSS transition / animation は一切使わない）。
   これにより Playwright から 1 フレームずつ正確に seek して
   キャプチャできる。
   ============================================================ */
(function () {
  'use strict';

  var FPS = 30;
  var DUR = 39.4;

  /* ---------- 数学ヘルパ ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  /** t を [a,b] の 0→1 に正規化 */
  function span(t, a, b) { return b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a), 0, 1); }
  function easeOut(k) { return 1 - Math.pow(1 - k, 3); }
  function easeOutQuint(k) { return 1 - Math.pow(1 - k, 5); }
  function easeInOut(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
  function easeBack(k) { var c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); }

  /** 要素に opacity / transform をまとめて適用 */
  function set(el, o, tx, ty, sc, rot) {
    if (!el) return;
    el.style.opacity = o;
    var tr = '';
    if (tx || ty) tr += 'translate3d(' + (tx || 0) + 'rem,' + (ty || 0) + 'rem,0) ';
    if (sc !== undefined && sc !== 1) tr += 'scale(' + sc + ') ';
    if (rot) tr += 'rotate(' + rot + 'deg) ';
    el.style.transform = tr || 'none';
  }

  /** 遅延つきで「下から出る」定型モーション */
  function rise(el, t, start, dur, dy) {
    var k = easeOut(span(t, start, start + (dur || 0.5)));
    set(el, k, 0, lerp(dy === undefined ? 3.2 : dy, 0, k));
    return k;
  }

  /* 行頭禁則文字（これらは直前の文字にくっつける） */
  var NO_LINE_START = '、。，．,.」』）〉》】〕］｝!?！？：；:;・ー〜…‥%％゛゜ゝゞ々ぁぃぅぇぉっゃゅょァィゥェォッャュョ';

  /* ---------- テキストを1文字ずつに分解 ---------- */
  function splitChars(root) {
    var out = [];
    var last = null;            // 直前に作った文字 span（ノードをまたいで保持）
    (function walk(node) {
      var kids = Array.prototype.slice.call(node.childNodes);
      kids.forEach(function (n) {
        if (n.nodeType === 3) {
          var txt = n.nodeValue;
          if (!txt.trim()) return;
          var frag = document.createDocumentFragment();
          for (var i = 0; i < txt.length; i++) {
            var ch = txt[i];
            // 1文字ずつ inline-block にすると禁則処理が効かなくなるので、
            // 行頭に来てはいけない文字は直前の文字と同じ span にまとめる。
            if (last && NO_LINE_START.indexOf(ch) > -1) {
              last.textContent += ch;
              continue;
            }
            var sp = document.createElement('span');
            sp.className = 'ch';
            sp.textContent = ch;
            frag.appendChild(sp);
            out.push(sp);
            last = sp;
          }
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.tagName === 'BR') {
          last = null;
        } else if (n.nodeType === 1) {
          walk(n);
        }
      });
    })(root);
    return out;
  }

  /** 文字を順番に立ち上げる */
  function typeIn(chars, t, start, step, dur) {
    step = step || 0.028; dur = dur || 0.34;
    for (var i = 0; i < chars.length; i++) {
      var k = easeOut(span(t, start + i * step, start + i * step + dur));
      var c = chars[i];
      c.style.opacity = k;
      c.style.transform = 'translate3d(0,' + lerp(1.1, 0, k) + 'rem,0)';
    }
  }

  /* ---------- DOM 参照 ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage');
  var notesEl = $('notes');
  var wipe = $('wipe');

  // ナレーション（tools/narration.py の CUES）と同じ区切り。
  // どちらかを変えたら、もう一方も必ず合わせること。
  var SCENES = [
    { el: $('s1'), a: 0.00,  b: 4.30 },   // 4.30s
    { el: $('s2'), a: 4.30,  b: 8.40 },   // 4.10s
    { el: $('s3'), a: 8.40,  b: 14.30 },  // 5.90s
    { el: $('s4'), a: 14.30, b: 18.70 },  // 4.40s
    { el: $('s5'), a: 18.70, b: 23.90 },  // 5.20s
    { el: $('s6'), a: 23.90, b: 30.70 },  // 6.80s
    { el: $('s7'), a: 30.70, b: 36.00 },  // 5.30s
    { el: $('s8'), a: 36.00, b: 39.40 }   // 3.40s
  ];

  /* ---------- 注記（景表法・根拠表示） ---------- */
  var NOTE1 = '※1 第三者機関の有力家電量販店の実績データをもとに「PCソフト／ビジネス」から「PDF」を抽出し自社集計。メーカー別数量シェア／2010〜2024年';
  var NOTE2 = '※2 同調査によるメーカー別数量シェア／2024年4月〜2025年3月';
  var NOTE3 = '※3 2025年8月時点 ソースネクスト調べ（パッケージ版・ダウンロード版・法人ライセンス版の累計）';
  var NOTE_SUB = '※ 搭載機能は製品により異なります。サブスクリプション型製品との比較は支払い方式の違いを示すもので、金額を表すものではありません。';
  var NOTES = [
    { a: 5.00,  b: 8.40,  text: NOTE1 },
    { a: 30.70, b: 36.00, text: NOTE_SUB },
    { a: 36.80, b: 39.40, text: NOTE1 + '　' + NOTE3 }
  ];

  /* ---------- 動的に作るパーツ ---------- */
  var subBars = [], onceBars = [];
  (function buildBars() {
    var host = $('s7subbars');
    var years = ['1年目', '2年目', '3年目', '4年目', '5年目'];
    years.forEach(function (y, i) {
      var d = document.createElement('div');
      d.className = 'bar yearly' + (i === years.length - 1 ? ' last' : '');
      d.style.height = '3.0rem';
      d.textContent = y;
      host.appendChild(d);
      subBars.push(d);
    });
    var h2 = $('s7oncebars');
    var d2 = document.createElement('div');
    d2.className = 'bar once';
    d2.style.height = '3.0rem';
    d2.textContent = '最初の1回だけ';
    h2.appendChild(d2);
    onceBars.push(d2);
  })();

  /* ---------- 文字分解（初期化時に一度だけ） ---------- */
  var CH = {
    s1h: splitChars($('s1h')),
    s3h: splitChars($('s3h')),
    s4h: splitChars($('s4h')),
    s5h: splitChars($('s5h')),
    s6h: splitChars($('s6h')),
    s7h: splitChars($('s7h'))
  };

  var chips = Array.prototype.slice.call($('s1chips').children);
  var tags = Array.prototype.slice.call($('s2tags').children);
  var fcards = Array.prototype.slice.call($('s3grid').children);
  var seccards = Array.prototype.slice.call($('s5row').children);
  var stepEls = Array.prototype.slice.call($('s6steps').children);
  var proofs = Array.prototype.slice.call($('s8proof').children);
  var specs = Array.prototype.slice.call($('s8specs').children);

  /* ============================================================
     各シーン
     ============================================================ */

  function sceneS1(τ) {
    typeIn(CH.s1h, τ, 0.25, 0.030, 0.36);
    // 背景ストライプがゆっくり流れる
    var k = span(τ, 0, 4.3);
    var st1 = $('s1stripe'), st2 = $('s1stripe2');
    st1.style.opacity = 0.55 * easeOut(span(τ, 0.1, 0.9));
    st1.style.transform = 'rotate(-24deg) translate3d(' + lerp(-6, 6, k) + 'rem,0,0)';
    st2.style.opacity = 0.32 * easeOut(span(τ, 0.3, 1.1));
    st2.style.transform = 'rotate(-24deg) translate3d(' + lerp(6, -6, k) + 'rem,0,0)';
    // 悩みチップが順に出る
    chips.forEach(function (c, i) {
      var st = 1.55 + i * 0.22;
      var kk = easeBack(span(τ, st, st + 0.42));
      c.style.opacity = clamp(span(τ, st, st + 0.22), 0, 1);
      c.style.transform = 'translate3d(0,' + lerp(2.6, 0, clamp(kk, 0, 1.4)) + 'rem,0) scale(' + lerp(0.86, 1, clamp(kk, 0, 1.2)) + ')';
    });
    // 最後にわずかにズーム（次シーンへの押し出し）
    var z = easeInOut(span(τ, 3.75, 4.30));
    $('s1').style.transform = 'scale(' + lerp(1, 1.06, z) + ')';
  }

  function sceneS2(τ) {
    // パッケージが奥から出る
    var k = easeOutQuint(span(τ, 0.05, 0.85));
    set($('s2pkgwrap'), k, 0, lerp(2.4, 0, k), lerp(0.80, 1, k));
    // テキスト
    rise($('s2brand'), τ, 0.55, 0.45, 1.6);
    var kn = easeOutQuint(span(τ, 0.68, 1.30));
    set($('s2name'), kn, lerp(-3.0, 0, kn), 0, 1);
    var ke = easeOutQuint(span(τ, 0.95, 1.55));
    set($('s2ed'), ke, lerp(-3.0, 0, ke), 0, 1);
    tags.forEach(function (el, i) {
      var st = 1.45 + i * 0.09;
      var kk = easeOut(span(τ, st, st + 0.36));
      el.style.opacity = kk;
      el.style.transform = 'translate3d(0,' + lerp(1.4, 0, kk) + 'rem,0) scale(' + lerp(0.9, 1, kk) + ')';
    });
    // 全体をゆっくり寄せる（生きた画に見せる）
    $('s2reveal').style.transform = 'scale(' + lerp(1, 1.028, span(τ, 0, 4.1)) + ')';
  }

  function sceneS3(τ) {
    rise($('s3eye'), τ, 0.10, 0.45, 1.6);
    typeIn(CH.s3h, τ, 0.24, 0.026, 0.34);
    fcards.forEach(function (c, i) {
      var st = 0.80 + i * 0.17;
      var kk = easeOutQuint(span(τ, st, st + 0.60));
      c.style.opacity = clamp(span(τ, st, st + 0.26), 0, 1);
      c.style.transform = 'translate3d(0,' + lerp(4.2, 0, kk) + 'rem,0) scale(' + lerp(0.94, 1, kk) + ')';
    });
    $('s3grid').style.marginTop = lerp(3.4, 3.0, span(τ, 0, 5.9)) + 'rem';
  }

  function sceneS4(τ) {
    var ko = easeBack(span(τ, 0.06, 0.52));
    $('s4only').style.opacity = clamp(span(τ, 0.06, 0.28), 0, 1);
    $('s4only').style.transform = 'scale(' + lerp(0.7, 1, clamp(ko, 0, 1.25)) + ')';
    typeIn(CH.s4h, τ, 0.34, 0.028, 0.34);
    rise($('s4sub'), τ, 0.95, 0.5, 1.6);
    // スクリーンショットがゆっくり寄る（Ken Burns）
    var kf = easeOutQuint(span(τ, 0.75, 1.45));
    var drift = span(τ, 0.75, 4.4);
    set($('s4frame'), kf, 0, lerp(3.4, 0, kf), lerp(0.94, 1.0, kf) * lerp(1, 1.05, drift));
    // ハイライト枠とコールアウト
    var ks = easeBack(span(τ, 1.75, 2.25));
    $('s4spot').style.opacity = clamp(span(τ, 1.75, 1.98), 0, 1) * (0.82 + 0.18 * Math.sin(τ * 7));
    $('s4spot').style.transform = 'scale(' + lerp(1.22, 1, clamp(ks, 0, 1.2)) + ')';
    var kc = easeBack(span(τ, 2.05, 2.55));
    $('s4call').style.opacity = clamp(span(τ, 2.05, 2.28), 0, 1);
    $('s4call').style.transform = 'translate3d(0,' + lerp(1.4, 0, clamp(kc, 0, 1.2)) + 'rem,0) scale(' + lerp(0.8, 1, clamp(kc, 0, 1.2)) + ')';
  }

  function sceneS5(τ) {
    var ko = easeBack(span(τ, 0.06, 0.52));
    $('s5only').style.opacity = clamp(span(τ, 0.06, 0.28), 0, 1);
    $('s5only').style.transform = 'scale(' + lerp(0.7, 1, clamp(ko, 0, 1.25)) + ')';
    typeIn(CH.s5h, τ, 0.30, 0.030, 0.34);
    seccards.forEach(function (c, i) {
      var st = 0.95 + i * 0.16;
      var kk = easeOutQuint(span(τ, st, st + 0.58));
      c.style.opacity = clamp(span(τ, st, st + 0.26), 0, 1);
      c.style.transform = 'translate3d(0,' + lerp(3.8, 0, kk) + 'rem,0) scale(' + lerp(0.93, 1, kk) + ')';
    });
  }

  function sceneS6(τ) {
    var kn = easeBack(span(τ, 0.05, 0.50));
    $('s6new').style.opacity = clamp(span(τ, 0.05, 0.26), 0, 1);
    $('s6new').style.transform = 'scale(' + lerp(0.6, 1, clamp(kn, 0, 1.3)) + ') rotate(' + lerp(-8, 0, clamp(kn, 0, 1.2)) + 'deg)';
    typeIn(CH.s6h, τ, 0.32, 0.030, 0.34);
    rise($('s6sub'), τ, 0.92, 0.5, 1.6);
    stepEls.forEach(function (el, i) {
      var st = 1.20 + i * 0.20;
      var kk = easeOutQuint(span(τ, st, st + 0.55));
      if (el.classList.contains('arrowdot')) {
        el.style.opacity = kk * 0.9;
        el.style.transform = 'translate3d(' + lerp(-1.2, 0, kk) + 'rem,0,0)';
      } else {
        el.style.opacity = clamp(span(τ, st, st + 0.26), 0, 1);
        el.style.transform = 'translate3d(' + lerp(3.2, 0, kk) + 'rem,0,0) scale(' + lerp(0.95, 1, kk) + ')';
      }
    });
  }

  function sceneS7(τ) {
    rise($('s7eye'), τ, 0.08, 0.42, 1.4);
    typeIn(CH.s7h, τ, 0.22, 0.024, 0.32);
    // サブスクの棒が毎年積み上がる
    subBars.forEach(function (b, i) {
      var st = 0.95 + i * 0.20;
      var kk = easeBack(span(τ, st, st + 0.44));
      b.style.opacity = clamp(span(τ, st, st + 0.20), 0, 1);
      b.style.transform = 'scaleX(' + lerp(0.55, 1, clamp(kk, 0, 1.2)) + ')';
    });
    // 買い切りは1本だけ
    var ko = easeBack(span(τ, 1.05, 1.55));
    onceBars[0].style.opacity = clamp(span(τ, 1.05, 1.28), 0, 1);
    onceBars[0].style.transform = 'scaleX(' + lerp(0.55, 1, clamp(ko, 0, 1.2)) + ')';
    // VS
    var kv = easeBack(span(τ, 0.80, 1.25));
    $('s7vs').style.opacity = clamp(span(τ, 0.80, 1.02), 0, 1);
    $('s7vs').style.transform = 'scale(' + lerp(0.5, 1, clamp(kv, 0, 1.3)) + ')';
    // ラベル
    var cls = $('s7cost').querySelectorAll('.costlabel');
    for (var i = 0; i < cls.length; i++) rise(cls[i], τ, 2.05 + i * 0.12, 0.45, 1.4);
  }

  function sceneS8(τ) {
    var k = easeOutQuint(span(τ, 0.05, 0.75));
    set($('s8reveal'), k, 0, lerp(2.4, 0, k), lerp(0.90, 1, k));
    proofs.forEach(function (c, i) {
      var st = 0.55 + i * 0.15;
      var kk = easeOutQuint(span(τ, st, st + 0.55));
      c.style.opacity = clamp(span(τ, st, st + 0.24), 0, 1);
      c.style.transform = 'translate3d(0,' + lerp(3.2, 0, kk) + 'rem,0) scale(' + lerp(0.94, 1, kk) + ')';
    });
    specs.forEach(function (c, i) {
      var st = 1.25 + i * 0.13;
      var kk = easeBack(span(τ, st, st + 0.46));
      c.style.opacity = clamp(span(τ, st, st + 0.22), 0, 1);
      c.style.transform = 'scale(' + lerp(0.8, 1, clamp(kk, 0, 1.2)) + ')';
    });
    // 最後にゆっくり引く
    $('s8').style.transform = 'scale(' + lerp(1, 1.03, span(τ, 2.2, 3.4)) + ')';
  }

  var RENDERERS = [sceneS1, sceneS2, sceneS3, sceneS4, sceneS5, sceneS6, sceneS7, sceneS8];

  /* ============================================================
     メイン render
     ============================================================ */
  function render(t) {
    t = clamp(t, 0, DUR);

    // --- シーンの表示・非表示（クロスディゾルブ） ---
    SCENES.forEach(function (sc, i) {
      var fin = 0.34, fout = 0.30;
      var vis = 0;
      if (t >= sc.a - fout && t <= sc.b + 0.02) {
        var up = span(t, sc.a, sc.a + fin);
        var dn = 1 - span(t, sc.b - fout, sc.b);
        vis = Math.min(i === 0 ? 1 : up, i === SCENES.length - 1 ? 1 : dn);
        if (i === 0) vis = Math.min(easeOut(span(t, 0, 0.45)), dn);
        if (i === SCENES.length - 1) vis = up;
      }
      sc.el.style.opacity = vis;
      sc.el.style.visibility = vis > 0.002 ? 'visible' : 'hidden';
      if (vis > 0.002) RENDERERS[i](t - sc.a);
    });

    // --- 注記バー ---
    var noteText = '', noteAlpha = 0;
    for (var i = 0; i < NOTES.length; i++) {
      var n = NOTES[i];
      if (t >= n.a - 0.3 && t <= n.b) {
        noteText = n.text;
        noteAlpha = Math.min(span(t, n.a, n.a + 0.3), 1 - span(t, n.b - 0.3, n.b));
      }
    }
    notesEl.textContent = noteText;
    notesEl.style.opacity = clamp(noteAlpha, 0, 1);

    // --- S1 → S2 のブランドワイプ ---
    var w = span(t, 4.02, 4.66);
    if (w > 0 && w < 1) {
      wipe.style.opacity = 1;
      var e = easeInOut(w);
      wipe.style.transform = 'translate3d(' + lerp(-110, 110, e) + '%,0,0) skewX(-12deg)';
    } else {
      wipe.style.opacity = 0;
    }
  }

  /* ---------- キャンバスに合わせて rem を決める ---------- */
  function fit() {
    // 1rem = キャンバス幅の 1% → 16:9 も 1:1 も同じ比率レイアウト
    document.documentElement.style.fontSize = (window.innerWidth / 100) + 'px';
    // 1:1 用のレイアウト切り替え
    var square = (window.innerHeight / window.innerWidth) > 0.9;
    document.body.classList.toggle('square', square);
    [['s2reveal', 'reveal'], ['s8reveal', 'reveal'], ['s3grid', 'fgrid'], ['s4split', 'splitwrap'],
     ['s5row', 'secrow'], ['s6steps', 'steps'], ['s7cost', 'costwrap'],
     ['s8proof', 'proofrow']].forEach(function (p) {
      var el = $(p[0]); if (el) el.classList.toggle('sq', square);
    });
    SCENES.forEach(function (s) { s.el.classList.toggle('sq', square); });
  }

  /* ---------- 外部 API（レンダラが使う） ---------- */
  window.__video = {
    fps: FPS,
    duration: DUR,
    frames: Math.round(DUR * FPS),
    seek: function (t) { fit(); render(t); },
    seekFrame: function (f) { fit(); render(f / FPS); }
  };

  /* ---------- ブラウザで開いたときのプレビュー再生 ---------- */
  fit();
  render(0);
  window.addEventListener('resize', function () { fit(); render(window.__previewT || 0); });

  if (!window.__CAPTURE__) {
    var t0 = null;
    (function loop(ts) {
      if (t0 === null) t0 = ts;
      var t = ((ts - t0) / 1000) % DUR;
      window.__previewT = t;
      render(t);
      requestAnimationFrame(loop);
    })(performance.now());
  }
})();
