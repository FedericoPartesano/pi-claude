import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { UiRequest } from "../bridge";

/** A question Pi waits on, from this window's Pi (an extension dialog) or from a terminal Pi (desk-link). */
export type Question = { id: string; head: string; code: string; tail: string; warn: boolean; options: { label: string; title?: string; key: string; fields: object }[]; input?: string };

/** The key that answers an option, as in the terminal's status bar (s sì · n no · a sempre). */
export function keyFor(option: string, index: number): string {
	// (?!\p{L}) and not \b: "ì" is not a word character for \b.
	if (/^s[iì](?!\p{L}).*sempre/iu.test(option)) return "a";
	if (/^(s[iì]|yes|ok|applica|consenti)(?!\p{L})/iu.test(option)) return "s";
	if (/^(no|annulla)(?!\p{L})/iu.test(option)) return "n";
	return String(index + 1);
}

/** "⚠️ Comando pericoloso (motivo):\n\n  cmd\n\nLo eseguo?" → question, command, closing line. */
function split(title: string) {
	const parts = title.split(/\n\s*\n/);
	if (parts.length >= 3) return { head: parts[0].replace(/^⚠️\s*/, ""), code: parts.slice(1, -1).join("\n\n").trim(), tail: parts[parts.length - 1], warn: /^⚠️/.test(title) };
	return { head: title.replace(/^⚠️\s*/, ""), code: "", tail: "", warn: /^⚠️/.test(title) };
}

export function localQuestion(request: UiRequest): Question {
	const text = split(request.method === "select" ? request.title ?? "" : `${request.title ?? ""}${request.message ? `\n\n${request.message}` : ""}`);
	const labels = request.method === "confirm" ? ["Consenti", "No"] : (request.options ?? []);
	// The words and order of the design: Consenti S · Sempre A · No N (the option itself is what is answered).
	const SHORT: Record<string, string> = { s: "Consenti", a: "Sempre", n: "No" };
	const ORDER = ["s", "a", "n"];
	const options = labels
		.map((value, index) => ({ value, index, key: keyFor(value, index) }))
		.sort((x, y) => (ORDER.indexOf(x.key) + 1 || 9) - (ORDER.indexOf(y.key) + 1 || 9))
		.map(({ value, index, key }) => ({ label: SHORT[key] ?? value, title: value, key, fields: request.method === "confirm" ? { confirmed: index === 0 } : { value } }));
	return { id: request.id, ...text, options: request.method === "input" ? [] : options, input: request.method === "input" ? request.prefill ?? "" : undefined };
}

export function remoteQuestion(question: string): Question {
	return { id: `remote:${question}`, head: question, code: "", tail: "", warn: false, options: [{ label: "Consenti", key: "s", fields: { value: "yes" } }, { label: "Sempre", key: "a", fields: { value: "always" } }, { label: "No", key: "n", fields: { value: "no" } }] };
}

/** The waiting box: the command apart, the answers as buttons with their keys (S / A / N work while nothing is typed). */
export function Ask(props: { question: Question; onAnswer: (fields: object) => void; composerEmpty: () => boolean }) {
	const [value, setValue] = createSignal(props.question.input ?? "");
	let answered = false;
	const answer = (fields: object) => {
		if (answered) return;
		answered = true;
		props.onAnswer(fields);
	};
	const onKey = (event: KeyboardEvent) => {
		if (props.question.input !== undefined || event.ctrlKey || event.metaKey || event.altKey || !props.composerEmpty()) return;
		// A key typed in another field (search, address bar) is text, not an answer.
		const target = event.target as HTMLElement | null;
		if (target?.matches?.("input, textarea, select, [contenteditable]") && target.id !== "input") return;
		const key = event.key.toLowerCase() === "y" ? "s" : event.key.toLowerCase();
		const option = props.question.options.find((o) => o.key === key);
		if (!option) return;
		event.preventDefault();
		event.stopPropagation();
		answer(option.fields);
	};
	onMount(() => window.addEventListener("keydown", onKey, true));
	onCleanup(() => window.removeEventListener("keydown", onKey, true));
	return (
		<div class="ask" classList={{ warn: props.question.warn }}>
			<div class="ask-text">
				<span class="dialog-title">{props.question.head}</span>
				<Show when={props.question.code}><code class="dialog-code">$ {props.question.code}</code></Show>
				<Show when={props.question.tail}><span class="dialog-message">{props.question.tail}</span></Show>
			</div>
			<div class="dialog-actions">
				<Show when={props.question.input !== undefined} fallback={
					<For each={props.question.options}>
						{(option, index) => <button type="button" title={option.title} classList={{ primary: index() === 0, no: option.key === "n" }} onClick={() => answer(option.fields)}>{option.label} <kbd>{option.key.toUpperCase()}</kbd></button>}
					</For>
				}>
					<input value={value()} onInput={(event) => setValue(event.currentTarget.value)} onKeyDown={(event) => {
						if (event.key === "Enter") answer({ value: value() });
						// Esc answers the question only: it must not also stop Pi's turn (App checks defaultPrevented).
						if (event.key === "Escape") (event.preventDefault(), answer({ cancelled: true }));
					}} ref={(el) => queueMicrotask(() => el.focus())} />
					<button type="button" class="primary" onClick={() => answer({ value: value() })}>OK <kbd>↵</kbd></button>
					<button type="button" onClick={() => answer({ cancelled: true })}>Annulla <kbd>Esc</kbd></button>
				</Show>
			</div>
		</div>
	);
}
