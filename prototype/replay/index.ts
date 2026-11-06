/**
 * Fixed-load provider for UI benchmarks: ignores the prompt and streams a deterministic Markdown document
 * (headings, lists, bold/italic/inline code, code fences) at a fixed rate, with no tools and no thinking.
 * Usage: pi -e prototype/replay/index.ts --provider replay --model fixed
 * Env: REPLAY_CPS (chars per second, default 2000), REPLAY_CHUNK (chars per event, default 20), REPLAY_KB (document size, default 120).
 */
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

export default function (pi: ExtensionAPI) {
	const cps = Number(process.env.REPLAY_CPS) || 2000;
	const chunk = Number(process.env.REPLAY_CHUNK) || 20;
	const text = document(Number(process.env.REPLAY_KB) || 120);
	pi.registerProvider("replay", {
		name: "Replay (fixed load)",
		baseUrl: "replay://local",
		apiKey: "none",
		api: "replay-api",
		models: [{ id: "fixed", name: "Fixed replay", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 64000 }],
		streamSimple(model, _context, options) {
			const stream = createAssistantMessageEventStream();
			const output: any = {
				role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop", timestamp: Date.now(),
			};
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
