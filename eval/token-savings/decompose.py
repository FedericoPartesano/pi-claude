"""Experiment 2: where does the cost go? Every call's cost is attributed to the items of its context (cached tokens at R,
written tokens at W), then summed by kind. TTL 1h (the better fit in experiment 1)."""
import re, collections, sys
from model import *

EXPLORE = re.compile(r"^\s*(rg|grep|find|ls|tree|cat|head|tail|sed -n|wc|git (log|diff|show|status|grep)|fd)\b")

def kind(it):
    if it["role"] == "toolResult":
        if it["tool"] == "read": return "read (file)"
        if it["tool"] == "bash":
            c = it.get("cmd", "")
            if re.search(r"\b(test|jest|vitest|pytest|tsc|build|lint|npm run|node --test|npx)\b", c): return "bash: test/build/lint"
            if re.search(r"\b(rg|grep|find|ls|tree|cat|head|tail|sed -n|wc|fd|git (log|diff|show|status|grep))\b", c): return "bash: ricerca/lettura (rg, grep, ls, cat, git)"
            return "bash: altro"
        if it["tool"] in ("edit", "write"): return f"{it['tool']}"
        return f"tool: {it['tool']}"
    return {"assistant": "risposte del modello", "user": "messaggi utente", "custom": "ricordi/messaggi custom", "summary": "riassunti di compattazione"}.get(it["role"], it["role"])

def attribute(s, ttl=3600):
    prev, prev_t = None, None
    shares = collections.Counter(); out = 0.0; fixed = 0.0; tools = collections.Counter()
    for c in s["calls"]:
        seq = [("__fixed__", s["fixed"], None)] + [(it["id"], tokens(it, s), it) for it in c["ctx"]]
        warm = prev is not None and c["t"] - prev_t <= ttl
        budget = 0.0
        if warm:
            for a, b in zip(prev, seq):
                if a[0] != b[0]: break
                budget += a[1]
        budget = max(budget, min(s["fixed"], 11000))
        left = budget
        for key, tk, it in seq:
            cached = min(tk, max(0.0, left)); left -= cached
            cost = cached * R + (tk - cached) * W
            if it is None: fixed += cost
            else:
                k = kind(it); shares[k] += cost
                if it["role"] == "toolResult": tools[it["tool"]] += cost
        out += c["out"] * O
        prev, prev_t = seq, c["t"]
    return shares, fixed, out

if __name__ == "__main__":
    data = corpus()
    tot = collections.Counter(); F = Out = 0
    for s in data:
        sh, f, o = attribute(s)
        tot.update(sh); F += f; Out += o
    T = sum(tot.values()) + F + Out
    print(f"{len(data)} sessioni, costo totale modellato {T/1e6:.1f}M token-equivalenti\n")
    rows = list(tot.items()) + [("system prompt + definizioni tool", F), ("output del modello (scritto, 5x)", Out)]
    for k, v in sorted(rows, key=lambda x: -x[1]):
        print(f"{v/T*100:5.1f}%  {v/1e6:5.2f}M  {k}")
