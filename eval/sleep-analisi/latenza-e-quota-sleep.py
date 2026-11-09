import json,glob,re,collections,statistics as st,datetime
def P(s): return datetime.datetime.fromisoformat(s.replace("Z","+00:00"))
lat=collections.defaultdict(list); sl=collections.defaultdict(lambda:[0,0]); sleepsecs=collections.defaultdict(list)
for f in glob.glob("*/*.jsonl"):
    if "eval" in f or "tmp-ab" in f: continue
    proj=f.split("/")[0].replace("--home-fede-documents-projects-","")[:22]
    prev=None
    for l in open(f).read().splitlines():
        try: o=json.loads(l)
        except: continue
        if o.get("type")!="message": continue
        m=o["message"]; ts=o.get("timestamp",""); d=ts[:10]
        if d<"2026-10-12": prev=None; continue
        if m.get("role")=="assistant":
            if prev and prev[0]=="toolResult":
                dt=(P(ts)-P(prev[1])).total_seconds()
                if 0<dt<600: lat[d].append(dt)
            for c in m.get("content",[]):
                if isinstance(c,dict) and c.get("type")=="toolCall" and c.get("name")=="bash":
                    cmd=c.get("arguments",{}).get("command","") or ""
                    k="rec" if d>="2026-11-04" else "old"
                    sl[(proj,k)][0]+=1
                    mm=re.findall(r"\bsleep\s+(\d+)",cmd)
                    if mm: sl[(proj,k)][1]+=1; sleepsecs[k].append(max(int(x) for x in mm))
        prev=(m.get("role"),ts)
print("latenza modello dopo tool result (s) per giorno: n med p90")
for d in sorted(lat):
    v=sorted(lat[d]); print(d,len(v),"%.1f"%st.median(v),"%.1f"%v[int(len(v)*.9)])
print("\nquota comandi con sleep per progetto (old=12/10-3/11, rec=4-6/11)")
for (p,k),(n,s) in sorted(sl.items(),key=lambda x:-x[1][0]):
    if n>=40: print(p,k,n,"sleep %.0f%%"%(100*s/n))
for k in ("old","rec"):
    v=sorted(sleepsecs[k]); print(k,"durata sleep: n",len(v),"med",st.median(v),"p90",v[int(len(v)*.9)],"max",v[-1])
