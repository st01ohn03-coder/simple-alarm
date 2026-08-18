#!/usr/bin/env python3
"""gachasni.com（SneakDraw）から動画で使う実素材を取得して work/assets/ に配置する。

ファイル名は file:// から扱いやすいASCIIに正規化する。
"""
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.join(HERE, "work", "assets")
BASE = "https://gachasni.com"

FILES = {
    # UI / 共通
    "coin.png": "/wp-content/uploads/2026/07/%E3%82%B3%E3%82%A4%E3%83%B3%E2%91%A2.png",
    # 賞ランクのバッジ
    "rank_s.png": "/wp-content/uploads/2024/12/S%E8%B3%9E%E9%80%8F%E9%81%8E.png",
    "rank_a.png": "/wp-content/uploads/2024/12/A%E8%B3%9E%E9%80%8F%E9%81%8E.png",
    "rank_b.png": "/wp-content/uploads/2024/12/B%E8%B3%9E%E9%80%8F%E9%81%8E.png",
    "rank_c.png": "/wp-content/uploads/2024/12/C%E8%B3%9E%E9%80%8F%E9%81%8E.png",
    "rank_last.png": "/wp-content/uploads/2024/12/%E3%83%A9%E3%82%B9%E3%83%88%E3%83%AF%E3%83%B3%E8%B3%9E-1.png",
    # TRAVIS SCOTT LIMITED の賞品カット
    "prize_s.png": "/admedia/6a775670e3ea9.png",
    "prize_c.png": "/admedia/6a7756809ba64.png",
    "prize_last.png": "/admedia/6a775682561b5.png",
    # ガチャのサムネイル
    "th_travis.png": "/admedia/6a7896b668d86_%E3%82%B5%E3%83%A0%E3%83%8D%E3%82%A4%E3%83%AB_TRAVIS_SCOTT_LIMITED.png",
    "th_lv_dior.png": "/admedia/6a78968b61f66_%E3%82%B5%E3%83%A0%E3%83%8D%E3%82%A4%E3%83%AB_LV_vs_DIOR.png",
    "th_pokemon.png": "/admedia/6a7897107d6f0_23_POKEMON_GRAIL.png",
    "th_labubu.png": "/admedia/6a7896d33e9da_%E3%82%B5%E3%83%A0%E3%83%8D%E3%82%A4%E3%83%AB_LABUBU_FEVER_MAX.png",
    "th_switch2.png": "/admedia/6a7896e89279c_%E3%82%B5%E3%83%A0%E3%83%8D%E3%82%A4%E3%83%AB_SWITCH_2_RUSH.png",
    "th_iphone.png": "/admedia/6a7896f1a0e23_%E3%82%B5%E3%83%A0%E3%83%8D%E3%82%A4%E3%83%AB_iPHONE_REVOLUTION.png",
    "th_summer.png": "/admedia/6a7896804b2a7_%E3%82%B5%E3%83%A0%E3%83%8D%E3%82%A4%E3%83%AB_SNEAKDRAW%E5%A4%8F%E8%A2%8B.png",
    "th_carnival.png": "/admedia/6a789699e4695_%E3%82%B5%E3%83%A0%E3%83%8D%E3%82%A4%E3%83%AB_HIGH_BRAND_CARNIVAL.png",
    "th_onecoin.png": "/admedia/6a78972d82362_26_ONE_COIN_CARD.png",
    "th_luxury.png": "/admedia/6a789725b0f58_25_LUXURY_TIME.png",
    "th_airpods.png": "/admedia/6a78970026b38_%E3%82%B5%E3%83%A0%E3%83%8D%E3%82%A4%E3%83%AB_AIRPODS_JACKPOT.png",
    "th_popmart.png": "/admedia/6a7896df37def_%E3%82%B5%E3%83%A0%E3%83%8D%E3%82%A4%E3%83%AB_POP_MART_PARADISE.png",
}

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"}


def main():
    os.makedirs(DEST, exist_ok=True)
    for name, path in FILES.items():
        out = os.path.join(DEST, name)
        if os.path.exists(out) and os.path.getsize(out) > 0:
            print("skip", name)
            continue
        req = urllib.request.Request(BASE + path, headers=UA)
        with urllib.request.urlopen(req, timeout=90) as r, open(out, "wb") as f:
            f.write(r.read())
        print("get ", name, os.path.getsize(out), "bytes")


if __name__ == "__main__":
    main()
