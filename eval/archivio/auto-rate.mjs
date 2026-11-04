import { readFileSync } from "node:fs";
import { archivedEntries, chunkArchive, autoRecall, contentText } from "../../extensions/archivio.ts";
let n=0,fired=0,chars=0;
for (const f of process.argv.slice(2)) {
  const all = readFileSync(f,"utf8").split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return {}}});
  let lastC=-1; const comps=[]; all.forEach((e,i)=>{if(e.type==="compaction")comps.push(i)});
  for (const c of comps.slice(0,6)) {
    const upto = all.slice(0,c+1); const chunks = chunkArchive(archivedEntries(upto));
    let seen=0;
    for (let i=c+1;i<all.length && seen<12;i++){ const m=all[i].message; if(all[i].type==="compaction")break; if(m?.role==="user"){ const t=contentText(m.content); if(t.length>400)continue; seen++; n++; const r=autoRecall(chunks,t); if(r){fired++;chars+=r.length} } }
  }
}
console.log(JSON.stringify({prompts:n,fired,rate:Math.round(100*fired/n)+"%",avgChars:Math.round(chars/Math.max(fired,1))}));
