# -*- coding: utf-8 -*-
"""結婚式二次会用 2択クイズ／中村になろうよ／ビンゴ進行スライドを組み立てる。

構成と演出のテンション感は、お預かりした『チーム対抗企画スライド 3』を下敷きにしている：
  問題スライド（10秒カウントダウン＋BGM）→ 答えスライド（効果音＋正解表示）
  答えが先に見えてしまわないよう、問題と答えはスライドを分けている。

効果音は「押していくと勝手に流れる」方針。
  ・問題スライド … 1クリック目でカウントダウンBGM
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
OUT = ROOT / "build" / "結婚式_2択クイズ＆ビンゴ.pptx"
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

# 問題スライド
Q_TEXT = dict(x=900000, y=1400000, cx=10392000, cy=1300000)
Q_PANEL = dict(y=2900000, cy=2650000, cx=4650000, lx=1150000, rx=6392000)
Q_ARROW = dict(cx=1200000, cy=600000, y=3080000)
Q_ANSWER = dict(y=3780000, cy=1300000)
Q_SIDELBL = dict(y=5080000, cy=420000)
Q_HINT = dict(x=1150000, y=5750000, cx=9892000, cy=750000)
# 問題スライド（写真4枚くらべ）。問題文が短いぶんパネルを高くとる
Q4_TEXT = dict(x=900000, y=1150000, cx=10392000, cy=1100000)
Q4_PANEL = dict(y=2400000, cy=3150000, cx=4650000, lx=1150000, rx=6392000)
Q4_PHOTO = dict(cx=1334000, cy=2000000, y=2560000, gap=120000)
Q4_ARROW = dict(cx=1000000, cy=460000, y=4650000)
Q4_SIDELBL = dict(y=5120000, cy=400000)

# 答えスライド
A_LABEL = dict(x=900000, y=1180000, cx=10392000, cy=760000)
A_BADGE = dict(x=620000, y=300000, cx=3350000, cy=820000)
A_ARROW = dict(cx=1500000, cy=700000, y=2080000)
A_PANEL = dict(x=2596000, y=2820000, cx=7000000, cy=1700000)
A_RIBBON = dict(x=1150000, y=4820000, cx=9892000, cy=1050000)
# 答えスライド（写真4枚くらべ）
A4_ARROW_Y = 1900000
A4_PANEL = dict(x=3396000, y=2620000, cx=5400000, cy=2450000)
A4_PHOTO = dict(cx=1333000, cy=2000000, y=2780000, gap=140000)
A4_RIBBON = dict(x=1150000, y=5250000, cx=9892000, cy=1000000)

SIDE_JP = dict(left="左", right="右")
SIDE_COLOR = dict(left=None, right=None)      # build() で ROSE / NAVY を入れる


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


def add_arrow(slide, side, cx_center, cy_top, cx, cy):
    """「左へ」「右へ」を矢印の図形で描く。会場の後ろの席からでも一目で分かるように。"""
    shape = MSO_SHAPE.LEFT_ARROW if side == "left" else MSO_SHAPE.RIGHT_ARROW
    sh = slide.shapes.add_shape(shape, Emu(cx_center - cx // 2), Emu(cy_top), Emu(cx), Emu(cy))
    sh.fill.solid()
    sh.fill.fore_color.rgb = SIDE_COLOR[side]
    sh.line.fill.background()
    sh.shadow.inherit = False
    return sh


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
def _choice_texts(q):
    """(左に出す文言, 右に出す文言) を返す。"""
    if q["side"] == "left":
        return q["correct"], q["dummy"]
    return q["dummy"], q["correct"]


def _photo_names(q, side):
    """その側に並べる写真のファイル名。"""
    key = "correct" if side == q["side"] else "dummy"
    return content.PHOTO4[key]


def quiz_question_slide(prs, audio, index, q):
    """問題だけを出すスライド。答えは一切載せない。"""
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(slide, "bg_quiz.png")
    photo = q.get("layout") == "photo4"

    badge = rounded(slide, BADGE["x"], BADGE["y"], BADGE["cx"], BADGE["cy"], DEEP, GOLD, 3, 0.5)
    fill_shape_text(badge, [("最終問題" if q.get("final") else f"第 {index} 問", 26, True, WHITE)])

    txt = Q4_TEXT if photo else Q_TEXT
    panel_geo = Q4_PANEL if photo else Q_PANEL
    arrow_geo = Q4_ARROW if photo else Q_ARROW
    label_geo = Q4_SIDELBL if photo else Q_SIDELBL
    textbox(slide, txt["x"], txt["y"], txt["cx"], txt["cy"], [(q["q"], 31, True, INK)])

    texts = dict(zip(("left", "right"), _choice_texts(q)))
    for side in ("left", "right"):
        px = panel_geo["lx"] if side == "left" else panel_geo["rx"]
        rounded(slide, px, panel_geo["y"], panel_geo["cx"], panel_geo["cy"], WHITE,
                SIDE_COLOR[side], 6)
        if photo:
            span = Q4_PHOTO["cx"] * 2 + Q4_PHOTO["gap"]
            start = px + (panel_geo["cx"] - span) // 2
            for i, name in enumerate(_photo_names(q, side)):
                pic = slide.shapes.add_picture(
                    str(IMG / name),
                    Emu(start + i * (Q4_PHOTO["cx"] + Q4_PHOTO["gap"])), Emu(Q4_PHOTO["y"]),
                    Emu(Q4_PHOTO["cx"]), Emu(Q4_PHOTO["cy"]),
                )
                pic.line.color.rgb = SIDE_COLOR[side]
                pic.line.width = Pt(2)
        else:
            textbox(slide, px + 120000, Q_ANSWER["y"], panel_geo["cx"] - 240000,
                    Q_ANSWER["cy"], [(texts[side], 25, True, INK)])
        add_arrow(slide, side, px + panel_geo["cx"] // 2, arrow_geo["y"],
                  arrow_geo["cx"], arrow_geo["cy"])
        textbox(slide, px, label_geo["y"], panel_geo["cx"], label_geo["cy"],
                [(f'{SIDE_JP[side]}に移動！', 18, True, SIDE_COLOR[side])])

    oval_id, number_ids = add_timer(slide)
    cd_id, cd_dur = audio.add(slide, str(SFX / "sfx_countdown10.mp3"),
                              "カウントダウンBGM", _next_id(slide))

    textbox(slide, Q_HINT["x"], Q_HINT["y"], Q_HINT["cx"], Q_HINT["cy"],
            [("どちらだと思いますか？　カウントダウン10秒のあいだに移動してください", 19, True, INK)])

    tl = Timeline()
    tl.group().countdown(oval_id, number_ids, cd_id, cd_dur)
    apply_transition(slide, "fade")
    apply_timing(slide, tl)

    add_notes(slide, "\n".join([
        f"【第{index}問】問題スライド（答えは次のスライド）",
        f'正解：{SIDE_JP[q["side"]]} 「{q["correct"]}」',
        "① 問題と左右の答えを読み上げる",
        "② クリック → 10秒カウントダウン（BGMが鳴ります）。会場の皆さまに移動していただく",
        "③ クリック → 答えのスライドへ",
        "",
        q.get("note", ""),
    ]).strip())
    return slide


def quiz_answer_slide(prs, audio, index, q):
    """答えだけを出すスライド。開いた瞬間にファンファーレが鳴る。"""
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(slide, "bg_quiz.png")
    photo = q.get("layout") == "photo4"
    side = q["side"]

    badge = rounded(slide, A_BADGE["x"], A_BADGE["y"], A_BADGE["cx"], A_BADGE["cy"],
                    DEEP, GOLD, 3, 0.5)
    fill_shape_text(badge, [(f"第 {index} 問　こたえ", 24, True, WHITE)])
    textbox(slide, A_LABEL["x"], A_LABEL["y"], A_LABEL["cx"], A_LABEL["cy"],
            [(f'正解は …　{SIDE_JP[side]} ！', 34, True, SIDE_COLOR[side])])

    arrow_y = A4_ARROW_Y if photo else A_ARROW["y"]
    arrow = add_arrow(slide, side, 6096000, arrow_y, A_ARROW["cx"], A_ARROW["cy"])

    geo = A4_PANEL if photo else A_PANEL
    panel = rounded(slide, geo["x"], geo["y"], geo["cx"], geo["cy"], WHITE, SIDE_COLOR[side], 6)
    extras = []
    if photo:
        span = A4_PHOTO["cx"] * 2 + A4_PHOTO["gap"]
        start = geo["x"] + (geo["cx"] - span) // 2
        for i, name in enumerate(content.PHOTO4["correct"]):
            pic = slide.shapes.add_picture(
                str(IMG / name),
                Emu(start + i * (A4_PHOTO["cx"] + A4_PHOTO["gap"])), Emu(A4_PHOTO["y"]),
                Emu(A4_PHOTO["cx"]), Emu(A4_PHOTO["cy"]),
            )
            pic.line.color.rgb = SIDE_COLOR[side]
            pic.line.width = Pt(2)
            extras.append(pic.shape_id)
    else:
        fill_shape_text(panel, [(q["correct"], 30, True, INK)])

    rib_geo = A4_RIBBON if photo else A_RIBBON
    ribbon = rounded(slide, rib_geo["x"], rib_geo["y"], rib_geo["cx"], rib_geo["cy"],
                     DEEP, GOLD, 3, 0.25)
    fill_shape_text(ribbon, [(q["reveal"], 22, True, WHITE)])

    spid, dur = audio.add(slide, str(SFX / "sfx_answer.mp3"), "正解発表効果音", _next_id(slide))

    tl = Timeline()
    tl.group(auto=True).play(spid, dur).appear(arrow.shape_id).appear(panel.shape_id)
    for sid in extras:
        tl.appear(sid)
    tl.pulse(panel.shape_id)
    tl.group().appear(ribbon.shape_id)
    apply_transition(slide, "fade")
    apply_timing(slide, tl)

    add_notes(slide, "\n".join([
        f'【第{index}問】正解：{SIDE_JP[side]} 「{q["correct"]}」',
        "スライドを表示した瞬間に効果音が鳴り、正解が出ます（クリック不要）。",
        "もう一度クリックすると、下の解説コメントが出ます。",
        "",
        f'不正解だった側（{SIDE_JP["right" if side == "left" else "left"]}）の方はお席へどうぞ。',
    ]))
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
        for side, px in (("left", 1150000), ("right", 6392000)):
            rounded(slide, px, 2600000, 4650000, 2350000, WHITE, SIDE_COLOR[side], 6)
            add_arrow(slide, side, px + 2325000, 2950000, 1400000, 700000)
            textbox(slide, px, 3850000, 4650000, 1100000,
                    [(f'{SIDE_JP[side]}の答えだと思う方は', 20, True, INK),
                     (f'画面に向かって {SIDE_JP[side]} へ', 26, True, SIDE_COLOR[side])])
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
    SIDE_COLOR.update(left=ROSE, right=NAVY)
    audio = AudioLibrary(prs, str(IMG / "audio_icon.png"))

    # --- 表紙 ---
    title = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(title, "bg_title.png")
    textbox(title, 900000, 1500000, 10392000, 900000,
            [("新郎新婦のことどれだけ知ってる？", 26, True, GOLD)])
    textbox(title, 900000, 2400000, 10392000, 1600000, [("2択 クイズ大会", 68, True, DEEP)])
    textbox(title, 900000, 4200000, 10392000, 900000,
            [("→ 中村になろうよ → ビンゴ大会 🎉", 28, True, INK)])
    apply_transition(title, "fade")

    # --- ルール説明 ---
    for r in content.RULES:
        bullet_slide(prs, r["head"], r["title"], r.get("lines", []), move=r.get("move", False))

    # --- ① ○×クイズ ---
    section_slide(prs, audio, "2択クイズ", "さあ、スタートです！", sfx="sfx_answer.mp3")
    for i, q in enumerate(content.QUIZ, start=1):
        quiz_question_slide(prs, audio, i, q)
        quiz_answer_slide(prs, audio, i, q)

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
