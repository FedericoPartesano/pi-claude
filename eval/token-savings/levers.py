"""Experiment 3: levers on real sessions, priced with the cache model (TTL 1h, the better fit).
Levers (all keep the full transcript on disk; only what is SENT to the model changes):
  mask   old tool results -> placeholder, in blocks (keeps the cache prefix stable between blocks)
  think  old thinking blocks dropped from the history
  args   old edit/write arguments (the file is on disk) -> placeholder
  cap    every new tool result limited to CAP tokens (head+tail), a model can re-read the rest
  index  search/read results shrunk by IDX (assumption: a symbol/embedding index returns focused snippets)
Re-read penalty: RE of each masked/capped token comes back as new context."""
import sys, re
from model import *
import decompose

PH = 25  # placeholder tokens

def make(lever, T=40000, K=12, MINFREE=15000, CAP=2500, IDX=0.5, RE=0.15):
    def transform(s, i, ctx):
        st = s.setdefault("_st", {"masked": set(), "i": -1, "pen": 0.0, "pens": {}})
        if st["i"] >= i or i == 0: st.update(masked=set(), i=-1, pen=0.0, pens={})
        st["i"] = i
        n_now = i  # calls so far
        def raw(it):
            t = tokens(it, s)
            if it["role"] == "toolResult":
                if "cap" in lever and t > CAP:
                    st["pen"] += 0  # penalty applied below, once per item
                    t = CAP
                if "index" in lever and decompose.kind(it) in ("bash: ricerca/lettura (rg, grep, ls, cat, git)", "read (file)"):
                    t *= IDX
            return t
        def size(it, masked):
            if it["id"] in masked:
                if it["role"] == "toolResult": return PH
                sp = it["split"]; tot = sum(sp.values()) or 1
                keep = sp["tx"] + (0 if "think" in lever else sp["th"]) + (0 if "args" in lever else sp["ared"]) + sp["aro"]
                return tokens(it, s) * keep / tot + 8
            return raw(it)
        masked = st["masked"]
        if lever & {"mask", "think", "args"}:
            cur = sum(size(it, masked) for it in ctx)
            elig = []
            for it in ctx:
                if it["id"] in masked or n_now - it["n"] < K: continue
                if "mask" in lever and it["role"] == "toolResult": elig.append(it)
                elif it["role"] == "assistant" and (("think" in lever and it["split"]["th"]) or ("args" in lever and it["split"]["ared"])): elig.append(it)
            freeable = sum(raw(it) - size(it, masked | {it["id"]}) for it in elig)
            if cur > T and freeable >= MINFREE:
                pen = 0.0
                for it in elig:
                    masked.add(it["id"]); pen += (raw(it) - size(it, masked)) * RE if it["role"] == "toolResult" else 0
                if pen and ctx: st["pens"][ctx[-1]["id"]] = st["pens"].get(ctx[-1]["id"], 0) + pen
        out = []
        for it in ctx:
            out.append((it["id"] + ("*" if it["id"] in masked else ""), size(it, masked)))
            if it["id"] in st["pens"]: out.append(("pen" + it["id"], st["pens"][it["id"]]))
        return out
    return transform

def run(lever, **kw):
    data = corpus(); base = tot = 0
    rows = []
    for s in data:
        s.pop("_st", None)
        b = simulate(s, 3600)["cost"]
        a = simulate(s, 3600, transform=make(lever, **kw))["cost"]
        base += b; tot += a; rows.append((s["name"], 1 - a / b))
    return 1 - tot / base, rows

if __name__ == "__main__":
    combos = [("mask",), ("think",), ("args",), ("cap",), ("index",), ("mask", "think", "args"), ("mask", "think", "args", "cap"), ("mask", "think", "args", "cap", "index")]
    for c in combos:
        r, rows = run(set(c))
        print(f"{'+'.join(c):28} risparmio {r*100:5.1f}%   per sessione min {min(x[1] for x in rows)*100:5.1f}%  max {max(x[1] for x in rows)*100:5.1f}%")
