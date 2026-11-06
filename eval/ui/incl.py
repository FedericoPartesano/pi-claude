import json, sys, collections, glob, os
MARK = "node" + "_modules/"
f = sorted(glob.glob(sys.argv[1] + "/*.cpuprofile"), key=lambda f: -os.path.getsize(f))[0]
p = json.load(open(f)); nodes = {n["id"]: n for n in p["nodes"]}
parent = {}
for n in p["nodes"]:
    for c in n.get("children", []): parent[c] = n["id"]
selfus = collections.Counter()
for nid, d in zip(p["samples"], p["timeDeltas"]): selfus[nid] += d
def name(n):
    c = n["callFrame"]; url = c["url"].split(MARK)[-1].split("/pi-claude/")[-1].split("/")[-1]
    return f'{c["functionName"] or "anon"}@{url}:{c["lineNumber"]}'
incl = collections.Counter(); calls = collections.Counter()
for nid, us in selfus.items():
    cur = nid; seen = set()
    while True:
        l = name(nodes[cur])
        if l not in seen: seen.add(l); incl[l] += us
        if cur in parent: cur = parent[cur]
        else: break
total = sum(selfus.values()); idle = sum(v for k, v in selfus.items() if nodes[k]["callFrame"]["functionName"] == "(idle)")
print("busy ms", round((total - idle) / 1000), "of", round(total / 1000))
want = sys.argv[2:]
rows = [(us, l) for l, us in incl.items() if any(w in l for w in want)]
for us, l in sorted(rows, reverse=True)[:25]: print(f"  {us/1000:7.0f} ms  {l}")
