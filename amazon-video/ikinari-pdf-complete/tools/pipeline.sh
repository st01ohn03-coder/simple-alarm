#!/usr/bin/env bash
# ============================================================
# Amazon 商品動画の制作パイプライン。
#
#   tools/pipeline.sh fetch  B0FVFTZSM7   # ① 調査：商品ページから素材と情報を集める
#   tools/pipeline.sh build                # ③〜⑤ 制作：フォント・音声・映像
#   tools/pipeline.sh qa                   # ⑥ 検品
#   tools/pipeline.sh all   B0FVFTZSM7     # ①→⑥ を通す（②で一度止まる）
#
# ② の「構成と原稿を決める」は人（または Claude）が判断する工程なので
# スクリプトでは飛ばす。どこで何を判断するかは docs/WORKFLOW.md を見ること。
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
die()  { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

need_deps() {
  [ -d node_modules ] || die "依存関係がありません。先に npm install を実行してください。"
}

cmd_fetch() {
  [ $# -ge 1 ] || die "ASIN か商品URLを渡してください: tools/pipeline.sh fetch B0FVFTZSM7"
  need_deps
  step "① 調査：商品ページから素材と情報を集める"
  node tools/fetch-product.js "$1"
}

cmd_build() {
  need_deps
  step "③ フォント：使う文字だけにサブセット化"
  node tools/subset-fonts.js

  step "④ 音声：ナレーションを合成してトラックを作る"
  if python3 -c "import edge_tts" 2>/dev/null; then
    python3 tools/narration.py
  else
    printf 'edge-tts が入っていないのでナレーションを飛ばします（pip install edge-tts）。\n'
    printf '映像は無音で書き出されます。\n'
  fi

  step "⑤ 映像：16:9 と 1:1 を書き出す"
  node tools/render.js --preset 16x9
  node tools/render.js --preset 1x1
}

cmd_qa() {
  need_deps
  step "⑥ 検品"
  node tools/qa.js
}

cmd_all() {
  [ $# -ge 1 ] || die "ASIN か商品URLを渡してください: tools/pipeline.sh all B0FVFTZSM7"
  cmd_fetch "$1"
  cat <<'MSG'

────────────────────────────────────────────────────────
② 構成と原稿を決める（ここは人が判断する工程）

  1. build/<ASIN>/product.json と img/ を読む
  2. 上位版と下位版の差、実績の根拠、レビューの傾向を押さえる
  3. src/video.html の文言、src/assets/ の画像、
     tools/narration.py の LINES を書き換える
  4. セリフが尺に収まるか確認する:
       python3 tools/narration.py --check

  判断の基準は docs/WORKFLOW.md と docs/ANALYSIS.md にある。

  終わったら次を実行:
       tools/pipeline.sh build && tools/pipeline.sh qa
────────────────────────────────────────────────────────
MSG
}

case "${1:-}" in
  fetch) shift; cmd_fetch "$@" ;;
  build) shift; cmd_build "$@" ;;
  qa)    shift; cmd_qa    "$@" ;;
  all)   shift; cmd_all   "$@" ;;
  *)
    # 先頭のコメントブロックをそのまま使い方として出す
    awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"
    exit 1 ;;
esac
