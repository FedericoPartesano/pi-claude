import json,glob,re,collections
by=collections.defaultdict(lambda:[0,0,[]])
for f in glob.glob("*/*.jsonl"):
    if "eval" in f or "tmp-ab" in f: continue
    model="?"
    for l in open(f).read().splitlines():
        try: o=json.loads(l)
        except: continue
        if o.get("type")=="model_change": model=o.get("modelId","?")
        if o.get("type")!="message": continue
        m=o["message"]; d=o.get("timestamp","")[:10]
        if d<"2026-10-20" or m.get("role")!="assistant": continue
        for c in m.get("content",[]):
            if isinstance(c,dict) and c.get("type")=="toolCall" and c.get("name")=="bash":
                cmd=c.get("arguments",{}).get("command","") or ""
                k=(d,model); by[k][0]+=1
                if re.search(r"\bsleep\s+\d",cmd): by[k][1]+=1
for (d,mo),(n,s,_) in sorted(by.items()):
    if n>=30: print(d,mo,n,"sleep %.0f%%"%(100*s/n))
