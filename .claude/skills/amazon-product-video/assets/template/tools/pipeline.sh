#!/usr/bin/env bash
# ============================================================
# Amazon 商品動画の制作パイプライン。
#
#   tools/pipeline.sh doctor               # ⓪ 動く環境か確かめる
#   tools/pipeline.sh fetch  <ASIN>        # ① 調査：商品ページから素材と情報を集める
#   tools/pipeline.sh build                # ③〜⑤ 制作：設定反映・文字・音声・映像
#   tools/pipeline.sh qa                   # ⑥ 検品：表記・レイアウト・可読性・仕様・音声
#   tools/pipeline.sh all   <ASIN>         # ⓪①を通し、②の指示を出して止まる
#   tools/pipeline.sh new   <ASIN> <dir>   # 別の商品のプロジェクトを作る
#
# ② の「構成と原稿を決める」は人（または Claude）が判断する工程なので
# スクリプトでは飛ばす。どこで何を判断するかは docs/WORKFLOW.md を見ること。
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
die()  { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

need_deps() {
  [ -d node_modules ] || die "依存関係がありません。npm install を実行してください。"
}

cmd_doctor() { step "⓪ 環境の確認"; node tools/doctor.js; }

cmd_fetch() {
  [ $# -ge 1 ] || die "ASIN か商品URLを渡してください: tools/pipeline.sh fetch B0XXXXXXXX"
  need_deps
  step "① 調査：商品ページから素材と情報を集める"
  node tools/fetch-product.js "$1"
}

cmd_build() {
  need_deps
  step "③-a 設定：project.json を src に反映する"
  node tools/apply-config.js

  step "③-b 文字：使う文字だけにサブセット化"
  node tools/subset-fonts.js

  step "③-c 表記：入稿先のルールに触れる文言がないか"
  node tools/lint-copy.js

  step "④ 音声：ナレーションを合成してトラックを作る"
  if python3 -c "import edge_tts" 2>/dev/null; then
    python3 tools/narration.py
  else
    printf 'edge-tts が入っていないのでナレーションを飛ばします（pip install edge-tts）。\n'
    printf '映像は無音で書き出されます。\n'
  fi

  step "⑤ 映像：納品するプリセットを書き出す"
  for p in $(node -e "const c=require('./tools/config.js').load();process.stdout.write((c.video.deliverables||Object.keys(c.video.presets)).join(' '))"); do
    node tools/render.js --preset "$p"
  done
}

cmd_qa() { need_deps; step "⑥ 検品"; node tools/qa.js; }

cmd_new() {
  [ $# -ge 2 ] || die "使い方: tools/pipeline.sh new <ASIN> <作る場所>"
  need_deps
  node tools/new-project.js "$1" --dir "$2"
}

cmd_all() {
  [ $# -ge 1 ] || die "ASIN か商品URLを渡してください: tools/pipeline.sh all B0XXXXXXXX"
  cmd_doctor
  cmd_fetch "$1"
  cat <<'MSG'

────────────────────────────────────────────────────────
② 構成と原稿を決める（ここは人が判断する工程）

  1. build/<ASIN>/product.json と img/ を読む
  2. 上位版と下位版の差、実績の根拠、レビューの傾向を押さえる
  3. BRIEF.md を埋めながら、src/video.html の文言、src/assets/ の画像、
     tools/narration.py の LINES を書き換える
  4. 尺と表記を確認する:
       python3 tools/narration.py --check
       node tools/lint-copy.js

  判断の基準は docs/WORKFLOW.md と docs/ANALYSIS.md にある。

  終わったら次を実行:
       tools/pipeline.sh build && tools/pipeline.sh qa
────────────────────────────────────────────────────────
MSG
}

case "${1:-}" in
  doctor) shift; cmd_doctor "$@" ;;
  fetch)  shift; cmd_fetch  "$@" ;;
  build)  shift; cmd_build  "$@" ;;
  qa)     shift; cmd_qa     "$@" ;;
  new)    shift; cmd_new    "$@" ;;
  all)    shift; cmd_all    "$@" ;;
  *)
    # 先頭のコメントブロックをそのまま使い方として出す
    awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"
    exit 1 ;;
esac
