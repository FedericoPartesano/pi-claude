/**
 * Fixed-load provider for UI benchmarks: ignores the prompt and streams a deterministic Markdown document
 * (headings, lists, bold/italic/inline code, code fences) at a fixed rate, with no tools and no thinking.
 * Usage: pi -e prototype/replay/index.ts --provider replay --model fixed
 * REPLAY_MODE=rich: rounds of thinking + Markdown with file:line links + a real `edit` tool call (big diff), then a closing
 * text with a suggestions block. REPLAY_ROUNDS (default 5), REPLAY_KB is then the text size per round (default 2).
 * Env: REPLAY_CPS (chars per second, default 2000), REPLAY_CHUNK (chars per event, default 20), REPLAY_KB (document size, default 120).
 */
import { utimesSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export const document = (kb: number): string => {
	const parts: string[] = [];
	let n = 0;
	while (parts.join("").length < kb * 1024) {
		n++;
		parts.push(`## Sezione ${n}: onde e correnti\n\n`);
		parts.push(`Il **mare** copre circa il *71%* della superficie terrestre; la voce \`salinita_media\` vale circa 35 g/kg e cambia con la latitudine, la temperatura e gli apporti dei fiumi (sezione ${n}).\n\n`);
		parts.push(`- punto **${n}.1**: la corrente del Golfo trasporta calore verso nord\n- punto *${n}.2*: le maree dipendono da Luna e Sole\n- punto \`${n}.3\`: la profondita media e di circa 3.700 metri\n\n`);
		parts.push(`1. prima fase della misura ${n}\n2. seconda fase, con un testo piu lungo che va a capo perche supera la larghezza del terminale quando questo e stretto\n\n`);
		parts.push("```js\n" + `function campiona(n) {\n  return Array.from({ length: n }, (_, i) => i * ${n});\n}\n` + "```\n\n");
		parts.push(`> nota ${n}: i valori sono illustrativi, accenti e simboli inclusi: perche, citta, 12°C.\n\n`);
	}
	return parts.join("").slice(0, kb * 1024);
};

const TARGET = "/tmp/rich-target.txt";
const block = (i: number) => Array.from({ length: 40 }, (_, k) => `riga ${k + 1} valore ${i} ${"x".repeat((k * 7 + i) % 20)}`).join("\n");
const think = (kb: number, round: number) => `Valuto il passo ${round}: confronto le opzioni, controllo i vincoli e scelgo la piu semplice. `.repeat(Math.ceil((kb * 512) / 80)).slice(0, kb * 512);
const richText = (kb: number, round: number) => {
	let t = `## Passo ${round}\n\nModifico \`src/modulo.ts:${10 + round}\` e controllo \`test/modulo.test.ts:${40 + round}\`; vedi anche src/altro.ts:${7 * round}.\n\n`;
	let n = 0;
	while (t.length < kb * 1024) { n++; t += `- voce **${round}.${n}**: il valore \`x${n}\` passa da *${n}* a ${n * 2} (src/util.ts:${n + round})\n`; }
	return t + "\n";
};

export default function (pi: ExtensionAPI) {
	const rich = process.env.REPLAY_MODE === "rich";
	const rounds = Number(process.env.REPLAY_ROUNDS) || 5;
	if (rich) { writeFileSync(TARGET, block(0)); utimesSync(TARGET, 1e9, 1e9); } // old mtime: the stale-file guard would refuse the edit
	const cps = Number(process.env.REPLAY_CPS) || 2000;
	const chunk = Number(process.env.REPLAY_CHUNK) || 20;
	const text = document(Number(process.env.REPLAY_KB) || 120);
	pi.registerProvider("replay", {
		name: "Replay (fixed load)",
		baseUrl: "replay://local",
		apiKey: "none",
		api: "replay-api",
		models: [{ id: "fixed", name: "Fixed replay", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 64000 }],
		streamSimple(model, context, options) {
			const stream = createAssistantMessageEventStream();
			const output: any = {
				role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop", timestamp: Date.now(),
			};
			if (rich) {
				(async () => {
					const msgs: any[] = (context as any).messages ?? [];
					const lastUser = msgs.map((m) => m.role).lastIndexOf("user");
					const round = msgs.slice(lastUser + 1).filter((m) => m.role === "toolResult").length;
					const gap = (chunk / cps) * 1000;
					const sleep = () => new Promise((r) => setTimeout(r, gap));
					const aborted = () => {
						if (!options?.signal?.aborted) return false;
						output.stopReason = "aborted"; output.errorMessage = "aborted";
						stream.push({ type: "error", reason: "aborted", error: output }); stream.end();
						return true;
					};
					stream.push({ type: "start", partial: output });
					const kb = Number(process.env.REPLAY_KB) || 2;
					const th = think(1, round);
					output.content.push({ type: "thinking", thinking: "" });
					stream.push({ type: "thinking_start", contentIndex: 0, partial: output });
					for (let at = 0; at < th.length; at += chunk) {
						if (aborted()) return;
						const d = th.slice(at, at + chunk); output.content[0].thinking += d;
						stream.push({ type: "thinking_delta", contentIndex: 0, delta: d, partial: output }); await sleep();
					}
					stream.push({ type: "thinking_end", contentIndex: 0, content: th, partial: output });
					const text = round >= rounds ? richText(1, round) + "Fatto.\n\n<!--suggerimenti-->\n- primo passo\n- secondo passo\n- terzo passo\n" : richText(kb, round);
					output.content.push({ type: "text", text: "" });
					stream.push({ type: "text_start", contentIndex: 1, partial: output });
					for (let at = 0; at < text.length; at += chunk) {
						if (aborted()) return;
						const d = text.slice(at, at + chunk); output.content[1].text += d; output.usage.output += 1;
						stream.push({ type: "text_delta", contentIndex: 1, delta: d, partial: output }); await sleep();
					}
					stream.push({ type: "text_end", contentIndex: 1, content: text, partial: output });
					if (round >= rounds) { stream.push({ type: "done", reason: "stop", message: output }); stream.end(); return; }
					const args = { path: TARGET, edits: [{ oldText: block(round), newText: block(round + 1) }] };
					const call = { type: "toolCall", id: `call_${round}`, name: "edit", arguments: args };
					output.content.push(call);
					stream.push({ type: "toolcall_start", contentIndex: 2, partial: output });
					stream.push({ type: "toolcall_end", contentIndex: 2, toolCall: call, partial: output });
					output.stopReason = "toolUse";
					stream.push({ type: "done", reason: "toolUse", message: output }); stream.end();
				})();
				return stream;
			}
			(async () => {
				stream.push({ type: "start", partial: output });
				output.content.push({ type: "text", text: "" });
				stream.push({ type: "text_start", contentIndex: 0, partial: output });
				const gap = (chunk / cps) * 1000;
				for (let at = 0; at < text.length; at += chunk) {
					if (options?.signal?.aborted) {
						output.stopReason = "aborted";
						output.errorMessage = "aborted";
						stream.push({ type: "error", reason: "aborted", error: output });
						stream.end();
						return;
					}
					const delta = text.slice(at, at + chunk);
					output.content[0].text += delta;
					output.usage.output += 1;
					stream.push({ type: "text_delta", contentIndex: 0, delta, partial: output });
					await new Promise((r) => setTimeout(r, gap));
				}
				stream.push({ type: "text_end", contentIndex: 0, content: output.content[0].text, partial: output });
				stream.push({ type: "done", reason: "stop", message: output });
				stream.end();
			})();
			return stream;
		},
	});
}
