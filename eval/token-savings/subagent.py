"""Experiment 9: exploration delegated to a sub-agent with its own small context (the common 'subagent' pattern).
Exploration-only calls run in a fresh context of SUB tokens (cached after its first call; system+tools written once per run);
the main context keeps only a digest (KEEP of the original size) of exploration messages and results.
Upper bound for cost: ignores that the digest may lose facts (quality risk) and sub-agent summaries cost output."""
import json, re
from model import *
import batching
from batching import exploring
SUB, KEEP, SYS = 15000, 0.15, 6000
HAIKU = 1.0
def go(keep=KEEP, sub=SUB):
    tot = new = 0
    for s in corpus():
        flags = {}; order = []
        for line in open(s["path"]):
            try: e = json.loads(line)
            except: continue
            m = e.get("message")
            if e.get("type") == "message" and m and m.get("role") == "assistant" and m.get("usage"):
                calls = [b for b in m.get("content") or [] if b.get("type") == "toolCall"]
                f = bool(calls) and all(exploring(b) for b in calls)
                flags[e["id"]] = f; order.append((e["id"], f, [b.get("id") for b in calls]))
        explore_ids = {i for i, f, _ in order if f}
        tool_ids = {t for i, f, ts in order if f for t in ts}
        def tr(s_, i, ctx):
            out = []
            for it in ctx:
                t = tokens(it, s_)
                if it["id"] in explore_ids or it.get("call_id") in tool_ids: t *= keep
                out.append((it["id"], t))
            return out
        base = simulate(s, 3600); alt = simulate(s, 3600, transform=tr)
        tot += base["cost"]
        runs = 0; prev = False; cost = 0.0
        for k, (i, f, _) in enumerate(order):
            if f:
                if not prev: runs += 1; cost += SYS * W * HAIKU
                cost += (sub * R + s["calls"][k]["out"] * O) * HAIKU
            else:
                cost += alt["per_call"][k]
            prev = f
        new += cost
    return 1 - new / tot
import sys
if __name__ != "__main__": sys.exit
if __name__ == "__main__":
    for hk in (1.0, 1/3):
        HAIKU = hk
        for keep in (0.1, 0.25):
            print(f"sub-agent, esplorazione a prezzo x{hk:.2f}, digest {keep*100:.0f}%: risparmio massimo {go(keep)*100:.1f}%")
