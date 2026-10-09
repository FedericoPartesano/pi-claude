import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { Dialog } from "@kobalte/core/dialog";
import { TriangleAlert } from "lucide-solid";
import type { UiRequest } from "../bridge";

/** The key that answers an option, as in the terminal's status bar (s sì · n no · a sempre). */
function keyFor(option: string, index: number): string {
	// (?!\p{L}) and not \b: "ì" is not a word character for \b.
	if (/^s[iì](?!\p{L}).*sempre/iu.test(option)) return "a";
	if (/^(s[iì]|yes|ok|applica)(?!\p{L})/iu.test(option)) return "s";
	if (/^(no|annulla)(?!\p{L})/iu.test(option)) return "n";
	return String(index + 1);
}

/** "⚠️ Comando pericoloso (motivo):\n\n  cmd\n\nLo eseguo?" → question, command, closing line. */
function split(title: string) {
	const parts = title.split(/\n\s*\n/);
	if (parts.length >= 3) return { head: parts[0].replace(/^⚠️\s*/, ""), code: parts.slice(1, -1).join("\n\n").trim(), tail: parts[parts.length - 1], warn: /^⚠️/.test(title) };
	return { head: title, code: "", tail: "", warn: /^⚠️/.test(title) };
}

/** One answer per request: Pi's extension dialogs (confirm, select, input), answerable with the keys of the terminal. */
function Body(props: { request: UiRequest; onAnswer: (fields: object) => void }) {
	const [value, setValue] = createSignal(props.request.prefill ?? "");
	let answered = false;
	const answer = (fields: object) => {
		if (answered) return;
		answered = true;
		props.onAnswer(fields);
	};
	const options = () => (props.request.method === "confirm" ? ["Sì", "No"] : (props.request.options ?? []));
	const fieldsFor = (option: string) => (props.request.method === "confirm" ? { confirmed: /^s[iì]/iu.test(option) } : { value: option });
	const text = () => split(props.request.method === "select" ? props.request.title ?? "" : `${props.request.title ?? ""}${props.request.message ? `\n\n${props.request.message}` : ""}`);
	const onKey = (event: KeyboardEvent) => {
		if (props.request.method === "input") {
			if (event.key === "Enter") answer({ value: value() });
			if (event.key === "Escape") answer({ cancelled: true });
			return;
		}
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const key = event.key.toLowerCase() === "y" ? "s" : event.key.toLowerCase();
		const index = options().findIndex((option, i) => keyFor(option, i) === key);
		if (index >= 0) {
			event.preventDefault();
			answer(fieldsFor(options()[index]));
		} else if (event.key === "Enter") {
			event.preventDefault();
			answer(fieldsFor(options()[0]));
		} else if (event.key === "Escape") {
			event.preventDefault();
			const no = options().find((option) => /^(no|annulla)\b/i.test(option));
			answer(no ? fieldsFor(no) : { cancelled: true });
		}
	};
	onMount(() => window.addEventListener("keydown", onKey, true));
	onCleanup(() => window.removeEventListener("keydown", onKey, true));
	return (
		<>
			<Dialog.Title class="dialog-title" classList={{ warn: text().warn }}>
				<Show when={text().warn}><TriangleAlert size={16} /></Show>
				{text().head}
			</Dialog.Title>
			<Show when={text().code}><pre class="dialog-code">{text().code}</pre></Show>
			<Show when={text().tail}><Dialog.Description class="dialog-message">{text().tail}</Dialog.Description></Show>
			<div class="dialog-actions">
				<Switch>
					<Match when={props.request.method === "input"}>
						<input value={value()} onInput={(event) => setValue(event.currentTarget.value)} autofocus />
						<button type="button" onClick={() => answer({ cancelled: true })}>Annulla <kbd>Esc</kbd></button>
						<button type="button" class="primary" onClick={() => answer({ value: value() })}>OK <kbd>↵</kbd></button>
					</Match>
					<Match when={true}>
						<For each={options()}>
							{(option, index) => (
								<button type="button" classList={{ primary: index() === 0, danger: /^no\b/i.test(option) }} onClick={() => answer(fieldsFor(option))}>
									{option} <kbd>{keyFor(option, index()).toUpperCase()}</kbd>
								</button>
							)}
						</For>
					</Match>
				</Switch>
			</div>
		</>
	);
}

/** Mounted in the chat column: the browser panel is a native view on top. */
export function ExtensionDialog(props: { request?: UiRequest; mount?: HTMLElement; onAnswer: (fields: object) => void }) {
	return (
		<Dialog open={Boolean(props.request)} modal>
			<Dialog.Portal mount={props.mount}>
				<Dialog.Overlay class="dialog-overlay" />
				<div class="dialog-position">
					<Dialog.Content class="dialog" onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()}>
						<Show when={props.request} keyed>{(request) => <Body request={request} onAnswer={props.onAnswer} />}</Show>
					</Dialog.Content>
				</div>
			</Dialog.Portal>
		</Dialog>
	);
}
