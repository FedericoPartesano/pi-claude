# Scores the noid bench: strict (value present and no "not found" claim), lenient (value present), wrong injections on "neg" prompts, weighted cost.
import json,re,glob,sys,os
bad=re.compile(r'non trov|nessun dato|assent|nessun risultato|non (è|e) presente|non ho',re.I)
for a in "AB":
    S=L=N=inj_neg=neg=0;c=[];cp=[];comp=[]
    for f in sorted(glob.glob(f'eval/ab/result-noid-{a}-*.json')):
        d=json.load(open(f)); c.append(d['total']); comp.append(d['compactions'])
        for t in d['turns']:
            if t['phase']=='post':
                N+=1; L+=t['expect'] in t['answer']; S+=(t['expect'] in t['answer'] and not bad.search(t['answer']))
            if t['phase']=='neg': neg+=1
        r=f.split('-')[-1][:-5]
        sf=sorted(glob.glob(os.path.expanduser(f'~/.pi/agent/sessions/--tmp-ab-noid-{a}-{r}--/*.jsonl')))[-1]
        cur=None
        for l in open(sf):
            e=json.loads(l); m=e.get('message') or {}
            if e.get('customType')=='archive-recall' or m.get('customType')=='archive-recall':
                if cur=='neg': inj_neg+=1   # the recall rides right after the user message it was computed for
            elif m.get('role')=='user':
                txt=json.dumps(m.get('content'))
                cur='neg' if re.search(r'bolle|messaggi di commit|promise e un callback|indice hash|vantaggi dei test|inverte una stringa|acronimo REST|somma due numeri',txt) else 'other'
    print(a,f'runs {len(c)} strict {S}/{N} lenient {L}/{N} wrong injections on neg {inj_neg}/{neg} compactions {comp} avg cost {sum(c)/max(1,len(c)):.0f}')
