"""Experiment 5: upper bound of routing. Calls whose assistant message only issues exploration tools (read, rg/grep/ls/cat/git
via bash, web search/fetch) could run on a model priced HAIKU_RATIO of the main one (haiku 4.5 vs sonnet: 1/3 per token).
This is an UPPER bound: it ignores that a small model may explore worse (quality risk) and that switching model breaks the cache."""
import json, re
from model import *
EXP_TOOLS = {"read", "web_search", "fetch_content", "get_search_content"}
EXP_CMD = re.compile(r"\b(rg|grep|find|ls|tree|cat|head|tail|sed -n|wc|fd|git (log|diff|show|status|grep))\b")
RATIO = 1 / 3
tot = save = 0; n_calls = n_exp = 0
for s in corpus():
    flags = []
    for line in open(s["path"]):
        try: e = json.loads(line)
        except: continue
        m = e.get("message")
        if e.get("type") == "message" and m and m.get("role") == "assistant" and m.get("usage"):
            calls = [b for b in m.get("content") or [] if b.get("type") == "toolCall"]
            def exploring(b):
                if b["name"] in EXP_TOOLS: return True
                if b["name"] == "bash":
                    c = str(b.get("arguments", {}).get("command", ""))
                    return bool(EXP_CMD.search(c)) and not re.search(r"\b(test|npm|npx|rm |mv |>|tee|sed -i|git (commit|push|add))\b", c)
                return False
            flags.append(bool(calls) and all(exploring(b) for b in calls))
    costs = simulate(s, 3600)["per_call"]
    for f, c in zip(flags, costs):
        tot += c; n_calls += 1
        if f: save += c * (1 - RATIO); n_exp += 1
print(f"chiamate di sola esplorazione: {n_exp}/{n_calls} ({n_exp/n_calls*100:.0f}%)")
print(f"risparmio massimo teorico con modello 1/3 del prezzo su quelle chiamate: {save/tot*100:.1f}% del costo totale")
