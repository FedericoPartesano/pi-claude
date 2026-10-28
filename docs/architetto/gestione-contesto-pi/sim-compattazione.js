const fs=require("fs");const dir=process.argv[2];
const L=fs.readFileSync(dir+"/session.jsonl","utf8").split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
const T0="2026-10-26T06:26:44",T1="2026-10-26T07:17:20";
const W={in:1,cr:0.1,cw:1.25,out:5};
const turns=[];let prev=null;
for(const x of L){ if(x.type==="compaction"){prev=null;continue}
 const u=x.message&&x.message.role==="assistant"&&x.message.usage; if(!u||x.timestamp<T0||x.timestamp>T1)continue;
 const ctx=u.input+u.cacheRead+u.cacheWrite; // prompt size seen
 turns.push({ctx,out:u.output,delta:prev==null?0:Math.max(0,ctx+u.output-prev),first:prev==null}); prev=ctx+u.output;}
const comp=L.filter(x=>x.type==="compaction"&&x.timestamp>=T0&&x.timestamp<=T1);
const cavg={out:comp.reduce((a,x)=>a+x.usage.output,0)/comp.length,cw:comp.reduce((a,x)=>a+x.usage.cacheWrite,0)/comp.length};
const fixed=17773, post=70000;
function run({reserve,win=200000,sumOut=cavg.out,sumCw=cavg.cw}){
 let ctx=turns[0].ctx,cost=0,n=0;
 for(const t of turns){ // each turn: read cached ctx, write delta, output
  const d=t.first?0:t.delta*(globalThis.DS||1); ctx+=d;
  cost+=W.cr*Math.max(0,ctx-d)+W.cw*d+W.out*t.out+W.in*2;
  ctx+=0;
  if(ctx>win-reserve){n++;cost+=W.out*sumOut+W.cw*sumCw*W.cw/W.cw; ctx=post; cost+=W.cw*(post-fixed);} }
 return {n,cost:Math.round(cost/1000)+"k"};
}
console.log("turni",turns.length,"media delta",Math.round(turns.reduce((a,t)=>a+t.delta,0)/turns.length));
const base=run({reserve:80000});console.log("base r80k",base);
for(const r of [60000,40000,30000,16384])console.log("reserve",r,run({reserve:r}));

console.log("r30k + riassunto 8k out",run({reserve:30000,sumOut:8000}));
console.log("r16k + riassunto 8k out",run({reserve:16384,sumOut:8000}));
console.log("r80k + riassunto 8k + lettura cache(cw 5k)",run({reserve:80000,sumOut:8000,sumCw:5000}));
console.log("r30k+8k+cw5k",run({reserve:30000,sumOut:8000,sumCw:5000}))
for(const s of [0.8,0.6,0.5]){globalThis.DS=s;console.log("delta x"+s+" r80k",run({reserve:80000}).cost," | r30k+8k",run({reserve:30000,sumOut:8000}).cost)}
