#!/bin/bash
cd /tmp/uiprof
R=/home/fede/documents/projects/pi-claude
D=$R/eval/ui/drive.py
P="Scrivi."
for rep in 1 2 3; do
  for cfg in pi proto uioff float; do
    out=fair/$cfg-$rep
    export NOPROF=1 MODEL=0
    unset PROG PI_UI PI_UI_PANEL PROTO_DUMP PROTO_CPU
    case $cfg in
      pi)    python3 -I $D $cfg-$rep "$P" 45 -e $R/prototype/replay/index.ts --provider replay --model fixed --no-session > $out.json 2>$out.err ;;
      uioff) PI_UI=off python3 -I $D $cfg-$rep "$P" 45 -e $R/prototype/replay/index.ts --provider replay --model fixed --no-session > $out.json 2>$out.err ;;
      float) PI_UI_PANEL=float python3 -I $D $cfg-$rep "$P" 45 -e $R/prototype/replay/index.ts --provider replay --model fixed --no-session > $out.json 2>$out.err ;;
      proto) PROTO_DUMP=/tmp/uiprof/fair/proto-$rep.screen PROG="node $R/prototype/rpc-chat/chat.mjs" python3 -I $D $cfg-$rep "$P" 45 -e $R/prototype/replay/index.ts --provider replay --model fixed > $out.json 2>$out.err ;;
    esac
  done
done
echo done > fair/DONE
