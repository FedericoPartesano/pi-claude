#!/bin/bash
D=$(cd "$(dirname "$0")" && pwd); OUT=${OUT:-/tmp/bc-bench}
# usage: run.sh <label> [pi args...]
label=$1; shift; out=$OUT/$label; mkdir -p $out; : > $out/spawns.log
cd ${RUN_CWD:-/tmp/bc-try} && PATH=$D:$PATH SHIM_LOG=$out/spawns.log pi "$@" --model haiku --no-session --mode json -p "$(cat $D/prompt.txt)" > $out/events.jsonl 2> $out/stderr.log
echo "exit $?"
