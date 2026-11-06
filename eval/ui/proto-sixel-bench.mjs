import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
const src = readFileSync("/home/fede/documents/projects/pi-claude/prototype/rpc-chat/chat.mjs","utf8");
const a = src.indexOf("const pngSize"), b = src.indexOf("// Add an image block");
const fn = new Function("inflateSync", src.slice(a,b)+"; return {decodePng, sixel};")(inflateSync);
const b64 = readFileSync("/tmp/big.png").toString("base64");
for (const [pw,ph] of [[560,360]]) {
  const img = { b64 };
  let t=process.hrtime.bigint(); const s = fn.sixel(img,pw,ph); const first=Number(process.hrtime.bigint()-t)/1e6;
  t=process.hrtime.bigint(); for(let i=0;i<20;i++) fn.sixel(img,pw,ph); const rep=Number(process.hrtime.bigint()-t)/1e6/20;
  console.log(pw+"x"+ph,"bytes",s.length,"first_ms",first.toFixed(1),"cached_decode_ms",rep.toFixed(1), "end", JSON.stringify(s.slice(-6)), "head", JSON.stringify(s.slice(0,18)));
}
