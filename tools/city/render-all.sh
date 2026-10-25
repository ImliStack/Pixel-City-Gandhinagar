#!/bin/zsh
# Render remaining city layers sequentially (one GPU job at a time), then export every completed layer.
set -e
cd "$(dirname "$0")/../.."
export PATH="$HOME/.nvm/versions/node/v22.13.0/bin:$PATH"
CFG=config/cities/gandhinagar-city.json
MODES=("$@"); (( ${#MODES} )) || MODES=(night monsoon winter B source)
for m in $MODES; do
  echo "=== layer $m $(date +%H:%M:%S)"
  node tools/city/render.mjs --config $CFG --mode $m ${FRESH:+--fresh} $([[ $m == A ]] && echo --seam --seam-region 5-4) > outputs/city/render-$m.log 2>&1 || { echo "FAILED $m"; tail -5 outputs/city/render-$m.log; exit 1; }
  tail -1 outputs/city/render-$m.log
done
echo "=== export $(date +%H:%M:%S)"
node tools/capital/export.mjs --config $CFG --data config/cities/gandhinagar-city-data.json > outputs/city/export.log 2>&1 || { echo "FAILED export"; tail -5 outputs/city/export.log; exit 1; }
tail -1 outputs/city/export.log
echo "=== done $(date +%H:%M:%S)"
