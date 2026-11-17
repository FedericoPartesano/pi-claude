// One long run without model calls: real skills extension -> status/events -> real footer and panel renderers.
// Checks the whole flow (activation, chip, panel, off, agent_end) at several widths, and measures render cost with/without skills.
import { performance } from "node:perf_hooks";
import skills from "../../extensions/skills.ts";
import { renderFooter } from "../../pi-ui/src/footer.ts";
import { renderPanel } from "../../pi-ui/src/panel.ts";
const strip = (t) => t.replace(/\x1b\[[0-9;]*m/g, "");
const handlers = {}, commands = {}, statuses = new Map(); let state, hidden = [];
skills({ registerMessageRenderer: () => {}, events: { emit: (_n, d) => (state = d) }, on: (e, h) => (handlers[e] = h), registerCommand: (n, c) => (commands[n] = c) });
const ctx = { cwd: process.cwd(), hasUI: true, ui: { setStatus: (k, t) => (t === undefined ? statuses.delete(k) : statuses.set(k, t)), notify: () => {} } };
const base = { usage: {}, files: [], failures: [], session: statuses };
const view = (width) => ({ footer: strip(renderFooter({ statuses, project: "p", model: "sonnet", thinking: "medium" }, width)), panel: renderPanel({ ...base, usage: { model: "sonnet", thinking: "medium" }, skills: state }, 44, "alt+s").map(strip).join("\n") });
const log = [];
const step = async (label, fn, expect) => { const r = await fn(); const v = view(140); const ok = expect(v, r); log.push([ok ? "OK " : "KO ", label]); if (!ok) console.log(v.footer, "\n", v.panel); };
await step("commit: chip + iniezione", async () => handlers.before_agent_start({ messageType: "user", prompt: "committa le modifiche e pusha" }, ctx), (v, r) => /SKILL git-workflow/.test(v.footer) && r?.message?.customType === "skill-activation" && /▶ git-workflow/.test(v.panel) && /SKILL/.test(v.panel));
await step("fine turno: chip sparisce, storico resta", () => handlers.agent_end({}, ctx), (v) => !/SKILL/.test(v.footer.replace(/SKILLS?\b.*spente/, "")) && /git-workflow-and-versioning/.test(v.panel));
await step("domanda generica: nessuna iniezione", async () => handlers.before_agent_start({ messageType: "user", prompt: "cosa fa questa funzione?" }, ctx), (v, r) => r === undefined && !statuses.has("skill"));
await step("/skills off git: panel mostra spenta", () => commands.skills.handler("off git-workflow-and-versioning", ctx), (v) => /1 spente/.test(v.panel) && /spente: git-workflow/.test(v.panel));
await step("commit con skill spenta: nessuna iniezione", async () => handlers.before_agent_start({ messageType: "user", prompt: "committa le modifiche e pusha" }, ctx), (v, r) => r === undefined);
await step("/skills on: riaccesa", () => commands.skills.handler("on git-workflow-and-versioning", ctx), (v) => !/spente/.test(v.panel));
// widths: every line exactly at width
let widthOk = true;
statuses.set("skill", "git-workflow-and-versioning · ? debugging-and-error-recovery");
for (const w of [40, 60, 80, 100, 140]) { const l = strip(renderFooter({ statuses, project: "p", model: "sonnet", thinking: "medium" }, w)); if ([...l].length > w) widthOk = false; }
log.push([widthOk ? "OK " : "KO ", "footer entro la larghezza a 40-140 colonne"]);
// cost: render with and without skills state
const bench = (withSkills) => { const s = withSkills ? state : undefined; const m = new Map(withSkills ? statuses : []); const t = performance.now(); for (let i = 0; i < 2000; i++) { renderPanel({ ...base, usage: { model: "sonnet", thinking: "medium" }, skills: s }, 44, "alt+s"); renderFooter({ statuses: m, project: "p", model: "sonnet", thinking: "medium" }, 120); } return ((performance.now() - t) / 2000).toFixed(3); };
bench(true); const a = bench(false), b = bench(true);
// route cost per message
const t0 = performance.now(); for (let i = 0; i < 500; i++) await handlers.before_agent_start({ messageType: "user", prompt: "ho un problema con il layout della pagina" }, ctx); const per = ((performance.now() - t0) / 500).toFixed(2);
console.log(log.map((l) => l.join(" ")).join("\n"));
console.log(`render panel+footer ms/frame: senza skill ${a}, con skill ${b}; before_agent_start (incl. git status) ms/msg: ${per}`);
process.exit(log.some((l) => l[0] === "KO ") ? 1 : 0);
