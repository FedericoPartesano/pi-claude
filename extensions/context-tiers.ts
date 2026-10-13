/**
 * Context Tiers: old tool results shrink to a short digest (head + tail), in blocks.
 *
 * The full transcript stays on disk and in Pi; only what is sent to the model changes, and only when the context is large
 * and a block of old results can free enough to be worth rewriting the cache. Digests say how to get the full text back
 * (repeat the command). PI_CONTEXT_TIERS=0 turns it off. Tuning: PI_TIERS_LIMIT (tokens, default 30000),
 * PI_TIERS_KEEP (recent assistant turns kept whole, default 8).
 */
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CHARS_PER_TOKEN = 2.5;
const HEAD = 700;
const TAIL = 300;
const MIN_WORTH = HEAD + TAIL + 400;

type Message = { role: string; toolCallId?: string; toolName?: string; isError?: boolean; content?: unknown };

const textOf = (message: Message): string =>
	Array.isArray(message.content) ? message.content.map((block: any) => (block?.type === "text" ? block.text : block?.type === "image" ? "x".repeat(4000) : "")).join("") : String(message.content ?? "");

export function digest(text: string, toolName = "tool"): string {
	const hidden = text.length - HEAD - TAIL;
	return `${text.slice(0, HEAD)}\n[… ${hidden} caratteri di output ${toolName} nascosti per risparmiare contesto; ripeti il comando per il testo completo …]\n${text.slice(-TAIL)}`;
}

export function createTiers(options: { limitTokens?: number; keep?: number; minFreeTokens?: number } = {}) {
	const limit = options.limitTokens ?? 30000;
	const keep = options.keep ?? 8;
	const minFree = options.minFreeTokens ?? 8000;
	const hidden = new Set<string>();
	return (messages: Message[]): Message[] => {
		const assistantIndexes = messages.flatMap((m, i) => (m.role === "assistant" ? [i] : []));
		const cutoff = assistantIndexes.length > keep ? assistantIndexes[assistantIndexes.length - keep] : -1;
		const size = (m: Message) => (m.toolCallId && hidden.has(m.toolCallId) ? HEAD + TAIL + 120 : textOf(m).length);
		const total = messages.reduce((sum, m) => sum + size(m), 0) / CHARS_PER_TOKEN;
		if (total > limit) {
			const eligible = messages.filter((m, i) => i < cutoff && m.role === "toolResult" && m.toolCallId && !hidden.has(m.toolCallId) && !m.isError && textOf(m).length > MIN_WORTH);
			const freeable = eligible.reduce((sum, m) => sum + (textOf(m).length - HEAD - TAIL - 120), 0) / CHARS_PER_TOKEN;
			if (freeable >= minFree) for (const m of eligible) hidden.add(m.toolCallId!);
		}
		if (hidden.size === 0) return messages;
		return messages.map((m) => {
			if (m.role !== "toolResult" || !m.toolCallId || !hidden.has(m.toolCallId)) return m;
			const text = textOf(m);
			if (text.length <= MIN_WORTH) return m;
			return { ...m, content: [{ type: "text", text: digest(text, m.toolName) }] };
		});
	};
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_CONTEXT_TIERS === "0") return;
	const tiers = createTiers({ limitTokens: Number(process.env.PI_TIERS_LIMIT) || undefined, keep: Number(process.env.PI_TIERS_KEEP) || undefined });
	pi.on("context", (event) => {
		const out = tiers(event.messages as Message[]);
		if (process.env.PI_TIERS_LOG) {
			const chars = (ms: Message[]) => ms.reduce((s, m) => s + textOf(m).length, 0);
			appendFileSync(process.env.PI_TIERS_LOG, `${event.messages.length} msgs ${chars(event.messages as Message[])} -> ${chars(out)} chars\n`);
		}
		return { messages: out as any };
	});
}
