// The chat as a Solid store: Pi's RPC events become turns (user, Pi, notes). A Pi turn is its parts in real order:
// thinking, text, tool steps, errors. Text deltas are buffered and applied once per frame (Solid then updates only the
// part that changed; the markdown component re-renders only the block that changed).
import { createStore, produce } from "solid-js/store";
import type { Img, TranscriptItem, UiRequest } from "./bridge";
// The same words the terminal uses for what a tool does ("legge src/app.ts", "esegue npm test").
import { phrase } from "../../../pi-ui/src/phrases.ts";

export type Step = { id: string; name: string; args: Record<string, unknown>; state: "run" | "ok" | "err"; ms?: number; output?: string; images?: Img[] };
export type Part =
	| { kind: "thinking"; text: string; live: boolean; seconds?: number }
	| { kind: "text"; text: string }
	| { kind: "steps"; steps: Step[] }
	| { kind: "error"; text: string };
export type Turn =
	| { id: number; role: "user"; text: string; images?: Img[]; at?: number }
	| { id: number; role: "pi"; parts: Part[]; suggestions: string[]; done: boolean; seconds?: number; tokensIn?: number; tokensOut?: number }
	| { id: number; role: "note"; text: string; tone?: "error" };

let nextId = 1;
const id = () => nextId++;

export function createChat() {
	// What Pi is doing now (the terminal's "AL LAVORO" line) and the last turn's totals ("FATTO").
	const [work, setWork] = createStore({ phase: "idle" as "idle" | "thinking" | "tool" | "writing" | "done" | "compacting", activity: "", thought: "", started: 0, steps: 0, tokensIn: 0, tokensOut: 0, seconds: 0, queued: 0, queuedText: "", retry: "", error: "" });
	let phaseBeforeCompaction: typeof work.phase = "idle";
	const k = (count: number) => (count >= 1000 ? `${Math.round(count / 1000)}k` : String(count));
	const REASONS: Record<string, string> = { threshold: "contesto oltre la soglia", overflow: "contesto pieno", manual: "richiesta manuale" };
	const [state, set] = createStore({ typing: false, turns: [] as Turn[], busy: false, status: "pronto", statuses: {} as Record<string, string>, dialog: undefined as UiRequest | undefined, exited: undefined as string | undefined });
	// Indices of what is being written now.
	let turn = -1;
	let text = -1;
	let thinking = -1;
	let thinkStart = 0;
	let steps = -1;
	const tools = new Map<string, { part: number; index: number; start: number }>();
	let pendingText = "";
	let pendingThink = "";
	let frame = 0;

	const piTurn = (): number => {
		if (turn < 0) {
			set("turns", (turns) => [...turns, { id: id(), role: "pi", parts: [], suggestions: [], done: false }]);
			turn = state.turns.length - 1;
		}
		return turn;
	};
	const parts = () => (state.turns[turn] as Extract<Turn, { role: "pi" }>).parts;

	const closeThinking = () => {
		if (thinking < 0) return;
		const index = thinking;
		set("turns", turn, produce((t: any) => {
			t.parts[index].live = false;
			t.parts[index].seconds = Math.max(1, Math.round((Date.now() - thinkStart) / 1000));
		}));
		thinking = -1;
	};

	const flush = () => {
		frame = 0;
		if (pendingThink) {
			const delta = pendingThink;
			pendingThink = "";
			piTurn();
			if (thinking < 0) {
				set("turns", turn, produce((t: any) => t.parts.push({ kind: "thinking", text: "", live: true })));
				thinking = parts().length - 1;
				thinkStart = Date.now();
				steps = -1;
			}
			set("turns", turn, "parts" as never, thinking as never, "text" as never, ((old: string) => old + delta) as never);
		}
		if (pendingText) {
			// Typewriter: a steady reveal, a few characters per frame, faster when the model gets ahead (never more
			// than ~18 frames behind). message_end and tools flush the rest at once (flushNow).
			const take = revealAll ? pendingText.length : Math.min(pendingText.length, Math.max(4, Math.ceil(pendingText.length / 18)));
			const delta = pendingText.slice(0, take);
			pendingText = pendingText.slice(take);
			closeThinking();
			piTurn();
			if (text < 0) {
				set("turns", turn, produce((t: any) => t.parts.push({ kind: "text", text: "" })));
				text = parts().length - 1;
				steps = -1;
			}
			set("turns", turn, "parts" as never, text as never, "text" as never, ((old: string) => old + delta) as never);
			if (pendingText) {
				frame = requestAnimationFrame(flush);
				set("typing", true);
				return;
			}
		}
		set("typing", false);
	};
	const schedule = () => {
		if (!frame) frame = requestAnimationFrame(flush);
	};
	let revealAll = false;
	const flushNow = () => {
		if (frame) cancelAnimationFrame(frame);
		revealAll = true;
		flush();
		revealAll = false;
	};

	function onEvent(event: any) {
		switch (event.type) {
			case "compaction_start":
				phaseBeforeCompaction = work.phase;
				setWork({ phase: "compacting", activity: REASONS[event.reason] ?? "contesto", started: work.started || Date.now() });
				break;
			case "compaction_end": {
				const result = event.result;
				if (result) set("turns", (turns) => [...turns, { id: id(), role: "note", text: `◇ Contesto compattato: ${k(result.tokensBefore ?? 0)} → ~${k(result.estimatedTokensAfter ?? 0)} token (${REASONS[event.reason] ?? event.reason})` }]);
				else if (!event.aborted) set("turns", (turns) => [...turns, { id: id(), role: "note", tone: "error", text: `Compattazione non riuscita: ${event.errorMessage ?? "errore"}` }]);
				setWork({ phase: state.busy ? (phaseBeforeCompaction === "compacting" ? "thinking" : phaseBeforeCompaction) : "done" });
				break;
			}
			case "auto_retry_start":
				setWork({ retry: `riprovo ${event.attempt}/${event.maxAttempts} tra ${Math.round((event.delayMs ?? 0) / 1000)} s · ${String(event.errorMessage ?? "").slice(0, 60)}` });
				break;
			case "auto_retry_end":
				setWork({ retry: "" });
				if (!event.success) set("turns", (turns) => [...turns, { id: id(), role: "note", tone: "error", text: `Il provider non risponde: ${event.finalError ?? "errore"} (${event.attempt} tentativi)` }]);
				break;
			case "queue_update":
				setWork({ queued: (event.steering?.length ?? 0) + (event.followUp?.length ?? 0), queuedText: String([...(event.steering ?? []), ...(event.followUp ?? [])].pop() ?? "") });
				break;
			case "agent_start":
				set({ busy: true, status: "sta lavorando…", exited: undefined });
				if (work.phase === "idle" || work.phase === "done") setWork({ phase: "thinking", activity: "", thought: "", started: Date.now(), steps: 0, tokensIn: 0, tokensOut: 0, seconds: 0, error: "" });
				break;
			case "message_start":
				if (event.message?.role === "assistant") {
					flushNow();
					text = -1;
				}
				break;
			case "message_update": {
				const update = event.assistantMessageEvent;
				if (update?.type === "thinking_delta") {
					pendingThink += update.delta;
					// The latest thought, one short line.
					const last = (work.thought + update.delta).split(/\n|(?<=[.!?])\s/).filter((line) => line.trim()).pop() ?? "";
					setWork({ phase: "thinking", thought: last.trim().slice(-90) });
				} else if (update?.type === "text_delta") {
					pendingText += update.delta;
					if (work.phase !== "writing") setWork({ phase: "writing", activity: "scrivo la risposta" });
				}
				schedule();
				break;
			}
			case "message_end":
				if (event.message?.usage) setWork({ tokensIn: work.tokensIn + (event.message.usage.input ?? 0) + (event.message.usage.cacheRead ?? 0) + (event.message.usage.cacheWrite ?? 0), tokensOut: work.tokensOut + (event.message.usage.output ?? 0) });
				flushNow();
				closeThinking();
				if (event.message?.errorMessage) {
					piTurn();
					set("turns", turn, produce((t: any) => t.parts.push({ kind: "error", text: event.message.errorMessage })));
					setWork({ error: String(event.message.errorMessage) });
				}
				text = -1;
				break;
			case "tool_execution_start": {
				flushNow();
				closeThinking();
				text = -1;
				piTurn();
				if (steps < 0) {
					set("turns", turn, produce((t: any) => t.parts.push({ kind: "steps", steps: [] })));
					steps = parts().length - 1;
				}
				const part = steps;
				set("turns", turn, produce((t: any) => t.parts[part].steps.push({ id: event.toolCallId, name: event.toolName, args: event.args ?? {}, state: "run" })));
				tools.set(event.toolCallId, { part, index: (parts()[part] as any).steps.length - 1, start: Date.now() });
				set("status", `${event.toolName} ${brief(event.toolName, event.args)}`.slice(0, 64));
				setWork({ phase: "tool", activity: phrase(event.toolName, event.args ?? {}).text, steps: work.steps + 1 });
				break;
			}
			case "tool_execution_end": {
				const tool = tools.get(event.toolCallId);
				if (!tool || turn < 0) break;
				tools.delete(event.toolCallId);
				const content = (event.result?.content ?? []) as { type: string; text?: string; data?: string; mimeType?: string }[];
				const output = content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
				const images = content.filter((block) => block.type === "image" && block.data).map((block) => ({ data: block.data!, mimeType: block.mimeType ?? "image/png" }));
				set("turns", turn, produce((t: any) => {
					const step = t.parts[tool.part].steps[tool.index];
					step.state = event.isError ? "err" : "ok";
					step.ms = Date.now() - tool.start;
					step.output = output.length > 8000 ? `${output.slice(0, 8000)}\n… (${output.length - 8000} caratteri in più)` : output;
					if (images.length) step.images = images;
				}));
				set("status", "sta lavorando…");
				setWork({ phase: "thinking", thought: "" });
				break;
			}
			case "agent_settled":
				flushNow();
				closeThinking();
				if (turn >= 0) set("turns", turn, produce((t: any) => Object.assign(t, { done: true, seconds: Math.round((Date.now() - work.started) / 1000), tokensIn: work.tokensIn, tokensOut: work.tokensOut })));
				turn = -1;
				text = -1;
				steps = -1;
				set({ busy: false, status: "pronto" });
				setWork({ phase: "done", seconds: Math.round((Date.now() - work.started) / 1000) });
				break;
		}
	}

	function onUi(request: UiRequest) {
		if (request.method === "notify") return void set("turns", (turns) => [...turns, { id: id(), role: "note", text: request.message ?? "" }]);
		if (request.method === "setStatus") return void set("statuses", produce((statuses: Record<string, string>) => {
			if (request.statusText) statuses[request.statusKey!] = request.statusText;
			else delete statuses[request.statusKey!];
		}));
		if (["confirm", "select", "input"].includes(request.method)) set("dialog", request);
	}

	return {
		state,
		work,
		onEvent,
		onUi,
		closeDialog: () => set("dialog", undefined),
		addUser: (text: string, images?: Img[]) => set("turns", (turns) => [...turns, { id: id(), role: "user", text, images, at: Date.now() }]),
		addNote: (text: string, tone?: "error") => set("turns", (turns) => [...turns, { id: id(), role: "note", text, tone }]),
		exited: (code: string) => set({ busy: false, status: "Pi fermo", exited: code }),
		restarted: () => set({ exited: undefined, status: "pronto" }),
		replace: (turns: Turn[]) => {
			turn = -1;
			set("turns", turns);
		},
	};
}

export type Chat = ReturnType<typeof createChat>;

export function brief(name: string, args: any = {}): string {
	if (name === "browser") return [args.action, args.url ?? args.ref, args.do, args.text].filter(Boolean).join(" ");
	return String(args.command ?? args.path ?? args.file_path ?? args.url ?? args.query ?? args.pattern ?? args.id ?? args.goal ?? "").replace(/\s+/g, " ");
}

/** A saved session's transcript as turns (read-only views and resumed sessions). */
export function transcriptTurns(items: TranscriptItem[]): Turn[] {
	const turns: Turn[] = [];
	let pi: Extract<Turn, { role: "pi" }> | undefined;
	let steps: Extract<Part, { kind: "steps" }> | undefined;
	for (const item of items) {
		if (item.role === "user") {
			turns.push({ id: id(), role: "user", text: item.text, images: item.images });
			pi = undefined;
			steps = undefined;
			continue;
		}
		if (!pi) {
			pi = { id: id(), role: "pi", parts: [], suggestions: [], done: true };
			turns.push(pi);
		}
		if (item.role === "tool") {
			if (!steps) {
				steps = { kind: "steps", steps: [] };
				pi.parts.push(steps);
			}
			const [name, ...rest] = item.text.split(" ");
			steps.steps.push({ id: `t${id()}`, name, args: { path: rest.join(" ") }, state: "ok", images: item.images });
		} else {
			pi.parts.push(item.role === "error" ? { kind: "error", text: item.text } : { kind: "text", text: item.text });
			steps = undefined;
		}
	}
	return turns;
}
