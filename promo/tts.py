#!/usr/bin/env python3
"""ナレーション音声を edge-tts で生成し、各行の尺を測ってタイムラインを組み立てる。

出力:
  work/vo/<id>.mp3   … 行ごとの音声
  work/timeline.json … 行の開始/終了時刻（秒）と字幕テキスト
"""
import asyncio
import json
import os
import subprocess
import sys

import edge_tts
import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
VO = os.path.join(WORK, "vo")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

# 行間の間（秒）。テンポを作るためシーンごとに調整する。
GAP_AFTER = {
    "l1": 0.34,
    "l2": 0.22,
    "l3": 0.22,
    "l4": 0.22,
    "l5": 0.30,
    "l6": 0.26,
    "l7": 0.00,
}
LEAD_IN = 0.50      # 冒頭の無音（ロゴ/効果音の助走）
TARGET_TOTAL = 30.0  # 目標尺（秒）。余りは最後のCTAの余韻に充てる
MIN_TAIL = 0.70


def duration(path):
    out = subprocess.run(
        [FFMPEG, "-i", path, "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    # ffmpeg の "time=00:00:03.62" 表記から最終値を拾う
    last = None
    for tok in out.split("time="):
        if ":" in tok[:12]:
            last = tok[:11]
    if last is None:
        raise RuntimeError("duration not found for " + path)
    h, m, s = last.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


async def synth(cfg):
    os.makedirs(VO, exist_ok=True)
    for line in cfg["lines"]:
        path = os.path.join(VO, line["id"] + ".mp3")
        comm = edge_tts.Communicate(
            line["speak"], cfg["voice"], rate=cfg["rate"], pitch=cfg["pitch"]
        )
        await comm.save(path)
        print("tts:", line["id"], os.path.getsize(path), "bytes")


def build_timeline(cfg):
    t = LEAD_IN
    items = []
    for line in cfg["lines"]:
        path = os.path.join(VO, line["id"] + ".mp3")
        d = duration(path)
        items.append({
            "id": line["id"],
            "scene": line["scene"],
            "sub": line["sub"],
            "start": round(t, 3),
            "end": round(t + d, 3),
            "dur": round(d, 3),
        })
        t += d + GAP_AFTER.get(line["id"], 0.3)
    tail = max(MIN_TAIL, TARGET_TOTAL - t)
    total = round(t + tail, 3)
    return {"total": total, "fps": cfg["fps"], "lines": items}


def main():
    cfg = json.load(open(os.path.join(HERE, "script.json"), encoding="utf-8"))
    if "--skip-tts" not in sys.argv:
        asyncio.run(synth(cfg))
    tl = build_timeline(cfg)
    with open(os.path.join(WORK, "timeline.json"), "w", encoding="utf-8") as f:
        json.dump(tl, f, ensure_ascii=False, indent=2)
    for it in tl["lines"]:
        print(f"{it['id']}  {it['start']:6.2f} -> {it['end']:6.2f}  ({it['dur']:.2f}s)  {it['sub']}")
    print("TOTAL:", tl["total"], "sec")


if __name__ == "__main__":
    main()
