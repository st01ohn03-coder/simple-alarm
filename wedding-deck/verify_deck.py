# -*- coding: utf-8 -*-
"""書き出した pptx を開かずに検査する。

・パッケージの参照（画像・音源）が壊れていないか
・アニメーションの対象figureが実在するか、IDが重複していないか
・問題スライドに答えが漏れていないか（答えは必ず次のスライド）
・正解が左右どちらかに偏っていないか
・音の鳴り方（問題＝クリック待ち／それ以外＝自動再生）が意図どおりか
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
FIRST_QUIZ_SLIDE = 11           # ウェルカム1 + 流れ1 + 開会〜歓談4 + 扉1 + ルール3 の次
MAX_SAME_SIDE_RUN = 3           # 同じ側の正解がこれ以上続いたら読まれてしまう


def _text(root):
    return "".join(t.text or "" for t in root.iter(f'{{{NS["a"]}}}t'))


def check(path):
    problems = []
    z = zipfile.ZipFile(path)
    slides = sorted(
        (n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
        key=lambda n: int(re.search(r"(\d+)", n.rsplit("/", 1)[1]).group(1)),
    )

    # --- パッケージの健全性 ---
    for name in slides:
        root = etree.fromstring(z.read(name))
        xml = z.read(name).decode()
        rel_ids = set(re.findall(r'Id="([^"]+)"',
                                 z.read(f"ppt/slides/_rels/{Path(name).name}.rels").decode()))
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

    # --- 問題と答えの分離 ---
    quiz_slides = set()
    for i, q in enumerate(content.QUIZ, start=1):
        qn = f"ppt/slides/slide{FIRST_QUIZ_SLIDE + (i - 1) * 2}.xml"
        an = f"ppt/slides/slide{FIRST_QUIZ_SLIDE + (i - 1) * 2 + 1}.xml"
        quiz_slides |= {qn, an}
        qroot, aroot = etree.fromstring(z.read(qn)), etree.fromstring(z.read(an))
        qtext, atext = _text(qroot), _text(aroot)

        # 問題スライドに答えが載っていないこと
        if q["reveal"] and q["reveal"] in qtext:
            problems.append(f"Q{i}: 問題スライドに解説コメントが載っている")
        if "正解" in qtext:
            problems.append(f"Q{i}: 問題スライドに「正解」の文字がある")
        if q.get("layout") != "photo2":
            for key in ("correct", "dummy"):
                if q[key].replace(" ", "") not in qtext.replace(" ", ""):
                    problems.append(f"Q{i}: 問題スライドに選択肢『{q[key]}』が出ていない")
            if q["correct"].replace(" ", "") not in atext.replace(" ", ""):
                problems.append(f"Q{i}: 答えスライドに正解『{q['correct']}』が出ていない")
        if q["reveal"] and q["reveal"] not in atext:
            problems.append(f"Q{i}: 答えスライドに解説コメントが出ていない")

        # 問題＝クリック待ち、答え＝自動再生
        qc = qroot.find('.//p:cTn[@nodeType="mainSeq"]/p:childTnLst/p:par/p:cTn'
                        "/p:stCondLst/p:cond", NS)
        if qc is None or qc.get("delay") != "indefinite":
            problems.append(f"Q{i}: 問題スライドのカウントダウンがクリック待ちになっていない")
        ac = aroot.find('.//p:cTn[@nodeType="mainSeq"]/p:childTnLst/p:par/p:cTn'
                        "/p:stCondLst/p:cond", NS)
        if ac is None or ac.get("delay") != "0":
            problems.append(f"Q{i}: 答えスライドの効果音が自動再生になっていない")

        # 問題スライドはカウントダウンBGMのみ、答えスライドは正解音のみ
        for slide_name, want in ((qn, 1), (an, 1)):
            rels = z.read(f"ppt/slides/_rels/{Path(slide_name).name}.rels").decode()
            got = rels.count('/relationships/audio"')
            if got != want:
                problems.append(f"Q{i}: {Path(slide_name).name} の音源が {got} 個（期待 {want}）")

        nums = sorted(int(t) for t in re.findall(r"<a:t>(\d+)</a:t>", z.read(qn).decode()))
        if nums != list(range(11)):
            problems.append(f"Q{i}: カウントダウンの数字が 0〜10 そろっていない")

    # --- 正解の左右の偏り ---
    sides = [q["side"] for q in content.QUIZ]
    if len(set(sides)) < 2:
        problems.append("正解が片側に固定されている")
    run = best = 1
    for a, b in zip(sides, sides[1:]):
        run = run + 1 if a == b else 1
        best = max(best, run)
    if best >= MAX_SAME_SIDE_RUN:
        problems.append(f"同じ側の正解が {best} 問続いている（読まれやすい）")
    if abs(sides.count("left") - sides.count("right")) > 2:
        problems.append(f"左右の偏りが大きい 左{sides.count('left')}/右{sides.count('right')}")

    # --- クイズ以外の音は「表示した瞬間に自動再生」 ---
    for name in slides:
        if name in quiz_slides:
            continue
        root = etree.fromstring(z.read(name))
        if root.find(".//p:timing//p:cmd", NS) is None:
            continue
        cond = root.find('.//p:cTn[@nodeType="mainSeq"]/p:childTnLst/p:par/p:cTn'
                         "/p:stCondLst/p:cond", NS)
        if cond.get("delay") != "0":
            problems.append(f"{name}: 音が自動再生になっていない (delay={cond.get('delay')})")

    # 写真問題は、問題スライドに2枚・答えスライドに1枚だけ写真が出ること
    for i, q in enumerate(content.QUIZ, start=1):
        if q.get("layout") != "photo2":
            continue
        qn = f"ppt/slides/slide{FIRST_QUIZ_SLIDE + (i - 1) * 2}.xml"
        an = f"ppt/slides/slide{FIRST_QUIZ_SLIDE + (i - 1) * 2 + 1}.xml"
        for name, want in ((qn, 2), (an, 1)):
            root = etree.fromstring(z.read(name))
            n_pic = len(list(root.iter(f'{{{NS["p"]}}}pic')))
            # 背景画像1枚と音声オブジェクトも <p:pic> なので差し引く
            audio_n = z.read(f"ppt/slides/_rels/{Path(name).name}.rels").decode().count(
                '/relationships/audio"')
            if n_pic - 1 - audio_n != want:
                problems.append(
                    f"Q{i}: {Path(name).name} の写真が {n_pic - 1 - audio_n} 枚（期待 {want}）")

    bgm = [n for n in slides if "中村になろうよ BGM" in z.read(n).decode()]
    if len(bgm) != 1:
        problems.append(f"中村になろうよのBGMが {len(bgm)} 枚に入っている（1枚のはず）")

    return len(slides), sides, problems


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else \
        Path(__file__).parent / "build" / "結婚式_2択クイズ＆ビンゴ.pptx"
    n, sides, problems = check(target)
    print(f"{target.name}: {n} 枚")
    print("  正解の並び: " + " ".join("左" if s == "left" else "右" for s in sides)
          + f"　(左{sides.count('left')} / 右{sides.count('right')})")
    if problems:
        for p in problems:
            print("  NG:", p)
        sys.exit(1)
    print("  OK: 参照・アニメーション・問題と答えの分離・左右の散らし・効果音すべて問題なし")
