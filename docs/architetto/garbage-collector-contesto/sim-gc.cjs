// Offline replay of a Pi session under a context GC. Usage: node sim-gc.js <session.jsonl>
// Costs in units of one input token: cacheRead 0.1, cacheWrite 1.25, output 5 (same weights as ../gestione-contesto-pi/sim-compattazione.js).
const fs = require("fs");
const W = { cr: Number(process.env.W_CR || 0.1), cw: 1.25, out: 5 };
const FIXED = 17800, WINDOW = 200000; let POST = 57000;
let RESERVE = 80000, SUMMARY_OUT = 6400, SUMMARY_CW = 40000;
const CPT = 2.5, PLACEHOLDER = 45, IMAGE = 1400;
const lines = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const tok = (s) => Math.ceil(String(s).length / CPT);
const sizeOf = (content) => Array.isArray(content) ? content.reduce((n, b) => n + (b.type === "text" ? tok(b.text) : b.type === "image" ? IMAGE : b.type === "toolCall" ? tok(JSON.stringify(b.arguments)) + 20 : b.type === "thinking" ? 0 : 0), 0) : tok(content || "");
const keyOf = (call) => { const a = call.arguments || {}; return call.name + ":" + (a.path || a.file_path || a.command || JSON.stringify(a)); };
const isWrite = (call) => /^(edit|write|multi_edit)$/i.test(call.name);

// Events in order: user/assistant/toolResult messages with their size, plus the key of each tool call.
const calls = new Map(); const ev = []; let turn = 0;
for (const x of lines) {
  const m = x.message; if (!m) continue;
  if (m.role === "assistant") { turn++; for (const b of m.content || []) if (b.type === "toolCall") calls.set(b.id, b); ev.push({ t: turn, kind: "assistant", size: sizeOf(m.content), out: (m.usage && m.usage.output) || 100, writes: (m.content || []).filter((b) => b.type === "toolCall" && isWrite(b)).map((b) => (b.arguments.path || b.arguments.file_path)) }); }
  else if (m.role === "user") ev.push({ t: turn, kind: "user", size: sizeOf(m.content) });
  else if (m.role === "toolResult") { const c = calls.get(m.toolCallId); ev.push({ t: turn, kind: "tool", size: sizeOf(m.content), key: c ? keyOf(c) : "?", tool: m.toolName, image: Array.isArray(m.content) && m.content.some((b) => b.type === "image") }); }
}
const realCompactions = lines.filter((x) => x.type === "compaction").length;

function runCap(cap, need) {
  let ctx = FIXED, cost = 0, compactions = 0, ctxSum = 0, ctxN = 0, capped = 0, saved = 0;
  const redo = [];
  for (const e of ev) {
    let size = e.size;
    if (e.kind === "assistant") { ctxSum += ctx; ctxN++; cost += W.cr * (ctx - e.size) + W.out * e.out; }
    if (e.kind === "tool" && size > cap) { capped++; saved += size - 400; size = 400; if (need > 0 && Math.random() < need) { ctx += e.size; cost += W.cw * e.size + W.out * 150 + W.cr * ctx; } }
    ctx += size; cost += W.cw * size;
    if (ctx > WINDOW - RESERVE) { compactions++; cost += W.out * SUMMARY_OUT + W.cw * SUMMARY_CW + W.cw * POST; ctx = POST; }
  }
  return { avgCtxK: Math.round(ctxSum / ctxN / 1000), cost: Math.round(cost / 1000), compactions, capped, savedK: Math.round(saved / 1000) };
}
function run(policy) {
  // policy: { keep, minFree, promote, images, expire, all, minSize }
  let items = []; let ctx = FIXED; let cost = 0; let compactions = 0; let recalls = 0, promoted = 0, evictions = 0, evictedTok = 0, expired = 0;
  const trash = new Map(); // key -> { recalls, evictedAt, size }
  let lastTurn = 0; let ctxSum = 0, ctxN = 0;
  const place = (e) => { items.push({ ...e, live: true, born: e.t }); ctx += e.size; cost += W.cw * e.size; };
  const stale = new Set();
  for (const e of ev) {
    if (e.kind === "assistant") { ctxSum += ctx; ctxN++; cost += W.cr * (ctx - e.size) + W.out * e.out; for (const p of e.writes) if (p) stale.add(p); }
    if (e.t !== lastTurn && policy) {
      lastTurn = e.t;
      // block eviction: only when enough can be freed to be worth rewriting the cache
      const cand = items.filter((i) => i.live && !i.pinned && i.kind === "tool" && (e.t - i.t > policy.keep) && i.size >= (policy.minSize || 300) && (policy.all || true));
      const freeable = cand.reduce((n, i) => n + i.size - PLACEHOLDER, 0);
      if (freeable >= policy.minFree && ctx > (policy.start || 30000)) {
        for (const i of cand) { i.live = false; ctx -= i.size - PLACEHOLDER; evictedTok += i.size; evictions++; const t = trash.get(i.key) || { recalls: 0, size: i.size }; t.evictedAt = e.t; trash.set(i.key, t); }
        cost += W.cw * ctx; // the suffix after the first change is rewritten once
      }
      for (const [k, t] of trash) if (!t.pinned && e.t - t.evictedAt > policy.expire) { trash.delete(k); expired++; }
    }
    if (e.kind === "tool" && policy && trash.has(e.key) && !stale.has(e.key.split(":").slice(1).join(":"))) {
      const t = trash.get(e.key); t.recalls++; recalls++;
      if (t.recalls >= policy.promote && !t.pinned) { t.pinned = true; promoted++; }
      place({ ...e, pinned: t.pinned });
      continue;
    }
    if (e.kind === "tool") { const k = e.key.split(":").slice(1).join(":"); stale.delete(k); }
    place(e);
    if (ctx > WINDOW - RESERVE) { compactions++; cost += W.out * SUMMARY_OUT + W.cw * SUMMARY_CW + W.cw * POST; ctx = POST; items = items.map((i) => ({ ...i, live: false })); trash.clear(); }
  }
  return { avgCtxK: Math.round(ctxSum / ctxN / 1000), cost: Math.round(cost / 1000), compactions, evictions, evictedK: Math.round(evictedTok / 1000), recalls, promoted, expired };
}

const toolTok = ev.filter((e) => e.kind === "tool").reduce((n, e) => n + e.size, 0), allTok = ev.reduce((n, e) => n + e.size, 0);
// Re-fetch census: same tool+target seen again, with the gap in assistant turns.
const seen = new Map(); const gaps = []; let refetchTok = 0;
for (const e of ev) if (e.kind === "tool") { const p = seen.get(e.key); if (p !== undefined && e.size > 300) { gaps.push(e.t - p); refetchTok += e.size; } seen.set(e.key, e.t); }
gaps.sort((a, b) => a - b); const q = (p) => gaps.length ? gaps[Math.floor((gaps.length - 1) * p)] : null;
const images = ev.filter((e) => e.image).length;
console.log(JSON.stringify({ file: process.argv[2].split("/").pop().slice(0, 30), turns: turn, realCompactions, tokAll: Math.round(allTok / 1000) + "k", toolShare: Math.round(100 * toolTok / allTok) + "%", images, bigResults: ev.filter((e) => e.kind === "tool" && e.size > 300).length, refetches: gaps.length, refetchShareOfTool: Math.round(100 * refetchTok / toolTok) + "%", gapP50: q(0.5), gapP90: q(0.9) }));
const base = run(null); console.log("base", JSON.stringify(base));
const out = [];
for (const [keep, minFree, start] of [[4, 15000, 60000], [4, 30000, 100000], [10, 30000, 100000], [10, 45000, 100000]]) {
  const r = run({ keep, minFree, start, promote: 3, expire: 30 });
  out.push({ keep, minFree, start, ...r, quota: Math.round(100 * (1 - r.cost / base.cost)) + "%", ctxMedio: Math.round(100 * (1 - r.avgCtxK / base.avgCtxK)) + "%" });
}
console.table(out);

const caps = [];
for (const cap of [1500, 3000]) for (const need of [0, 0.1, 0.25]) {
  let acc = 0; const N = 20; let last;
  for (let i = 0; i < N; i++) { last = runCap(cap, need); acc += last.cost; }
  caps.push({ cap, need, avgCtxK: last.avgCtxK, cost: Math.round(acc / N), compactions: last.compactions, capped: last.capped, quota: Math.round(100 * (1 - acc / N / base.cost)) + "%", ctxMedio: Math.round(100 * (1 - last.avgCtxK / base.avgCtxK)) + "%" });
}
console.log("cap at source (no cache rewrite):"); console.table(caps);

// Combined levers: compaction reserve, summary output cap (cw shrinks with it), tool-result cap at source.
const baseCost = base.cost; const rows = [];
function combo(reserve, cap, sumCw, post = 57000) {
  RESERVE = reserve; SUMMARY_CW = sumCw; POST = post;
  let acc = 0, last; for (let i = 0; i < 10; i++) { last = runCap(cap, 0.1); acc += last.cost; }
  RESERVE = 80000; SUMMARY_CW = 40000; POST = 57000;
  return { reserve, cap, sumCw, post, compactions: last.compactions, avgCtxK: last.avgCtxK, cost: Math.round(acc / 10), vs: Math.round(100 * (1 - acc / 10 / baseCost)) + "%" };
}
// summary on cached prefix: cacheWrite 40k -> ~12k-equivalent (reading 120k at 0.1 = 12k units / 1.25)
for (const [r, c, w, po] of [[80000, 1e9, 40000, 57000], [80000, 1e9, 40000, 40000], [80000, 1e9, 40000, 30000], [80000, 1e9, 9600, 57000], [80000, 1e9, 9600, 40000], [80000, 1500, 9600, 40000], [90000, 1500, 9600, 35000]]) rows.push(combo(r, c, w, po));
console.log("combined"); console.table(rows);
