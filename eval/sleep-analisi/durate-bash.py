import json,glob,re,collections,statistics as st,datetime
days=collections.defaultdict(lambda:{"n":0,"dur":[],"timeout":0,"sleep":0,"slow30":0,"calls":0})
for f in glob.glob("*/*.jsonl"):
    if "eval" in f or "/tmp" in f: continue
    pend={}
    try: lines=open(f).read().splitlines()
    except: continue
    for l in lines:
        try: o=json.loads(l)
        except: continue
        if o.get("type")!="message": continue
        m=o["message"]; ts=o.get("timestamp","")
        d=ts[:10]
        if m.get("role")=="assistant":
            for c in m.get("content",[]):
                if isinstance(c,dict) and c.get("type")=="toolCall" and c.get("name")=="bash":
                    pend[c["id"]]=(ts,c.get("arguments",{}).get("command","") or "")
        elif m.get("role")=="toolResult" and m.get("toolName")=="bash":
            p=pend.pop(m.get("toolCallId"),None)
            if not p: continue
            t0=datetime.datetime.fromisoformat(p[0].replace("Z","+00:00")); t1=datetime.datetime.fromisoformat(ts.replace("Z","+00:00"))
            dur=(t1-t0).total_seconds()
            x=days[d]; x["n"]+=1; x["dur"].append(dur)
            txt=json.dumps(m.get("content"))
            if re.search(r"timed out|Command timed out|timeout",txt,re.I) and m.get("isError"): x["timeout"]+=1
            if re.search(r"\bsleep\s+\d",p[1]): x["sleep"]+=1
            if dur>30: x["slow30"]+=1
for d in sorted(days):
    if d<"2026-10-01": continue
    x=days[d]; v=sorted(x["dur"])
    print(d,"n",x["n"],"med%.1f"%st.median(v),"p90 %.1f"%v[int(len(v)*.9)],"max %.0f"%v[-1],">30s",x["slow30"],"timeout",x["timeout"],"sleep",x["sleep"])
