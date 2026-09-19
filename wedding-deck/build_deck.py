# -*- coding: utf-8 -*-
"""結婚式二次会用 ○×クイズ／中村になろうよ／ビンゴ進行スライドを組み立てる。

構成と演出のテンション感は、お預かりした『チーム対抗企画スライド 3』を下敷きにしている：
  問題 → クリックで10秒カウントダウン（BGM付き）→ クリックで正解発表（効果音＋赤枠点滅）

効果音は「押していくと勝手に流れる」方針。
  ・問題スライド … 1クリック目でカウントダウンBGM、2クリック目で正解発表音
  ・それ以外     … スライドを表示した瞬間に自動再生
"""
from __future__ import annotations

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Pt

import content
from pptx_motion import AudioLibrary, Timeline, apply_timing, apply_transition

ROOT = Path(__file__).parent
IMG = ROOT / "assets" / "img"
SFX = ROOT / "assets" / "sfx"
OUT = ROOT / "build" / "結婚式_マルバツクイズ＆ビンゴ.pptx"
BGM = "bgm_nakamura_ni_narouyo_PLACEHOLDER.mp3"

SLIDE_W, SLIDE_H = 12192000, 6858000

# ---- 配色 ----------------------------------------------------------------
INK = RGBColor(0x3A, 0x2E, 0x2A)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
ROSE = RGBColor(0xD9, 0x4F, 0x70)        # ○ 側
NAVY = RGBColor(0x34, 0x55, 0x8B)        # × 側
GOLD = RGBColor(0xC9, 0xA2, 0x27)
DEEP = RGBColor(0x96, 0x2C, 0x42)
ALERT = RGBColor(0xFF, 0x00, 0x00)
SAND = RGBColor(0xF6, 0xDF, 0xC8)

JP = "Meiryo"

# ---- レイアウト（EMU） ---------------------------------------------------
BADGE = dict(x=620000, y=300000, cx=2500000, cy=820000)
TIMER = dict(x=10400000, y=250000, cx=1300000, cy=1300000)
Q_TEXT = dict(x=900000, y=1620000, cx=10392000, cy=1500000)
PANEL = dict(y=3300000, cy=2050000, cx=4250000, lx=1150000, rx=6792000)
RIBBON = dict(x=1150000, y=5550000, cx=9892000, cy=900000)
MARK = 1000000

# 写真4枚くらべレイアウト
P4_TEXT = dict(x=3300000, y=820000, cx=6900000, cy=900000)
P4_PANEL = dict(lx=1150000, rx=6392000, y=1880000, cx=4650000, cy=3720000)
P4_PHOTO = dict(cy=2300000, cx=1533000, y=2600000, gap=140000)
P4_RIBBON = dict(x=1150000, y=5750000, cx=9892000, cy=850000)
P4_MARK = 440000
PAD = 110000                             # 正解の赤枠がパネルからはみ出す量


def _next_id(slide):
    return slide.shapes._spTree.max_shape_id + 1


def add_bg(slide, name):
    pic = slide.shapes.add_picture(str(IMG / name), 0, 0, SLIDE_W, SLIDE_H)
    slide.shapes._spTree.remove(pic._element)
    slide.shapes._spTree.insert(2, pic._element)   # 背景として最背面へ
    return pic


def textbox(slide, x, y, cx, cy, lines, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE):
    """lines は (文字列, ポイント, 太字, 色) のリスト。改行は \\n で表現する。"""
    box = slide.shapes.add_textbox(Emu(x), Emu(y), Emu(cx), Emu(cy))
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Emu(90000)
    tf.margin_top = tf.margin_bottom = Emu(45000)
    first = True
    for text, size, bold, color in lines:
        for chunk in text.split("\n"):
            p = tf.paragraphs[0] if first else tf.add_paragraph()
            first = False
            p.alignment = align
            p.line_spacing = 1.18
            r = p.add_run()
            r.text = chunk
            r.font.size = Pt(size)
            r.font.bold = bold
            r.font.color.rgb = color
            r.font.name = JP
            r.font._rPr.set("lang", "ja-JP")
            r.font._rPr.set("altLang", "en-US")
    return box


def rounded(slide, x, y, cx, cy, fill, line, line_w=4.5, radius=0.12):
    sh = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Emu(x), Emu(y), Emu(cx), Emu(cy))
    sh.adjustments[0] = radius
    if fill is None:
        sh.fill.background()
    else:
        sh.fill.solid()
        sh.fill.fore_color.rgb = fill
    sh.line.color.rgb = line
    sh.line.width = Pt(line_w)
    sh.shadow.inherit = False
    sh.text_frame.word_wrap = True
    return sh


def fill_shape_text(shape, lines, align=PP_ALIGN.CENTER):
    tf = shape.text_frame
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.margin_top = tf.margin_bottom = Emu(45000)
    first = True
    for text, size, bold, color in lines:
        for chunk in text.split("\n"):
            p = tf.paragraphs[0] if first else tf.add_paragraph()
            first = False
            p.alignment = align
            p.line_spacing = 1.05
            r = p.add_run()
            r.text = chunk
            r.font.size = Pt(size)
            r.font.bold = bold
            r.font.color.rgb = color
            r.font.name = JP
    return shape


def add_mark(slide, kind, cx_center, cy_center, size):
    """○と×を文字ではなく図形で描く。会場の後ろの席からでも読めるように。"""
    def paint(sh, color):
        sh.fill.solid()
        sh.fill.fore_color.rgb = color
        sh.line.fill.background()
        sh.shadow.inherit = False
        return sh

    if kind == "maru":
        x, y = cx_center - size // 2, cy_center - size // 2
        ring = slide.shapes.add_shape(MSO_SHAPE.DONUT, Emu(x), Emu(y), Emu(size), Emu(size))
        ring.adjustments[0] = 0.13
        return paint(ring, ROSE)

    # × は「プラス図形を回転」だと太りすぎるので、棒 2 本を交差させて描く
    length, thick = int(size * 0.94), int(size * 0.20)
    last = None
    for rot in (45, 135):
        bar = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            Emu(cx_center - length // 2), Emu(cy_center - thick // 2), Emu(length), Emu(thick),
        )
        bar.adjustments[0] = 0.5
        bar.rotation = rot
        last = paint(bar, NAVY)
    return last


def add_notes(slide, text):
    slide.notes_slide.notes_text_frame.text = text


def add_timer(slide):
    """10秒カウントダウンの丸と、0〜10 の数字テキストを重ねて置く。"""
    oval = slide.shapes.add_shape(
        MSO_SHAPE.OVAL, Emu(TIMER["x"]), Emu(TIMER["y"]), Emu(TIMER["cx"]), Emu(TIMER["cy"])
    )
    oval.fill.solid()
    oval.fill.fore_color.rgb = DEEP
    oval.line.color.rgb = WHITE
    oval.line.width = Pt(5)
    oval.shadow.inherit = False

    numbers = []
    for n in range(10, -1, -1):
        box = slide.shapes.add_textbox(
            Emu(TIMER["x"]), Emu(TIMER["y"] + 190000), Emu(TIMER["cx"]), Emu(900000)
        )
        tf = box.text_frame
        tf.word_wrap = False
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = str(n)
        r.font.size = Pt(54)
        r.font.bold = True
        r.font.color.rgb = WHITE
        r.font.name = "Arial"
        numbers.append(box.shape_id)
    return oval.shape_id, numbers


# --------------------------------------------------------------------------
def _standard_choices(slide, q):
    textbox(slide, Q_TEXT["x"], Q_TEXT["y"], Q_TEXT["cx"], Q_TEXT["cy"],
            [(q["statement"], 33, True, INK)])
    panels = {}
    for kind, px, side in (("maru", PANEL["lx"], "左"), ("batsu", PANEL["rx"], "右")):
        panel = rounded(slide, px, PANEL["y"], PANEL["cx"], PANEL["cy"], WHITE,
                        ROSE if kind == "maru" else NAVY, 6)
        add_mark(slide, kind, px + PANEL["cx"] // 2, PANEL["y"] + 640000, MARK)
        textbox(slide, px, PANEL["y"] + 1290000, PANEL["cx"], 640000,
                [(f"画面に向かって {side} へ移動", 19, True, INK)])
        panels[kind] = panel
    return panels, RIBBON, 23


def _photo4_choices(slide, q):
    """4枚の写真を2枚ずつ並べて「本物はどっち？」を出す。"""
    textbox(slide, P4_TEXT["x"], P4_TEXT["y"], P4_TEXT["cx"], P4_TEXT["cy"],
            [(q["statement"], 25, True, INK)])
    panels = {}
    for kind, px, side in (("maru", P4_PANEL["lx"], "左"), ("batsu", P4_PANEL["rx"], "右")):
        panel = rounded(slide, px, P4_PANEL["y"], P4_PANEL["cx"], P4_PANEL["cy"], WHITE,
                        ROSE if kind == "maru" else NAVY, 6)
        add_mark(slide, kind, px + P4_PANEL["cx"] // 2, P4_PANEL["y"] + 250000, P4_MARK)
        span = P4_PHOTO["cx"] * 2 + P4_PHOTO["gap"]
        start = px + (P4_PANEL["cx"] - span) // 2
        for i, name in enumerate(content.PHOTO4[kind]):
            pic = slide.shapes.add_picture(
                str(IMG / name),
                Emu(start + i * (P4_PHOTO["cx"] + P4_PHOTO["gap"])), Emu(P4_PHOTO["y"]),
                Emu(P4_PHOTO["cx"]), Emu(P4_PHOTO["cy"]),
            )
            pic.line.color.rgb = ROSE if kind == "maru" else NAVY
            pic.line.width = Pt(2)
        textbox(slide, px, P4_PHOTO["y"] + P4_PHOTO["cy"] + 80000, P4_PANEL["cx"], 480000,
                [(f"画面に向かって {side} へ移動", 17, True, INK)])
        panels[kind] = panel
    return panels, P4_RIBBON, 21


def quiz_slide(prs, audio, index, q):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(slide, "bg_quiz.png")

    badge = rounded(slide, BADGE["x"], BADGE["y"], BADGE["cx"], BADGE["cy"], DEEP, GOLD, 3, 0.5)
    fill_shape_text(badge, [("最終問題" if q.get("final") else f"第 {index} 問", 26, True, WHITE)])

    build = _photo4_choices if q.get("layout") == "photo4" else _standard_choices
    panels, ribbon_geo, reveal_pt = build(slide, q)

    oval_id, number_ids = add_timer(slide)

    # 正解の赤枠（2クリック目で出現して点滅する）
    correct = panels[q["answer"]]
    frame = rounded(
        slide,
        correct.left - PAD, correct.top - PAD,
        correct.width + PAD * 2, correct.height + PAD * 2,
        None, ALERT, 7.5,
    )
    ribbon = rounded(slide, ribbon_geo["x"], ribbon_geo["y"], ribbon_geo["cx"],
                     ribbon_geo["cy"], DEEP, GOLD, 3, 0.25)
    fill_shape_text(ribbon, [(q["reveal"], reveal_pt, True, WHITE)])

    sid = _next_id(slide)
    cd_id, cd_dur = audio.add(slide, str(SFX / "sfx_countdown10.mp3"), "カウントダウンBGM", sid, 0)
    ans_id, ans_dur = audio.add(slide, str(SFX / "sfx_answer.mp3"), "正解発表効果音", sid + 1, 1)

    tl = Timeline()
    tl.group().countdown(oval_id, number_ids, cd_id, cd_dur)
    tl.group().play(ans_id, ans_dur).appear(frame.shape_id).pulse(frame.shape_id) \
              .appear(ribbon.shape_id)
    apply_transition(slide, "fade")
    apply_timing(slide, tl)

    add_notes(slide, "\n".join([
        f'【第{index}問】正解：{"○" if q["answer"] == "maru" else "×"}',
        "① 問題を読み上げる",
        "② クリック → 10秒カウントダウン（BGMが鳴ります）。会場の皆さまに移動していただく",
        "③ クリック → 正解の赤枠が点滅＋効果音、解説が出ます",
        "",
        q.get("note", ""),
    ]).strip())
    return slide


def section_slide(prs, audio, head, sub=None, bg="bg_section.png", sfx=None, note=None):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(slide, bg)
    textbox(slide, 900000, 2150000, 10392000, 1450000, [(head, 56, True, WHITE)])
    if sub:
        textbox(slide, 900000, 3750000, 10392000, 700000, [(sub, 22, False, SAND)])
    apply_transition(slide, "fade")
    if sfx:
        spid, dur = audio.add(slide, str(SFX / sfx), "セクション効果音", _next_id(slide))
        tl = Timeline()
        tl.group(auto=True).play(spid, dur)   # スライドを開いた瞬間に鳴る
        apply_timing(slide, tl)
    if note:
        add_notes(slide, note)
    return slide


def bullet_slide(prs, head, title, lines, bg="bg_quiz.png", move=False, big=None):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(slide, bg)
    badge = rounded(slide, BADGE["x"], BADGE["y"], BADGE["cx"], BADGE["cy"], DEEP, GOLD, 3, 0.5)
    fill_shape_text(badge, [(head, 24, True, WHITE)])
    textbox(slide, 900000, 1250000, 10392000, 1000000, [(title, 40, True, DEEP)])

    if move:
        for kind, px, arrow in (("maru", 1150000, "← 画面に向かって 左 へ"),
                                ("batsu", 6792000, "画面に向かって 右 へ →")):
            rounded(slide, px, 2600000, 4250000, 2350000, WHITE,
                    ROSE if kind == "maru" else NAVY, 6)
            add_mark(slide, kind, px + 2125000, 3300000, 1150000)
            textbox(slide, px, 4180000, 4250000, 640000, [(arrow, 21, True, INK)])
        textbox(slide, 900000, 5150000, 10392000, 700000,
                [("※ 迷ったときは、まわりの流れに乗ってしまってOKです🙆", 18, True, INK)])
    elif big:
        textbox(slide, 900000, 2400000, 10392000, 2600000, [(big, 60, True, DEEP)])
    else:
        textbox(slide, 1300000, 2350000, 9600000, 3400000,
                [(f"・{t}", 25, False, INK) for t in lines],
                align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.MIDDLE)
    return slide


def bingo_slide(prs, audio, item):
    slide = bullet_slide(prs, "ビンゴ大会", item["title"], item.get("lines", []),
                         bg="bg_bingo.png", big=item.get("big"))
    name = "ドラムロール" if item["sfx"] == "drumroll" else "ファンファーレ"
    spid, dur = audio.add(slide, str(SFX / f"sfx_{item['sfx']}.mp3"), name, _next_id(slide))
    tl = Timeline()
    tl.group(auto=True).play(spid, dur)   # スライドが切り替わるたびに音が鳴る
    apply_transition(slide, "push")
    apply_timing(slide, tl)
    add_notes(slide, f"スライドを表示すると自動で「{name}」が鳴ります。")
    return slide


def nakamura_slide(prs, audio):
    """「中村になろうよ」。スライドを出した瞬間にBGMが流れ出す。"""
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(slide, "bg_title.png")
    textbox(slide, 900000, 1250000, 10392000, 800000, [("CEREMONY", 24, True, GOLD)])
    textbox(slide, 900000, 2050000, 10392000, 1500000, [("中村になろうよ", 66, True, DEEP)])
    textbox(slide, 900000, 4050000, 10392000, 1100000,
            [("{{この時間の演出・ひとこと}}", 26, True, INK)])

    spid, dur = audio.add(slide, str(SFX / BGM), "中村になろうよ BGM", _next_id(slide))
    tl = Timeline()
    tl.group(auto=True).play(spid, dur)
    apply_transition(slide, "fade")
    apply_timing(slide, tl)
    add_notes(slide, "\n".join([
        "スライドを表示した瞬間にBGMが自動再生されます（クリック不要）。",
        "※ 今入っているのは無音のダミー音源です。本番までに差し替えが必要です。",
        "",
        "【音源の差し替え手順】",
        "1. スライドの左外（グレー部分）にあるスピーカーアイコンを選択して削除",
        "2. [挿入]→[オーディオ]→[このコンピューター上のオーディオ] でインスト音源を挿入",
        "3. 挿入したスピーカーアイコンをスライドの外へドラッグして見えない位置に移動",
        "4. 音声を選択 →[再生]タブ→[開始]を「自動」にする",
        "   （複数スライドにまたがって流したい場合は「スライド切り替え後も再生」にチェック）",
        "",
        "※ 楽曲そのものはこちらではダウンロードできません（著作権のため）。",
        "　 音源をお送りいただければ、この作業込みで組み込んだものをお渡しします。",
    ]))
    return slide


def build():
    prs = Presentation()
    prs.slide_width, prs.slide_height = SLIDE_W, SLIDE_H
    audio = AudioLibrary(prs, str(IMG / "audio_icon.png"))

    # --- 表紙 ---
    title = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(title, "bg_title.png")
    textbox(title, 900000, 1500000, 10392000, 900000,
            [("新郎新婦のことどれだけ知ってる？", 26, True, GOLD)])
    textbox(title, 900000, 2400000, 10392000, 1600000, [("○× クイズ大会", 68, True, DEEP)])
    textbox(title, 900000, 4200000, 10392000, 900000,
            [("→ 中村になろうよ → ビンゴ大会 🎉", 28, True, INK)])
    apply_transition(title, "fade")

    # --- ルール説明 ---
    for r in content.RULES:
        bullet_slide(prs, r["head"], r["title"], r.get("lines", []), move=r.get("move", False))

    # --- ① ○×クイズ ---
    section_slide(prs, audio, "○×クイズ", "さあ、スタートです！", sfx="sfx_answer.mp3")
    for i, q in enumerate(content.QUIZ, start=1):
        quiz_slide(prs, audio, i, q)

    section_slide(prs, audio, "結果発表", "最後まで勝ち残ったのは…？", sfx="sfx_drumroll.mp3")
    win = bullet_slide(prs, "結果発表", "優勝！", [], big="{{優勝者のお名前}} 様")
    apply_transition(win, "fade")
    add_notes(win, "{{優勝者のお名前}} を当日その場で入力するか、口頭で読み上げてください。")

    # --- ② 中村になろうよ ---
    nakamura_slide(prs, audio)

    # --- ③ ビンゴ大会 ---
    section_slide(prs, audio, "ビンゴ大会", "お手元のカードをご用意ください🎱",
                  sfx="sfx_drumroll.mp3")
    for item in content.BINGO:
        bingo_slide(prs, audio, item)

    # --- エンディング ---
    end = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(end, "bg_title.png")
    textbox(end, 900000, 1900000, 10392000, 1600000,
            [("本日はご列席いただき\nありがとうございました", 42, True, DEEP)])
    textbox(end, 900000, 3900000, 10392000, 1200000,
            [("これからもふたりをよろしくお願いします🤍", 24, True, INK)])
    apply_transition(end, "fade")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(OUT))
    print(f"{OUT.name}  ({OUT.stat().st_size / 1024 / 1024:.1f} MB, {len(prs.slides._sldIdLst)} 枚)")


if __name__ == "__main__":
    build()
