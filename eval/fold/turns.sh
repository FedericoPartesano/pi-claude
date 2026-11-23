#!/bin/bash
D=$(cd "$(dirname "$0")" && pwd); OUT=${OUT:-/tmp/bc-bench}
# usage: turns.sh <label> [pi args...] — one pi invocation per file on the same session, then the recall question.
label=$1; shift; out=$OUT/$label; rm -rf $out; mkdir -p $out/sess; : > $out/spawns.log; : > $out/events.jsonl
R=$(cd "$D/../.." && pwd)
files="pi-ui/index.ts extensions/memory.ts extensions/memory-core.ts pi-memory/src/dashboard-tui.ts extensions/goal.ts pi-memory/src/recall.ts extensions/graph/graphify.ts prototype/rpc-chat/cockpit.mjs pi-desk/renderer/src/render.ts pi-team/src/orchestrator.ts pi-claude-code/src/provider.ts pi-team/index.ts eval/cases.mjs extensions/archivio.ts"
cont=""
cd ${RUN_CWD:-/tmp/bc-try}
for f in $files; do
  PATH=$D:$PATH SHIM_LOG=$out/spawns.log pi "$@" $cont --session-dir $out/sess --model haiku --mode json -p "Leggi per intero con il tool read $R/$f (se troncato continua con offset fino alla fine). Poi scrivi una sola riga di sintesi, nient'altro." >> $out/events.jsonl 2>> $out/stderr.log
  cont="--continue"
done
PATH=$D:$PATH SHIM_LOG=$out/spawns.log pi "$@" --continue --session-dir $out/sess --model haiku --mode json -p "Senza rileggere quei file (vietati read, bash, grep, search su di essi; i tool di contesto sono ammessi), rispondi in un blocco \"RISPOSTE:\" con i valori esatti di: 1) FADE_DAYS in memory.ts 2) REMIND_AFTER in memory.ts 3) la stringa POWERSHELL in pi-ui/index.ts 4) MAX_TOPICS_PER_DREAM in memory-core.ts 5) QUADRO_CHARS in memory-core.ts 6) LOOKBACK_CHARS in memory.ts 7) CONTEXT_BUDGET_CHARS in memory.ts. Se non lo sai scrivi \"non so\"." >> $out/events.jsonl 2>> $out/stderr.log
echo "exit $?"
