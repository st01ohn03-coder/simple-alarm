#!/usr/bin/env python3
"""結婚式2次会スライド用の手描き風パーツを生成する。"""
import math, os, random
from PIL import Image, ImageDraw, ImageFilter

random.seed(20260913)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
os.makedirs(OUT, exist_ok=True)

PAPER = (247, 240, 227)
PAPER_2 = (239, 228, 207)
MARKER = (217, 83, 79)
INK = (74, 58, 46)
PINK = (231, 169, 166)
SAGE = (143, 169, 139)
MUSTARD = (230, 187, 85)
SKY = (169, 198, 217)
SS = 4  # supersample


def smooth_noise(n, octaves=3, seed=None):
    """0を中心とした滑らかな周期ノイズを n 点ぶん返す。"""
    rnd = random.Random(seed)
    vals = [0.0] * n
    for o in range(octaves):
        freq = 2 ** (o + 1)
        amp = 1.0 / (o + 1)
        phase = rnd.uniform(0, 2 * math.pi)
        for i in range(n):
            vals[i] += amp * math.sin(freq * (i / n) * 2 * math.pi + phase)
    m = max(abs(v) for v in vals) or 1.0
    return [v / m for v in vals]


def hand_ellipse(w, h, color, stroke, wobble=0.045, turns=1.14, seed=1):
    """手描き風の楕円（少し重ね書き）を透過PNGで返す。"""
    W, H = w * SS, h * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = stroke * SS * 0.9
    cx, cy = W / 2, H / 2
    rx, ry = (W - 2 * pad) / 2, (H - 2 * pad) / 2
    steps = 480
    noise = smooth_noise(steps, seed=seed)
    start = -0.45 * math.pi
    pts = []
    for i in range(int(steps * turns)):
        t = i / steps
        a = start + t * 2 * math.pi
        k = 1.0 + wobble * noise[i % steps] + 0.012 * math.sin(a * 3)
        # 描き終わりに向けてわずかに外へ膨らませ、ペンが抜ける感じを出す
        k *= 1.0 + 0.02 * max(0.0, t - 0.92)
        pts.append((cx + rx * k * math.cos(a), cy + ry * k * math.sin(a)))
    n = len(pts)
    for i in range(n - 1):
        f = i / (n - 1)
        # 筆圧のゆらぎ
        wgt = stroke * SS * (0.72 + 0.42 * math.sin(f * math.pi) + 0.10 * noise[i % steps])
        d.line([pts[i], pts[i + 1]], fill=color + (255,), width=max(1, int(wgt)), joint="curve")
        d.ellipse([pts[i][0] - wgt / 2, pts[i][1] - wgt / 2,
                   pts[i][0] + wgt / 2, pts[i][1] + wgt / 2], fill=color + (255,))
    return img.resize((w, h), Image.LANCZOS)


def paper(w, h):
    img = Image.new("RGB", (w, h), PAPER)
    px = img.load()
    # 中心から外へ向かうごく淡いグラデーション
    cx, cy = w / 2, h * 0.42
    md = math.hypot(cx, cy)
    for y in range(h):
        for x in range(0, w, 2):
            t = min(1.0, math.hypot(x - cx, y - cy) / md) ** 1.6
            c = tuple(int(PAPER[i] + (PAPER_2[i] - PAPER[i]) * t) for i in range(3))
            px[x, y] = c
            if x + 1 < w:
                px[x + 1, y] = c
    # 紙の繊維（ノイズ）
    noise = Image.effect_noise((w, h), 26).convert("L")
    noise = noise.filter(ImageFilter.GaussianBlur(0.4))
    img = Image.composite(Image.new("RGB", (w, h), (214, 203, 182)), img, noise.point(lambda v: 34 if v > 150 else 0))
    fine = Image.effect_noise((w, h), 16).convert("L").point(lambda v: max(0, v - 128) // 3)
    img = Image.composite(Image.new("RGB", (w, h), (226, 216, 197)), img, fine)
    return img


def tape(w, h, rgb, alpha=205):
    W, H = w * SS, h * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # ちぎれた端をつくる
    lj = [random.randint(0, int(W * 0.02)) for _ in range(9)]
    rj = [random.randint(0, int(W * 0.02)) for _ in range(9)]
    poly = []
    for i, v in enumerate(lj):
        poly.append((v, H * i / (len(lj) - 1)))
    for i, v in enumerate(reversed(rj)):
        poly.append((W - v, H * (len(rj) - 1 - i) / (len(rj) - 1)))
    d.polygon(poly, fill=rgb + (alpha,))
    # 布目のような細い縦筋（控えめに）
    step = max(2, int(W / 34))
    for i, x in enumerate(range(0, W, step)):
        a = 16 if i % 2 else 7
        d.rectangle([x, 0, x + step // 2, H], fill=(255, 255, 255, a))
    # 上下の端をわずかに濃くして、貼った厚みを出す
    d.rectangle([0, 0, W, int(H * 0.10)], fill=(0, 0, 0, 14))
    d.rectangle([0, int(H * 0.90), W, H], fill=(0, 0, 0, 12))
    return img.resize((w, h), Image.LANCZOS)


def heart(size, color=PINK, stroke=4):
    W = size * SS
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pts = []
    for i in range(241):
        t = i / 240 * 2 * math.pi
        x = 16 * math.sin(t) ** 3
        y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
        pts.append((W / 2 + x * W / 40, W / 2 + y * W / 40))
    d.line(pts, fill=color + (255,), width=stroke * SS, joint="curve")
    return img.resize((size, size), Image.LANCZOS)


def star(size, color=MUSTARD, stroke=4):
    W = size * SS
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = cy = W / 2
    R, r = W * 0.44, W * 0.18
    pts = []
    for i in range(11):
        a = -math.pi / 2 + i * math.pi / 5
        rad = R if i % 2 == 0 else r
        j = 1 + (0.03 if i % 3 else -0.02)
        pts.append((cx + rad * j * math.cos(a), cy + rad * j * math.sin(a)))
    d.line(pts, fill=color + (255,), width=stroke * SS, joint="curve")
    return img.resize((size, size), Image.LANCZOS)


def garland(w, h):
    W, H = w * SS, h * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cols = [PINK, SAGE, MUSTARD, SKY]

    def yline(x):
        # ゆるく垂れ下がる紐
        t = x / W
        return H * 0.10 + math.sin(t * math.pi) * H * 0.30

    d.line([(x, yline(x)) for x in range(0, W, 4)], fill=INK + (190,), width=2 * SS, joint="curve")
    n = 13
    for i in range(n):
        x = W * (0.035 + 0.078 * i)
        y = yline(x)
        bw, bh = W * 0.021, H * 0.40
        tilt = (i - n / 2) * 0.012 * W * 0.02
        d.polygon([(x - bw, y), (x + bw, y), (x + tilt, y + bh)], fill=cols[i % 4] + (255,))
    return img.resize((w, h), Image.LANCZOS)


def save(img, name):
    p = os.path.join(OUT, name)
    img.save(p)
    print(f"{name:24s} {img.size[0]}x{img.size[1]}")


save(paper(2000, 1125), "bg-paper.png")
save(hand_ellipse(760, 190, MARKER, 7, seed=3), "circle-wide.png")
save(hand_ellipse(430, 560, MARKER, 8, wobble=0.05, seed=7), "circle-tall.png")
save(hand_ellipse(300, 200, MARKER, 7, wobble=0.06, seed=11), "circle-small.png")
save(tape(360, 78, (243, 214, 160)), "tape-kraft.png")
save(tape(360, 78, (169, 198, 217)), "tape-blue.png")
save(tape(360, 78, (231, 169, 166)), "tape-pink.png")
save(heart(150), "heart.png")
save(star(150), "star.png")
save(garland(2000, 300), "garland.png")
print("done ->", OUT)
