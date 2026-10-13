"""Experiment 8: fewer calls. A call whose assistant message issues ONE exploration tool, directly followed by another
exploration-only call, could have been merged into the previous one (independent reads/searches issued together).
Upper bound: the merged call disappears (its context re-read is not paid; its output tokens stay). Merge rates: share of
mergeable pairs actually merged (MERGE)."""
import json, re
from model import *
EXP_TOOLS = {"read", "web_search", "fetch_content", "get_search_content"}
EXP_CMD = re.compile(r"\b(rg|grep|find|ls|tree|cat|head|tail|sed -n|wc|fd|git (log|diff|show|status|grep))\b")
BAD = re.compile(r"\b(test|npm|npx|rm |mv |>|tee|sed -i|git (commit|push|add))\b")
def exploring(b):
    if b["name"] in EXP_TOOLS: return True
    if b["name"] == "bash":
        c = str(b.get("arguments", {}).get("command", "")); return bool(EXP_CMD.search(c)) and not BAD.search(c)
    return False
def run(merge):
    tot = save = pairs = n = 0
    for s in corpus():
        flags = []
        for line in open(s["path"]):
            try: e = json.loads(line)
            except: continue
            m = e.get("message")
            if e.get("type") == "message" and m and m.get("role") == "assistant" and m.get("usage"):
                calls = [b for b in m.get("content") or [] if b.get("type") == "toolCall"]
                flags.append(bool(calls) and all(exploring(b) for b in calls))
        costs = simulate(s, 3600)["per_call"]
        for i, c in enumerate(costs):
            tot += c; n += 1
            if i and flags[i] and flags[i - 1]:
                pairs += 1
                out = s["calls"][i]["out"] * O
                save += (c - out) * merge
    return save / tot, pairs, n
if __name__ == '__main__':
  for mg in (0.25, 0.5, 1.0):
    r, p, n = run(mg)
    print(f"unire {mg*100:3.0f}% delle coppie esplorative consecutive ({p}/{n} chiamate): risparmio {r*100:.1f}% del costo")
