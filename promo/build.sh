#!/usr/bin/env bash
# SneakDraw プロモ動画をゼロから書き出す。
#
#   ./build.sh            … 素材取得 → ナレーション → フレーム → 音 → エンコード
#   ./build.sh --no-tts   … ナレーション生成を飛ばす（既存の work/vo を使う）
set -euo pipefail
cd "$(dirname "$0")"

FFMPEG=$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
OUT=out/sneakdraw_promo_30s.mp4

echo "==> 1/5 素材を取得"
python3 fetch_assets.py

echo "==> 2/5 ナレーションとタイムライン"
if [ "${1:-}" = "--no-tts" ]; then
  python3 tts.py --skip-tts
else
  python3 tts.py
fi

echo "==> 3/5 フレームを書き出し（1920x1080 / 30fps）"
node capture.mjs

echo "==> 4/5 BGM・SEを合成してミックス"
python3 audio.py

echo "==> 5/5 エンコード"
mkdir -p out
"$FFMPEG" -y -loglevel warning \
  -framerate 30 -i work/frames/f%05d.jpg \
  -i work/mix.wav \
  -map 0:v -map 1:a -shortest \
  -c:v libx264 -preset slow -crf 18 -profile:v high -level 4.1 \
  -pix_fmt yuv420p -x264-params "keyint=60:min-keyint=30" \
  -c:a aac -b:a 192k -ar 48000 -ac 2 \
  -movflags +faststart \
  "$OUT"

"$FFMPEG" -hide_banner -i "$OUT" 2>&1 | sed -n '/Input/,$p'
ls -lh "$OUT"
