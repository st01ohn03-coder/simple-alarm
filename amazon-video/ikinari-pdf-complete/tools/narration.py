#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ナレーション音声トラックを作る。

  python3 tools/narration.py            # 音声を合成して dist/narration.m4a を書き出す
  python3 tools/narration.py --check    # 合成して尺のはみ出しだけ確認する（書き出さない）
  python3 tools/narration.py --voice ja-JP-KeitaNeural   # 男性ボイス
  python3 tools/narration.py --no-music # 環境音ベッドを入れない

各セリフは src/timeline.js の SCENES と同じ区間に割り当ててある。
セリフがシーンの終わりをはみ出す場合は警告を出す。
"""
import argparse, array, asyncio, json, math, os, re, shutil, subprocess, sys, wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build" / "narration"
TIMELINE = ROOT / "src" / "timeline.js"
SR = 48000

LEAD = 0.45          # シーンが始まってから読み始めるまでの間
TAIL_MARGIN = 0.30   # シーンが終わる何秒前までに読み終えるか
CLIP_LUFS = -19.0    # 各セリフをそろえるラウドネス
TARGET_LUFS = -16.0  # 完成トラックのラウドネス


def read_timeline():
    """シーン区間と全体尺は src/timeline.js が唯一の正。ここから読み出す。"""
    js = TIMELINE.read_text(encoding="utf-8")
    m = re.search(r"var DUR = ([\d.]+);", js)
    if not m:
        sys.exit("timeline.js から DUR を読めませんでした")
    duration = float(m.group(1))
    scenes = {}
    for sid, a, b in re.findall(r"\$\('(s\d)'\), a: ([\d.]+),\s*b: ([\d.]+)", js):
        scenes[sid.upper()] = (float(a), float(b))
    if len(scenes) != 8:
        sys.exit(f"timeline.js から読めたシーンが {len(scenes)} 個しかありません")
    return duration, scenes


DURATION, SCENES = read_timeline()

# ---------------------------------------------------------------- 原稿
# セリフはシーン開始 + LEAD 秒から読み始める。
# TTS が読み違える語はカタカナで書く（PDF→ピーディーエフ、AI→エーアイ）。
LINES = [
    ("S1", "その ピーディーエフ、開くだけで終わっていませんか。"),
    ("S2", "いきなり ピーディーエフ バージョン 13、コンプリート。"),
    ("S3", "作成、ページ編集、変換、注釈。これ一本で。"),
    ("S4", "ワープロ感覚で、ピーディーエフ を直接編集。"),
    ("S5", "墨消しも、電子署名も。見せない、変えさせない。"),
    ("S6", "新機能、紙の ピーディーエフ 化。エーアイ が分割して、名前まで付けます。"),
    ("S7", "サブスクは毎年払う。コンプリートは、一回だけ。"),
    ("S8", "いきなり ピーディーエフ、コンプリート。"),
]

CUES = [dict(id=sid, win=SCENES[sid], at=round(SCENES[sid][0] + LEAD, 2), text=txt)
        for sid, txt in LINES]

TAIL_MARGIN = 0.15   # シーン終端から何秒前までに読み終えるか


def ffmpeg() -> str:
    if os.environ.get("FFMPEG_PATH"):
        return os.environ["FFMPEG_PATH"]
    local = ROOT / "node_modules/@ffmpeg-installer/linux-x64/ffmpeg"
    if local.exists():
        return str(local)
    found = shutil.which("ffmpeg")
    if not found:
        sys.exit("ffmpeg が見つかりません。npm install するか FFMPEG_PATH を設定してください。")
    return found


FF = None


def run(args):
    p = subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error"] + args,
                       capture_output=True, text=True)
    if p.returncode != 0:
        sys.exit("ffmpeg 失敗:\n" + p.stderr[-2000:])


def measure_lufs(path: Path) -> float:
    """統合ラウドネス(LUFS)を実測する。動的な正規化を避けて静的ゲインで揃えるため。"""
    p = subprocess.run([FF, "-hide_banner", "-i", str(path), "-af", "ebur128", "-f", "null", "-"],
                       capture_output=True, text=True)
    val = None
    for line in p.stderr.splitlines():
        t = line.strip()
        if t.startswith("I:") and "LUFS" in t:
            val = float(t.split()[1])
    if val is None:
        sys.exit("ラウドネスを測れませんでした: " + str(path))
    return val


def probe_seconds(path: Path) -> float:
    p = subprocess.run([FF, "-hide_banner", "-i", str(path)],
                       capture_output=True, text=True)
    for line in p.stderr.splitlines():
        if "Duration:" in line:
            hms = line.split("Duration:")[1].split(",")[0].strip()
            h, m, s = hms.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    return 0.0


async def synth(voice: str, rate: str):
    import edge_tts
    BUILD.mkdir(parents=True, exist_ok=True)
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    for cue in CUES:
        out = BUILD / f"{cue['id']}.mp3"
        comm = edge_tts.Communicate(cue["text"], voice, rate=rate, proxy=proxy)
        await comm.save(str(out))
        cue["mp3"] = out


def trim_silence(cue):
    """前後の無音を落として、読み始めをきっちり `at` に合わせる。"""
    src, dst = cue["mp3"], BUILD / f"{cue['id']}_trim.wav"
    run(["-i", str(src),
         "-af", ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,"
                 "areverse,"
                 "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,"
                 "areverse,"
                 "highpass=f=85,"          # こもりを取る
                 "acompressor=threshold=-18dB:ratio=2.5:attack=8:release=140"),
         "-ar", str(SR), "-ac", "2", str(dst)])
    cue["wav"] = dst
    cue["dur"] = probe_seconds(dst)
    # クリップごとに実測して、同じラウドネスに揃えるための静的ゲインを持たせる
    cue["gain"] = CLIP_LUFS - measure_lufs(dst)
    return cue


def read_wav(path: Path):
    """16bit WAV を -1.0〜1.0 の float 列で返す（インターリーブのまま）。"""
    with wave.open(str(path), "rb") as w:
        assert w.getsampwidth() == 2, f"16bit でない: {path}"
        a = array.array("h")
        a.frombytes(w.readframes(w.getnframes()))
        ch = w.getnchannels()
    if ch == 1:                      # モノラルならステレオに複製
        out = []
        for v in a:
            out += [v / 32768.0, v / 32768.0]
        return out
    return [v / 32768.0 for v in a]


def write_wav(path: Path, samples):
    """float 列を 16bit ステレオ WAV に書く。"""
    a = array.array("h", bytes(2 * len(samples)))
    for i, v in enumerate(samples):
        a[i] = int(max(-1.0, min(1.0, v)) * 32767)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(a.tobytes())


def make_music(path: Path):
    """権利関係の要らない、ごく控えめな環境音ベッドを自前で合成する。"""
    n = int(DURATION * SR)
    buf = array.array("h", bytes(4 * n))  # ステレオ16bit

    # 低めのコード（Cm9 あたり）をサイン波で重ねた、動きの少ないパッド
    partials = [(98.00, 0.30), (146.83, 0.24), (196.00, 0.18),
                (233.08, 0.13), (293.66, 0.10), (392.00, 0.06)]
    scene_marks = sorted(a for a, _ in SCENES.values())

    for i in range(n):
        t = i / SR
        # 全体のフェードイン／アウト
        env = min(t / 1.2, 1.0) * min(max(DURATION - t, 0.0) / 1.6, 1.0)
        # シーンの変わり目でわずかに持ち上げる
        lift = 0.0
        for m in scene_marks:
            d = t - m
            if 0.0 <= d < 1.1:
                lift += 0.25 * math.exp(-d * 3.2)
        amp = env * (0.72 + lift) * 0.5
        s = 0.0
        for f, g in partials:
            # ごくゆっくりした揺らぎ
            wob = 1.0 + 0.0009 * math.sin(2 * math.pi * 0.07 * t + f)
            s += g * math.sin(2 * math.pi * f * wob * t)
        s *= amp / sum(g for _, g in partials)
        v = int(max(-1.0, min(1.0, s)) * 32767 * 0.5)
        buf[2 * i] = v
        buf[2 * i + 1] = v

    with wave.open(str(path), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(buf.tobytes())


def main():
    global FF
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="ja-JP-NanamiNeural")
    ap.add_argument("--rate", default="+6%", help="読み上げ速度。例 +8%")
    ap.add_argument("--out", default="dist/narration.m4a")
    ap.add_argument("--check", action="store_true", help="尺の確認だけして書き出さない")
    ap.add_argument("--no-music", action="store_true", help="環境音ベッドを入れない")
    ap.add_argument("--music-db", type=float, default=-19.0, help="環境音の音量(dB)")
    args = ap.parse_args()
    FF = ffmpeg()

    print(f"ボイス: {args.voice}  速度: {args.rate}")
    asyncio.run(synth(args.voice, args.rate))

    over = 0
    print(f"\n{'ID':4} {'読み始め':>8} {'長さ':>6} {'読み終わり':>10} {'シーン終端':>10}  {'補正dB':>6}  判定")
    for cue in CUES:
        trim_silence(cue)
        end = cue["at"] + cue["dur"]
        limit = cue["win"][1] - TAIL_MARGIN
        ok = end <= limit
        if not ok:
            over += 1
        print(f"{cue['id']:4} {cue['at']:8.2f} {cue['dur']:6.2f} {end:10.2f} {limit:10.2f}  "
              f"{cue['gain']:+6.1f}  {'ok' if ok else '★ %.2fs はみ出し' % (end - limit)}")

    if over:
        print(f"\n{over} 本がシーンをはみ出しています。原稿を短くするか --rate +8% を試してください。")
    else:
        print("\nすべてシーン内に収まりました。")

    if args.check:
        return 0 if over == 0 else 1

    # ---- ミックス ----
    # ffmpeg の amix は入力が終わるたびに残りの入力を再正規化するので、
    # 短いセリフを並べると全体に右肩上がりのゲインがかかってしまう。
    # セリフは重ならないので、ここは自前で足し合わせる。
    n = int(DURATION * SR)
    mix = [0.0] * (n * 2)

    for cue in CUES:
        g = 10 ** (cue["gain"] / 20.0)
        off = int(cue["at"] * SR) * 2
        for i, v in enumerate(read_wav(cue["wav"])):
            j = off + i
            if j >= len(mix):
                break
            mix[j] += v * g

    if not args.no_music:
        bed = BUILD / "bed.wav"
        make_music(bed)
        g = 10 ** (args.music_db / 20.0)
        for i, v in enumerate(read_wav(bed)):
            if i >= len(mix):
                break
            mix[i] += v * g

    # 終わりをフェードアウト
    fade = int(0.4 * SR)
    for i in range(fade):
        k = 1.0 - i / fade
        j = (n - fade + i) * 2
        mix[j] *= k
        mix[j + 1] *= k

    raw = BUILD / "mix.wav"
    write_wav(raw, mix)
    gain = TARGET_LUFS - measure_lufs(raw)

    # 実測した差分を静的ゲインで当てて書き出す（動的な正規化は使わない）
    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)

    def encode(g):
        # alimiter の level(自動レベル)は既定でオン。有効だと全体に
        # ゆるやかなゲインランプがかかるので必ず disabled にする。
        run(["-i", str(raw), "-af", f"volume={g:.2f}dB,alimiter=limit=0.87:level=disabled",
             "-c:a", "aac", "-b:a", "192k", "-ar", str(SR), "-ac", "2", str(out)])
        return measure_lufs(out)

    got = encode(gain)
    # エンコードでわずかにずれるので、残差が大きければ1度だけ当て直す
    if abs(got - TARGET_LUFS) > 0.4:
        gain += TARGET_LUFS - got
        got = encode(gain)
    print(f"\n全体ゲイン: {gain:+.2f} dB  →  {got:.1f} LUFS（目標 {TARGET_LUFS:.0f}）")
    print(f"書き出し: {out}  ({out.stat().st_size/1024:.0f} KB / {probe_seconds(out):.2f}s)")

    (BUILD / "cues.json").write_text(json.dumps(
        [{k: v for k, v in c.items() if k in ("id", "at", "dur", "text", "win")} for c in CUES],
        ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
