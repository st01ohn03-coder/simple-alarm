# -*- coding: utf-8 -*-
"""書き出した pptx を開かずに検査する。

・パッケージの参照（画像・音源）が壊れていないか
・アニメーションの対象figureが実在するか、IDが重複していないか
・○×クイズの赤枠が正解側に置かれているか
・各問にカウントダウンBGMと正解効果音が入っているか
"""
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

from lxml import etree

import content

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
}
PANEL_LX, PANEL_RX = 1150000, 6792000
PH_X, PH_Y1, PH_Y2 = 4100000, 2000000, 3650000
PAD = 110000
FIRST_QUIZ_SLIDE = 6          # 表紙1 + ルール3 + セクション扉1 の次


def check(path):
    problems = []
    z = zipfile.ZipFile(path)
    slides = sorted(
        (n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
        key=lambda n: int(re.search(r"(\d+)", n.rsplit("/", 1)[1]).group(1)),
    )

    for name in slides:
        root = etree.fromstring(z.read(name))
        rels_raw = z.read(f"ppt/slides/_rels/{Path(name).name}.rels").decode()
        rel_ids = set(re.findall(r'Id="([^"]+)"', rels_raw))
        xml = z.read(name).decode()

        dangling = (set(re.findall(r'r:(?:embed|link)="([^"]+)"', xml)) - {""}) - rel_ids
        if dangling:
            problems.append(f"{name}: 参照切れ {dangling}")

        shape_ids = [e.get("id") for e in root.iter(f'{{{NS["p"]}}}cNvPr')]
        if len(shape_ids) != len(set(shape_ids)):
            problems.append(f"{name}: 図形IDが重複")
        orphans = {t.get("spid") for t in root.iter(f'{{{NS["p"]}}}spTgt')} - set(shape_ids)
        if orphans:
            problems.append(f"{name}: アニメ対象が存在しない {orphans}")

        ctn_ids = [e.get("id") for e in root.iter(f'{{{NS["p"]}}}cTn')]
        if len(ctn_ids) != len(set(ctn_ids)):
            problems.append(f"{name}: アニメーションIDが重複")

    for i, q in enumerate(content.QUIZ, start=1):
        name = f"ppt/slides/slide{FIRST_QUIZ_SLIDE - 1 + i}.xml"
        root = etree.fromstring(z.read(name))
        frames = []
        for sp in root.iter(f'{{{NS["p"]}}}sp'):
            clr = sp.find(".//a:ln/a:solidFill/a:srgbClr", NS)
            if clr is not None and clr.get("val") == "FF0000":
                off = sp.find(".//a:off", NS)
                frames.append((int(off.get("x")), int(off.get("y"))))
        if q.get("layout") == "photo":
            want = (PH_X - PAD, (PH_Y1 if q["answer"] == "maru" else PH_Y2) - PAD)
        else:
            want = ((PANEL_LX if q["answer"] == "maru" else PANEL_RX) - PAD, 3300000 - PAD)
        if frames != [want]:
            problems.append(f"Q{i}: 赤枠が正解側にない {frames} / 期待 [{want}]")

        seq = root.find('.//p:seq/p:cTn[@nodeType="mainSeq"]/p:childTnLst', NS)
        n_groups = len(seq.findall("p:par", NS)) if seq is not None else 0
        if n_groups != 2:
            problems.append(f"Q{i}: クリックが{n_groups}段（カウントダウンと正解発表の2段が必要）")

        rels_raw = z.read(f"ppt/slides/_rels/{Path(name).name}.rels").decode()
        if rels_raw.count('/relationships/audio"') != 2:
            problems.append(f"Q{i}: 音源が2つ入っていない")

        nums = sorted(int(t) for t in re.findall(r"<a:t>(\d+)</a:t>", z.read(name).decode()))
        if nums != list(range(11)):
            problems.append(f"Q{i}: カウントダウンの数字が 0〜10 そろっていない")

    bgm = etree.fromstring(z.read(f"ppt/slides/slide{len(slides) - 1}.xml"))
    iseq = bgm.find('.//p:cTn[@nodeType="interactiveSeq"]', NS)
    if iseq is None:
        problems.append("BGMスライド: クリックトリガーが設定されていない")
    else:
        spid = iseq.find("p:stCondLst/p:cond/p:tgtEl/p:spTgt", NS).get("spid")
        names = {e.get("id"): e.get("name") for e in bgm.iter(f'{{{NS["p"]}}}cNvPr')}
        if names.get(spid) != "BGM再生ボタン":
            problems.append(f"BGMスライド: トリガー対象が {names.get(spid)} になっている")

    return len(slides), problems


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else \
        Path(__file__).parent / "build" / "結婚式_マルバツクイズ＆ビンゴ.pptx"
    n, problems = check(target)
    print(f"{target.name}: {n} 枚")
    if problems:
        for p in problems:
            print("  NG:", p)
        sys.exit(1)
    print("  OK: 参照・アニメーション・正解位置・効果音すべて問題なし")
