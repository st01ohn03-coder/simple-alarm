"""結婚式スライド用のアセット（背景画像・無音プレースホルダー音源）を生成する。"""
import math
import random
import struct
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).parent
IMG = ROOT / "assets" / "img"
SFX = ROOT / "assets" / "sfx"
IMG.mkdir(parents=True, exist_ok=True)
SFX.mkdir(parents=True, exist_ok=True)

W, H = 1920, 1080


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vertical_gradient(top, bottom):
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        d.line([(0, y), (W, y)], fill=lerp(top, bottom, y / (H - 1)))
    return img


def add_bokeh(img, color, count, rmin, rmax, alpha):
    """ふわっとした光の玉を散らして華やかさを出す。"""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rng = random.Random(20260919)
    for _ in range(count):
        x = rng.randint(-100, W + 100)
        y = rng.randint(-100, H + 100)
        r = rng.randint(rmin, rmax)
        d.ellipse([x - r, y - r, x + r, y + r], fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(70))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def gold_frame(img, inset, width, color, alpha):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rectangle([inset, inset, W - inset, H - inset], outline=color + (alpha,), width=width)
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def make_quiz_bg():
    """問題スライド用。文字が主役なので淡く、コントラストを確保する。"""
    img = vertical_gradient((253, 248, 244), (248, 232, 230))
    img = add_bokeh(img, (255, 255, 255), 10, 150, 320, 60)
    img = add_bokeh(img, (232, 170, 175), 6, 120, 260, 26)
    img = gold_frame(img, 26, 5, (201, 162, 39), 150)
    img = gold_frame(img, 40, 2, (201, 162, 39), 90)
    img.save(IMG / "bg_quiz.png")


def make_section_bg():
    """セクション扉用。ぐっとテンションが上がる濃いローズ。"""
    img = vertical_gradient((150, 44, 66), (74, 26, 46))
    img = add_bokeh(img, (255, 214, 160), 12, 140, 300, 34)
    img = add_bokeh(img, (255, 255, 255), 6, 100, 220, 24)
    img = gold_frame(img, 26, 5, (232, 200, 120), 210)
    img = gold_frame(img, 40, 2, (232, 200, 120), 120)
    img.save(IMG / "bg_section.png")


def make_title_bg():
    """表紙用。中央を明るく抜いてタイトルを浮かせる。"""
    img = vertical_gradient((252, 240, 238), (238, 206, 206))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    for i in range(26):
        t = i / 25
        r = int(760 - t * 520)
        a = int(10 + t * 80)
        d.ellipse([W // 2 - r, H // 2 - r, W // 2 + r, H // 2 + r], fill=(255, 255, 255, a))
    glow = glow.filter(ImageFilter.GaussianBlur(70))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
    img = add_bokeh(img, (255, 255, 255), 10, 150, 320, 55)
    img = add_bokeh(img, (201, 162, 39), 7, 120, 240, 26)
    img = gold_frame(img, 26, 5, (201, 162, 39), 170)
    img = gold_frame(img, 40, 2, (201, 162, 39), 100)
    img.save(IMG / "bg_title.png")


def make_bingo_bg():
    """ビンゴ用。お祝い感のある golden hour。"""
    img = vertical_gradient((255, 250, 238), (251, 228, 200))
    img = add_bokeh(img, (255, 255, 255), 10, 150, 320, 60)
    img = add_bokeh(img, (230, 160, 70), 6, 120, 250, 24)
    img = gold_frame(img, 26, 5, (193, 138, 45), 160)
    img = gold_frame(img, 40, 2, (193, 138, 45), 95)
    img.save(IMG / "bg_bingo.png")


# 顔で見分けてもらう問題なので、寄り方をファイルごとに指定する。
# (中心x, 中心y, 幅) をいずれも画像幅・高さに対する割合で。
QUIZ_CROPS = {
    "child_real.jpg": (0.51, 0.34, 0.62),
    "child_ai.jpg": (0.51, 0.34, 0.62),
    "now_real.jpg": (0.46, 0.42, 0.95),
    "now_ai.jpg": (0.52, 0.40, 1.00),
}


def crop_quiz_photos(ratio=2 / 3):
    """写真問題の4枚を同じ縦横比にそろえ、顔がはっきり見える寄りにする。"""
    src = ROOT / "assets" / "photos_src"
    for f in sorted(src.glob("*.jpg")):
        im = Image.open(f)
        w, h = im.size
        cx, cy, fw = QUIZ_CROPS[f.name]
        cw = round(w * fw)
        ch = round(cw / ratio)
        if ch > h:                              # 画像より高くなるなら高さに合わせて縮める
            ch, cw = h, round(h * ratio)
        left = min(max(round(w * cx - cw / 2), 0), w - cw)
        top = min(max(round(h * cy - ch / 2), 0), h - ch)
        im.crop((left, top, left + cw, top + ch)).convert("RGB").save(
            IMG / f"q_{f.name}", quality=90
        )


def make_silent_mp3(path, seconds=8.0):
    """無音のMPEG-1 Layer III (44.1kHz/128kbps) を組み立てる。

    本番の「家族になろうよ」音源に差し替えるためのプレースホルダー。
    サイド情報を 0 埋めしたフレームはデコーダ上で無音になる。
    """
    header = b"\xff\xfb\x90\x64"  # MPEG1 / Layer3 / 128kbps / 44100Hz / joint stereo
    frame = header + b"\x00" * (417 - len(header))
    frames = int(seconds / (1152 / 44100))
    # ID3v2 は付けない。PowerPoint は生フレームのみでも読み込める。
    path.write_bytes(frame * frames)


if __name__ == "__main__":
    make_quiz_bg()
    make_section_bg()
    make_title_bg()
    make_bingo_bg()
    crop_quiz_photos()
    make_silent_mp3(SFX / "bgm_nakamura_ni_narouyo_PLACEHOLDER.mp3")
    for p in (sorted(IMG.glob("bg_*.png")) + sorted(IMG.glob("q_*.jpg"))
              + [SFX / "bgm_nakamura_ni_narouyo_PLACEHOLDER.mp3"]):
        print(p.name, p.stat().st_size)
