#!/bin/sh
# One haystack run. usage: eval/fold/haystack/run.sh <label> <off|off-noarch|bc|bc-noarch> [gen dir=/tmp/bc-hay]
#   off         Pi's compaction + pi-claude's archive (recall injected from the compacted history)
#   off-noarch  Pi's compaction only (PI_ARCHIVE=0)
#   bc          billion-context (default profile in ~/.pi/acp.json) + archive: the shipped setup
#   bc-noarch   billion-context only: recall depends on the model calling search_context / decompress
# Each run reads its own copy of the project, with no global memory, so runs cannot leak into each other.
set -e
label=$1 config=$2 gen=${3:-/tmp/bc-hay}
here=$(cd "$(dirname "$0")" && pwd)
pkg=${BC_PKG:-/tmp/bcpi-pkg/package/dist/index.js}
work=$gen/runs/$label
rm -rf "$work" && mkdir -p "$work" && cp -R "$gen/proj" "$work/proj"
case $config in
	off) set -- ;;
	off-noarch) export PI_ARCHIVE=0; set -- ;;
	bc) set -- -e "$pkg" ;;
	bc-noarch) export PI_ARCHIVE=0; set -- -e "$pkg" ;;
	*) echo "unknown config $config" >&2; exit 2 ;;
esac
export RUN_CWD=$work/proj PI_MEMORY_GLOBAL_PATH="" OUT=$gen/out
python3 -I "$here/../long.py" "$label" "$gen/scenario.txt" "$@"
node "$here/score.mjs" "$gen/out/$label" "$gen/truth.json" > "$gen/out/$label/score.json"
