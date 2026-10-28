#!/usr/bin/env bash
# Eval: does the rule gate make a pi child follow a vault rule it could not guess?
# Usage: eval/vault-regole/run.sh [runs per condition, default 5]
# A rule (function prefix zz_) is in a temporary vault; "gate" = vault on, "control" = PI_VAULT_OFF=1.
set -u
N=${1:-5}
ROOT=$(mktemp -d)
mkdir -p "$ROOT/vault/.obsidian" "$ROOT/vault/regole"
printf -- '---\ntype: regola\npaths: src/**/*.ts\n---\n# Prefisso nomi\nOgni funzione esportata in src deve chiamarsi con prefisso zz_.\n' > "$ROOT/vault/regole/nomi.md"
TASKS=("Crea src/a.ts con una funzione esportata che somma due numeri." "Crea src/b.ts con una funzione esportata che inverte una stringa." "Crea src/c.ts con una funzione esportata che restituisce il massimo di un array.")
for cond in gate control; do
  ok=0; total=0
  for i in $(seq 1 "$N"); do
    task=${TASKS[$(( (i-1) % ${#TASKS[@]} ))]}
    dir="$ROOT/$cond-$i"; mkdir -p "$dir"
    if [ "$cond" = control ]; then env=(PI_VAULT_OFF=1); else env=(PI_VAULT="$ROOT/vault"); fi
    (cd "$dir" && env "${env[@]}" PI_TEAM_CHILD=1 timeout 240 pi --mode json -p --no-session --no-skills --provider claude-code --model claude-haiku-4-5 --tools read,bash,edit,write "$task" >/dev/null 2>&1)
    total=$((total+1))
    f=$(ls "$dir"/src/*.ts 2>/dev/null | head -1)
    if [ -n "$f" ] && grep -Eq 'export (async )?function zz_|export const zz_' "$f"; then ok=$((ok+1)); fi
  done
  echo "$cond: $ok/$total conformi"
done
rm -rf "$ROOT"
