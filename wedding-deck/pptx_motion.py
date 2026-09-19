# -*- coding: utf-8 -*-
"""python-pptx が扱えない「アニメーション」と「効果音」を素の OOXML で組み立てる。

参考にした構造は、お預かりした『チーム対抗企画スライド 3』の
クイズスライド（10秒カウントダウン＋正解発表効果音）とまったく同じ。
"""
from __future__ import annotations

import copy

from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.oxml.ns import nsdecls
from pptx.parts.media import MediaPart
from pptx.util import Emu

MEDIA_RT = "http://schemas.microsoft.com/office/2007/relationships/media"

_SEQ_CONDS = (
    '<p:prevCondLst><p:cond evt="onPrev" delay="0">'
    "<p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>"
    '<p:nextCondLst><p:cond evt="onNext" delay="0">'
    "<p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>"
)


class Mp3:
    """MediaPart.new() が期待する Media インターフェースの最小実装。"""

    def __init__(self, path):
        with open(path, "rb") as f:
            self._blob = f.read()

    blob = property(lambda self: self._blob)
    content_type = property(lambda self: "audio/mpeg")
    ext = property(lambda self: "mp3")

    @property
    def duration_ms(self):
        """128kbps CBR 前提のおおよその長さ。dur 属性のヒントに使うだけ。"""
        return int(len(self._blob) * 8 / 128000 * 1000)


_AUDIO_PIC = (
    "<p:pic %s>"
    '<p:nvPicPr><p:cNvPr id="{sid}" name="{name}">'
    '<a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr>'
    '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>'
    '<p:nvPr><a:audioFile r:link="{r_audio}"/>'
    '<p:extLst><p:ext uri="{{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}}">'
    '<p14:media xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"'
    ' r:embed="{r_media}"/></p:ext></p:extLst></p:nvPr></p:nvPicPr>'
    '<p:blipFill><a:blip r:embed="{r_icon}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
    '<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
)


class AudioLibrary:
    """同じ mp3 をデッキ全体で 1 パートだけ持ち、各スライドから参照する。"""

    def __init__(self, presentation, icon_path):
        self._prs = presentation
        self._parts = {}
        self._icon_path = icon_path
        self._icon_parts = {}

    def _media_part(self, path):
        if path not in self._parts:
            mp3 = Mp3(path)
            part = MediaPart.new(self._prs.part.package, mp3)
            self._parts[path] = (part, mp3.duration_ms)
        return self._parts[path]

    def _icon_rid(self, slide):
        """スピーカーアイコン画像。スライドごとに 1 度だけ関連付ける。"""
        key = id(slide.part)
        if key not in self._icon_parts:
            img_part, rid = slide.part.get_or_add_image_part(self._icon_path)
            self._icon_parts[key] = rid
        return self._icon_parts[key]

    def add(self, slide, path, name, shape_id, offstage_index=0):
        """スライドに音声オブジェクトを置き、(shape_id, 長さms) を返す。

        アイコンはスライド外（左側のマイナス座標）に逃がして本番では見えないようにする。
        """
        part, dur = self._media_part(path)
        r_media = slide.part.relate_to(part, MEDIA_RT)
        r_audio = slide.part.relate_to(part, RT.AUDIO)
        r_icon = self._icon_rid(slide)

        from pptx.oxml import parse_xml

        pic = parse_xml(
            (_AUDIO_PIC % nsdecls("p", "a", "r")).format(
                sid=shape_id,
                name=name,
                r_audio=r_audio,
                r_media=r_media,
                r_icon=r_icon,
                x=-900000 - offstage_index * 500000,
                y=200000,
                cx=406400,
                cy=406400,
            )
        )
        slide.shapes._spTree.append(pic)
        return shape_id, dur


# --------------------------------------------------------------------------
# タイムライン
# --------------------------------------------------------------------------
class _Effect:
    """1 つのアニメーション効果。id は最後にまとめて採番する。"""

    def __init__(self, kind, spid, delay=0, dur=None, first=False):
        self.kind = kind          # "appear" | "disappear" | "play" | "pulse"
        self.spid = spid
        self.delay = delay
        self.dur = dur
        self.first = first        # クリックグループの先頭かどうか

    @property
    def id_count(self):
        return 3 if self.kind == "pulse" else 2

    def xml(self, base):
        node = "clickEffect" if self.first else "withEffect"
        a, b = base, base + 1
        if self.kind in ("appear", "disappear"):
            cls = "entr" if self.kind == "appear" else "exit"
            vis = "visible" if self.kind == "appear" else "hidden"
            return (
                f'<p:par><p:cTn id="{a}" presetID="1" presetClass="{cls}" presetSubtype="0"'
                f' fill="hold" grpId="0" nodeType="{node}">'
                f'<p:stCondLst><p:cond delay="{self.delay}"/></p:stCondLst><p:childTnLst>'
                f'<p:set><p:cBhvr><p:cTn id="{b}" dur="1" fill="hold">'
                f'<p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>'
                f'<p:tgtEl><p:spTgt spid="{self.spid}"/></p:tgtEl>'
                f"<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>"
                f'</p:cBhvr><p:to><p:strVal val="{vis}"/></p:to></p:set>'
                f"</p:childTnLst></p:cTn></p:par>"
            )
        if self.kind == "play":
            return (
                f'<p:par><p:cTn id="{a}" presetID="1" presetClass="mediacall" presetSubtype="0"'
                f' fill="hold" nodeType="{node}">'
                f'<p:stCondLst><p:cond delay="{self.delay}"/></p:stCondLst><p:childTnLst>'
                f'<p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr>'
                f'<p:cTn id="{b}" dur="{self.dur}" fill="hold"/>'
                f'<p:tgtEl><p:spTgt spid="{self.spid}"/></p:tgtEl>'
                f"</p:cBhvr></p:cmd></p:childTnLst></p:cTn></p:par>"
            )
        # pulse: 赤枠を点滅＋わずかに拡大縮小させて「正解！」を強調する
        c = base + 2
        return (
            f'<p:par><p:cTn id="{a}" presetID="26" presetClass="emph" presetSubtype="0"'
            f' repeatCount="5000" fill="hold" grpId="1" nodeType="{node}">'
            f'<p:stCondLst><p:cond delay="{self.delay}"/></p:stCondLst><p:childTnLst>'
            f'<p:animEffect transition="out" filter="fade"><p:cBhvr>'
            f'<p:cTn id="{b}" dur="500" tmFilter="0, 0; .2, .5; .8, .5; 1, 0"/>'
            f'<p:tgtEl><p:spTgt spid="{self.spid}"/></p:tgtEl></p:cBhvr></p:animEffect>'
            f'<p:animScale><p:cBhvr><p:cTn id="{c}" dur="250" autoRev="1" fill="hold"/>'
            f'<p:tgtEl><p:spTgt spid="{self.spid}"/></p:tgtEl></p:cBhvr>'
            f'<p:by x="105000" y="105000"/></p:animScale>'
            f"</p:childTnLst></p:cTn></p:par>"
        )


class Timeline:
    """クリック（またはスライド表示）単位のグループを組み立てる。"""

    def __init__(self):
        self._groups = []      # list[(auto: bool, list[_Effect])]
        self._triggers = []    # list[(trigger_spid, list[_Effect])]
        self._audio_spids = []
        self._cursor = None

    def group(self, auto=False):
        """次のクリックで再生されるグループを開く。"""
        self._groups.append((auto, []))
        self._cursor = self._groups[-1][1]
        return self

    def trigger(self, shape_id):
        """指定した図形を「クリックしたとき」だけ再生されるグループを開く。

        PowerPoint の［アニメーション］→［トリガー］→［クリック時］と同じ仕組み。
        スライドを送る普通のクリックでは再生されない。
        """
        self._triggers.append((shape_id, []))
        self._cursor = self._triggers[-1][1]
        return self

    def appear(self, spid, delay=0):
        self._cursor.append(_Effect("appear", spid, delay))
        return self

    def disappear(self, spid, delay=0):
        self._cursor.append(_Effect("disappear", spid, delay))
        return self

    def play(self, spid, dur, delay=0):
        self._cursor.append(_Effect("play", spid, delay, dur))
        self._audio_spids.append(spid)
        return self

    def pulse(self, spid, delay=0):
        self._cursor.append(_Effect("pulse", spid, delay))
        return self

    def countdown(self, oval_spid, number_spids, audio_spid, audio_dur, seconds=10):
        """10 → 0 のカウントダウン。1 秒ごとに数字を差し替える。"""
        self.play(audio_spid, audio_dur)
        self.appear(oval_spid)
        for i, spid in enumerate(number_spids):
            t = i * 1000
            self.appear(spid, delay=t)
            if i < len(number_spids) - 1:
                self.disappear(spid, delay=t + 1000)
        return self

    @property
    def is_empty(self):
        return not any(e for _, e in self._groups) and not any(e for _, e in self._triggers)

    def _group_xml(self, effects, start_cond, next_id):
        """2段のラッパー <p:par> でくるんだ 1 グループ分の XML を返す。"""
        outer, inner = next_id, next_id + 1
        next_id += 2
        body = []
        for i, eff in enumerate(effects):
            eff.first = i == 0
            body.append(eff.xml(next_id))
            next_id += eff.id_count
        xml = (
            f'<p:par><p:cTn id="{outer}" fill="hold">'
            f"<p:stCondLst>{start_cond}</p:stCondLst><p:childTnLst>"
            f'<p:par><p:cTn id="{inner}" fill="hold">'
            f'<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
            + "".join(body)
            + "</p:childTnLst></p:cTn></p:par>"
            "</p:childTnLst></p:cTn></p:par>"
        )
        return xml, next_id

    def xml(self):
        if self.is_empty:
            return None
        next_id = 3
        chunks = []
        for auto, effects in self._groups:
            if not effects:
                continue
            start = '<p:cond delay="0"/>' if auto else '<p:cond delay="indefinite"/>'
            xml, next_id = self._group_xml(effects, start, next_id)
            chunks.append(xml)

        main_seq = ""
        if chunks:
            main_seq = (
                '<p:seq concurrent="1" nextAc="seek">'
                '<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'
                + "".join(chunks)
                + "</p:childTnLst></p:cTn>" + _SEQ_CONDS + "</p:seq>"
            )

        interactive = []
        for trig_spid, effects in self._triggers:
            if not effects:
                continue
            seq_id = next_id
            next_id += 1
            body, next_id = self._group_xml(effects, '<p:cond delay="0"/>', next_id)
            interactive.append(
                '<p:seq concurrent="1" nextAc="seek">'
                f'<p:cTn id="{seq_id}" restart="whenNotActive" fill="hold" evt="onClick"'
                f' nodeType="interactiveSeq">'
                f'<p:stCondLst><p:cond evt="onClick" delay="0">'
                f'<p:tgtEl><p:spTgt spid="{trig_spid}"/></p:tgtEl></p:cond></p:stCondLst>'
                f'<p:endSync evt="end" delay="0"><p:rtn val="all"/></p:endSync>'
                f"<p:childTnLst>{body}</p:childTnLst></p:cTn>" + _SEQ_CONDS + "</p:seq>"
            )

        audio_nodes = []
        for spid in dict.fromkeys(self._audio_spids):
            audio_nodes.append(
                f'<p:audio><p:cMediaNode vol="80000">'
                f'<p:cTn id="{next_id}" fill="hold" display="0">'
                f'<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>'
                f'<p:endCondLst><p:cond evt="onStopAudio" delay="0">'
                f"<p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:endCondLst></p:cTn>"
                f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cMediaNode></p:audio>'
            )
            next_id += 1

        return (
            "<p:timing %s><p:tnLst><p:par>" % nsdecls("p", "a")
            + '<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
            + main_seq
            + "".join(interactive)
            + "".join(audio_nodes)
            + "</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>"
        )


def apply_timing(slide, timeline):
    from pptx.oxml import parse_xml

    xml = timeline.xml()
    if xml is None:
        return
    slide._element.append(parse_xml(xml))


def apply_transition(slide, kind="fade", speed="med"):
    """スライド切り替え効果。<p:timing> より前に置く必要がある。"""
    from pptx.oxml import parse_xml
    from pptx.oxml.ns import qn

    body = {"fade": "<p:fade/>", "push": '<p:push dir="u"/>', "wipe": '<p:wipe dir="r"/>'}[kind]
    elm = parse_xml(f'<p:transition {nsdecls("p")} spd="{speed}">{body}</p:transition>')
    timing = slide._element.find(qn("p:timing"))
    if timing is not None:
        timing.addprevious(elm)
    else:
        slide._element.append(elm)
