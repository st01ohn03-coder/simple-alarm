#!/usr/bin/env python3
"""BGM・効果音をコードで合成し、ナレーションと混ぜて work/mix.wav を書き出す。

外部の音源ファイルは一切使わない（すべて numpy で生成）。
ナレーションの音量に合わせて BGM を自動で下げる（サイドチェイン風のダッキング）。
"""
import json
import os
import subprocess
import wave

import numpy as np
from scipy.signal import fftconvolve, lfilter

import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

SR = 48000
BPM = 84.0
BEAT = 60.0 / BPM
BAR = BEAT * 4

rng = np.random.default_rng(20260818)


# --------------------------------------------------------------------------
# 基本ユーティリティ
# --------------------------------------------------------------------------
def n2f(note):
    """A4=440Hz とする MIDI ノート番号→周波数"""
    return 440.0 * 2 ** ((note - 69) / 12.0)


def env_exp(n, decay, attack=0.002):
    """アタック付きの指数減衰エンベロープ"""
    t = np.arange(n) / SR
    e = np.exp(-t / decay)
    a = int(max(1, attack * SR))
    e[:a] *= np.linspace(0, 1, a)
    return e


def env_adsr(n, a=0.02, d=0.1, s=0.7, r=0.3):
    t = np.zeros(n)
    ai, di = int(a * SR), int(d * SR)
    ri = int(r * SR)
    ai = min(ai, n)
    t[:ai] = np.linspace(0, 1, ai)
    di = min(di, max(0, n - ai))
    if di:
        t[ai:ai + di] = np.linspace(1, s, di)
    t[ai + di:] = s
    if ri and ri < n:
        t[-ri:] *= np.linspace(1, 0, ri)
    return t


def lowpass(x, cutoff, q=0.7):
    """双二次ローパス（Audio EQ Cookbook）"""
    w0 = 2 * np.pi * cutoff / SR
    alpha = np.sin(w0) / (2 * q)
    b = [(1 - np.cos(w0)) / 2, 1 - np.cos(w0), (1 - np.cos(w0)) / 2]
    a = [1 + alpha, -2 * np.cos(w0), 1 - alpha]
    return lfilter(np.array(b) / a[0], np.array(a) / a[0], x)


def highpass(x, cutoff, q=0.7):
    w0 = 2 * np.pi * cutoff / SR
    alpha = np.sin(w0) / (2 * q)
    b = [(1 + np.cos(w0)) / 2, -(1 + np.cos(w0)), (1 + np.cos(w0)) / 2]
    a = [1 + alpha, -2 * np.cos(w0), 1 - alpha]
    return lfilter(np.array(b) / a[0], np.array(a) / a[0], x)


def lowpass_sweep(x, cutoffs, q=0.9, block=512):
    """カットオフが時間変化するローパス（ブロックごとに係数を差し替える）"""
    out = np.zeros_like(x)
    zi = np.zeros(2)
    for i in range(0, len(x), block):
        c = float(np.clip(cutoffs[min(i, len(cutoffs) - 1)], 60, SR / 2.4))
        w0 = 2 * np.pi * c / SR
        alpha = np.sin(w0) / (2 * q)
        b = np.array([(1 - np.cos(w0)) / 2, 1 - np.cos(w0), (1 - np.cos(w0)) / 2])
        a = np.array([1 + alpha, -2 * np.cos(w0), 1 - alpha])
        seg, zi = lfilter(b / a[0], a / a[0], x[i:i + block], zi=zi)
        out[i:i + block] = seg
    return out


def saw(freq, n, detune=0.0):
    """加算合成の疑似ノコギリ波（エイリアス少なめ）"""
    t = np.arange(n) / SR
    out = np.zeros(n)
    f = freq * (1 + detune)
    k = 1
    while f * k < SR / 2.2 and k <= 24:
        out += np.sin(2 * np.pi * f * k * t) / k
        k += 1
    return out * 0.55


def add(buf, x, at):
    i = int(at * SR)
    if i < 0:
        x = x[-i:]
        i = 0
    j = min(len(buf), i + len(x))
    if j > i:
        buf[i:j] += x[:j - i]


# --------------------------------------------------------------------------
# 音色
# --------------------------------------------------------------------------
def kick(gain=1.0):
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    f = 46 + 118 * np.exp(-t / 0.024)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * env_exp(n, 0.16, 0.001)
    click = rng.normal(0, 1, n) * env_exp(n, 0.006, 0.0005) * 0.35
    return np.tanh((body + click) * 1.6) * 0.9 * gain


def snare(gain=1.0):
    n = int(0.34 * SR)
    t = np.arange(n) / SR
    noise = highpass(rng.normal(0, 1, n), 900) * env_exp(n, 0.11, 0.001)
    body = np.sin(2 * np.pi * 185 * t) * env_exp(n, 0.075, 0.001) * 0.55
    return (noise * 0.75 + body) * 0.62 * gain


def hat(dur=0.05, gain=1.0):
    n = int(dur * SR)
    return highpass(rng.normal(0, 1, n), 7200) * env_exp(n, dur * 0.45, 0.0004) * 0.30 * gain


def sub(note, dur, gain=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = n2f(note)
    x = np.sin(2 * np.pi * f * t) + 0.22 * np.sin(4 * np.pi * f * t)
    return np.tanh(x * 1.25) * env_adsr(n, 0.006, 0.05, 0.85, 0.12) * 0.55 * gain


def pad(notes, dur, gain=1.0, cutoff=1500):
    n = int(dur * SR)
    x = np.zeros(n)
    for note in notes:
        f = n2f(note)
        x += saw(f, n, +0.004) + saw(f, n, -0.004) + 0.6 * np.sin(2 * np.pi * f * np.arange(n) / SR)
    x /= max(1, len(notes)) * 2.2
    x = lowpass(x, cutoff, 0.8)
    return x * env_adsr(n, 0.35, 0.5, 0.85, min(0.9, dur * 0.4)) * 0.5 * gain


def pluck(note, dur, gain=1.0):
    n = int(dur * SR)
    f = n2f(note)
    x = saw(f, n) * 0.6 + np.sin(2 * np.pi * f * np.arange(n) / SR) * 0.4
    x = lowpass(x, 900 + 2600 * np.exp(-3.0), 1.1)
    return x * env_exp(n, 0.16, 0.003) * 0.34 * gain


def impact(gain=1.0):
    n = int(1.5 * SR)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * (58 * np.exp(-t / 0.5) + 34) * t) * env_exp(n, 0.42, 0.001)
    noise = lowpass(rng.normal(0, 1, n), 2400) * env_exp(n, 0.22, 0.001) * 0.5
    return np.tanh((boom * 1.2 + noise) * 1.3) * 0.75 * gain


def riser(dur=1.4, gain=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    u = t / dur
    noise = rng.normal(0, 1, n)
    sweep = highpass(noise, 300)
    sweep = sweep * (u ** 2.2)
    tone = np.sin(2 * np.pi * np.cumsum(220 + 900 * u ** 2) / SR) * (u ** 3) * 0.35
    return (sweep * 0.28 + tone) * gain


def whoosh(dur=0.7, gain=1.0):
    n = int(dur * SR)
    u = np.arange(n) / n
    x = rng.normal(0, 1, n)
    x = highpass(x, 400)
    x = lowpass_sweep(x, 900 + 5200 * np.sin(np.pi * u), 0.9)
    return x * np.sin(np.pi * u) ** 2 * 0.30 * gain


def sparkle(gain=1.0, base=84):
    """コイン用のきらめき（上昇アルペジオ）"""
    out = np.zeros(int(1.1 * SR))
    for i, semi in enumerate([0, 4, 7, 12, 16, 19]):
        n = int(0.4 * SR)
        t = np.arange(n) / SR
        f = n2f(base + semi)
        x = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)) * env_exp(n, 0.13, 0.001)
        add(out, x * 0.16 * gain, i * 0.055)
    return out


def click(gain=1.0):
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * 1400 * t) * env_exp(n, 0.02, 0.0004)
    x += highpass(rng.normal(0, 1, n), 3000) * env_exp(n, 0.012, 0.0003) * 0.6
    return x * 0.34 * gain


def reverb_ir(dur=1.6, decay=0.45):
    n = int(dur * SR)
    t = np.arange(n) / SR
    ir = rng.normal(0, 1, n) * np.exp(-t / decay)
    ir = lowpass(ir, 5200)
    ir[0] += 1.0
    return ir / np.abs(ir).sum() * 2.4


# --------------------------------------------------------------------------
# 楽曲構成
# --------------------------------------------------------------------------
# Am - F - C - G （2小節ずつ）
PROG = [
    ([57, 60, 64, 69], 45),   # Am
    ([53, 57, 60, 65], 41),   # F
    ([52, 55, 60, 64], 40),   # C
    ([55, 59, 62, 67], 43),   # G
]
MELODY = [69, 72, 76, 72, 74, 72, 69, 67]  # A C E C D C A G


def build_music(total, scenes):
    n = int((total + 2.0) * SR)
    drums = np.zeros(n)
    bass = np.zeros(n)
    pads = np.zeros(n)
    lead = np.zeros(n)

    s2, s3, s6, s7 = scenes["s2"][0], scenes["s3"][0], scenes["s6"][0], scenes["s7"][0]

    def drums_on(t):
        """ドラムの音量。S2で入り、S6のブレイクで抜き、S7で戻す。"""
        if t < s2 - 0.05:
            return 0.0
        if s6 - 0.05 <= t < s7 - 0.05:
            return 0.0
        if t >= s7 - 0.05:
            return 0.85
        return 1.0

    # --- パッド（全編） ---
    t = 0.0
    i = 0
    while t < total:
        notes, _ = PROG[i % len(PROG)]
        vol = 0.75 if t < s2 else (0.95 if t < s6 else 1.15)
        add(pads, pad(notes, BAR * 2 + 0.6, gain=vol, cutoff=1200 if t < s2 else 1900), t)
        t += BAR * 2
        i += 1

    # --- ベース ---
    t = 0.0
    i = 0
    while t < total:
        _, root = PROG[i % len(PROG)]
        if t >= s2 - 0.1:
            add(bass, sub(root, BEAT * 1.6, 1.0), t)
            add(bass, sub(root, BEAT * 0.8, 0.8), t + BEAT * 2)
            add(bass, sub(root + 12, BEAT * 0.6, 0.5), t + BEAT * 3)
            add(bass, sub(root, BEAT * 1.4, 0.9), t + BAR)
            add(bass, sub(root, BEAT * 0.9, 0.7), t + BAR + BEAT * 2.5)
        else:
            add(bass, sub(root - 12, BAR * 1.6, 0.45), t)
        t += BAR * 2
        i += 1

    # --- ドラム ---
    beat = 0.0
    k = 0
    while beat < total:
        g = drums_on(beat)
        if g > 0:
            if k % 4 == 0:
                add(drums, kick(g), beat)
            if k % 8 == 6:
                add(drums, kick(g * 0.85), beat)
            if k % 4 == 2:
                add(drums, snare(g), beat)
            # ハイハット（8分＋ときどき16分ロール）
            for s in range(2):
                add(drums, hat(0.05, g * (0.9 if s == 0 else 0.55)), beat + s * BEAT / 2)
            if k % 8 == 7:
                for s in range(4):
                    add(drums, hat(0.035, g * 0.5), beat + s * BEAT / 4)
        beat += BEAT
        k += 1

    # --- リード（S3以降、S6のブレイクは休み） ---
    t = s3
    i = 0
    while t < s6 - 0.2:
        note = MELODY[i % len(MELODY)]
        add(lead, pluck(note, BEAT * 1.1, 0.9), t)
        add(lead, pluck(note + 12, BEAT * 0.5, 0.35), t + BEAT * 0.5)
        t += BEAT
        i += 1
    # ラストのCTAは長めのリード
    add(lead, pluck(69, 1.6, 0.9), s7 + 0.05)
    add(lead, pluck(76, 1.6, 0.7), s7 + 0.35)

    music = drums * 0.85 + bass * 0.95 + pads * 0.62 + lead * 0.55
    return music[:int(total * SR) + SR]


def build_sfx(total, scenes, timeline):
    n = int((total + 2.0) * SR)
    out = np.zeros(n)
    cuts = [scenes[k][0] for k in ("s2", "s3", "s4", "s5", "s6", "s7")]
    for c in cuts:
        add(out, whoosh(0.75, 0.9), c - 0.55)
        add(out, impact(0.85 if c not in (scenes["s2"][0], scenes["s7"][0]) else 1.15), c - 0.02)
    # 冒頭の弱いインパクト
    add(out, impact(0.5), 0.02)
    # ロゴ登場のきらめき
    add(out, sparkle(1.0), scenes["s2"][0] + 0.55)
    # 「1回ガチャる」を押す音（S4の +1.28 秒）
    add(out, click(1.0), scenes["s4"][0] + 1.26)
    add(out, sparkle(0.55, base=79), scenes["s4"][0] + 1.42)
    # ポイント還元シーンのコイン
    add(out, sparkle(0.8, base=81), scenes["s5"][0] + 0.55)
    # タグライン前とCTA前のライザー
    add(out, riser(1.5, 0.85), scenes["s6"][0] - 1.5)
    add(out, riser(1.6, 1.0), scenes["s7"][0] - 1.6)
    return out[:int(total * SR) + SR]


# --------------------------------------------------------------------------
# ナレーション
# --------------------------------------------------------------------------
def load_vo(timeline):
    total = timeline["total"]
    n = int((total + 2.0) * SR)
    vo = np.zeros(n)
    for line in timeline["lines"]:
        src = os.path.join(WORK, "vo", line["id"] + ".mp3")
        raw = subprocess.run(
            [FFMPEG, "-v", "error", "-i", src, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
            capture_output=True, check=True,
        ).stdout
        x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
        # 頭と尻に軽くフェードをかけてプツッと鳴らないようにする
        f = int(0.008 * SR)
        x[:f] *= np.linspace(0, 1, f)
        x[-f:] *= np.linspace(1, 0, f)
        add(vo, x * 1.0, line["start"])
    return vo[:int(total * SR) + SR]


def envelope(x, attack=0.01, release=0.28):
    """ダッキング用のエンベロープ検出"""
    a = np.abs(x)
    # ざっくり平滑化（片極ローパス）
    ca = 1 - np.exp(-1 / (attack * SR))
    cr = 1 - np.exp(-1 / (release * SR))
    out = np.zeros_like(a)
    prev = 0.0
    # 速度優先でブロック処理
    block = 256
    for i in range(0, len(a), block):
        seg = a[i:i + block]
        peak = seg.max() if len(seg) else 0.0
        c = ca if peak > prev else cr
        prev = prev + (peak - prev) * min(1.0, c * block)
        out[i:i + block] = prev
    return out


def main():
    timeline = json.load(open(os.path.join(WORK, "timeline.json"), encoding="utf-8"))
    total = timeline["total"]

    # promo.html と同じシーン境界を再計算する
    L = {l["id"]: l for l in timeline["lines"]}
    cut = lambda i: L[i]["start"] - 0.25
    scenes = {
        "s1": [0, cut("l2")], "s2": [cut("l2"), cut("l3")], "s3": [cut("l3"), cut("l4")],
        "s4": [cut("l4"), cut("l5")], "s5": [cut("l5"), cut("l6")],
        "s6": [cut("l6"), cut("l7")], "s7": [cut("l7"), total],
    }

    music = build_music(total, scenes)
    sfx = build_sfx(total, scenes, timeline)
    vo = load_vo(timeline)
    n = min(len(music), len(sfx), len(vo))
    music, sfx, vo = music[:n], sfx[:n], vo[:n]

    # 空間を作るためのリバーブ（SFXとリードに軽く）
    ir = reverb_ir()
    sfx_wet = fftconvolve(sfx, ir)[:n]
    sfx = sfx * 0.82 + sfx_wet * 0.35

    # ナレーションの下で BGM を下げる
    duck = envelope(vo, 0.012, 0.34)
    duck = duck / (duck.max() + 1e-9)
    gain = 1.0 - 0.62 * np.clip(duck * 3.2, 0, 1)
    music = music * gain
    sfx = sfx * (1.0 - 0.28 * np.clip(duck * 3.2, 0, 1))

    # ナレーションを少し前に出す
    vo = highpass(vo, 95)
    vo = np.tanh(vo * 1.55) * 0.92

    mix = music * 0.40 + sfx * 0.52 + vo * 0.95

    # 締めのフェードアウト
    tail = int(0.5 * SR)
    mix[-tail:] *= np.linspace(1, 0, tail)

    # 全体をならしてピークを -1dBFS に
    mix = np.tanh(mix * 1.05)
    mix = mix / (np.abs(mix).max() + 1e-9) * 0.89

    stereo = np.stack([mix, mix], axis=1)
    out = os.path.join(WORK, "mix.wav")
    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((stereo * 32767).astype("<i2").tobytes())
    print("wrote", out, f"{len(mix)/SR:.2f}s")


if __name__ == "__main__":
    main()
