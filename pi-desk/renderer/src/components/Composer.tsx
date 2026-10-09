import { createSignal, For, Show } from "solid-js";
import { X } from "lucide-solid";
import { desk, type Img } from "../bridge";
import { matchFiles, mentionAt } from "../mention";

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SIDE = 2000;

/** A pasted or dropped image as base64; big ones scaled down (a screenshot of a 4K screen would be megabytes of tokens). */
async function toImage(file: File): Promise<Img | undefined> {
	if (!file.type.startsWith("image/")) return undefined;
	if (file.size <= MAX_BYTES) {
		const data = await new Promise<string>((resolve) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
			reader.readAsDataURL(file);
		});
		return { data, mimeType: file.type };
	}
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
	const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
	canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
	const buffer = new Uint8Array(await blob.arrayBuffer());
	let binary = "";
	for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
	return { data: btoa(binary), mimeType: "image/jpeg" };
}

/** How Pi should take the message: act (default), plan first, or only answer. */
export type Mode = "Agisci" | "Piano" | "Chiedi";
export const MODES: [Mode, string][] = [["Agisci", "Modifica file ed esegue comandi"], ["Piano", "Propone un piano prima di agire"], ["Chiedi", "Solo risposte, nessuna modifica"]];

export type ComposerApi = { fill: (text: string) => void; attach: (text: string, image?: Img) => void; focus: () => void };

export function Composer(props: {
	busy: boolean;
	readonly: boolean;
	placeholder: string;
	queued: number;
	queuedText?: string;
	chips: string[];
	model?: string;
	memory?: string;
	roomy: boolean;
	mode: Mode;
	onMode: (mode: Mode) => void;
	onSend: (text: string, images: Img[]) => void;
	onStop: () => void;
	onText?: (text: string) => void;
	ref?: (api: ComposerApi) => void;
}) {
	const [text, setText] = createSignal("");
	const [images, setImages] = createSignal<Img[]>([]);
	const [dragging, setDragging] = createSignal(false);
	// "@file": chips of project files the message points Pi to, picked from a menu while typing "@…".
	const [mentioned, setMentioned] = createSignal<string[]>([]);
	const [menu, setMenu] = createSignal<{ start: number; items: string[]; index: number }>();
	let files: Promise<string[]> | undefined;
	const lookup = (value: string) => {
		const at = mentionAt(value, area.selectionStart ?? value.length);
		if (!at) return setMenu(undefined);
		files ??= desk.projectFiles?.().catch(() => []) ?? Promise.resolve([]);
		files.then((all) => {
			const now = mentionAt(text(), area.selectionStart ?? text().length);
			const items = now ? matchFiles(all, now.query) : [];
			setMenu(now && items.length ? { start: now.start, items, index: 0 } : undefined);
		});
	};
	const pickFile = (path: string) => {
		const open = menu();
		if (!open) return;
		const caret = area.selectionStart ?? text().length;
		changed(text().slice(0, open.start) + text().slice(caret));
		if (!mentioned().includes(path)) setMentioned([...mentioned(), path]);
		setMenu(undefined);
		queueMicrotask(() => area.setSelectionRange(open.start, open.start));
	};
	let area!: HTMLTextAreaElement;
	let picker!: HTMLInputElement;

	const changed = (value: string) => {
		setText(value);
		props.onText?.(value);
		queueMicrotask(grow);
	};
	const grow = () => {
		area.style.height = "auto";
		area.style.height = `${Math.min(area.scrollHeight, window.innerHeight * 0.4)}px`;
	};
	const add = async (files: Iterable<File>) => {
		const added = (await Promise.all([...files].map(toImage))).filter(Boolean) as Img[];
		if (added.length) setImages([...images(), ...added].slice(0, 6));
	};
	const send = () => {
		const typed = text().trim();
		const value = mentioned().length ? `${typed}\n\n${mentioned().map((path) => `@${path}`).join(" ")}`.trim() : typed;
		if (!value && !images().length) return;
		props.onSend(value, images());
		changed("");
		setImages([]);
		setMentioned([]);
		setMenu(undefined);
	};
	props.ref?.({
		fill: (value) => (changed(value), area.focus()),
		// Adds to what is being written (an element picked in the browser, with its picture).
		attach: (value, image) => {
			changed(text() ? `${text().trimEnd()}\n\n${value}` : value);
			if (image) setImages([...images(), image].slice(0, 6));
			area.focus();
		},
		focus: () => area.focus(),
	});

	return (
		<form id="composer" classList={{ readonly: props.readonly, dragging: dragging() }} onSubmit={(event) => (event.preventDefault(), send())}
			onDragOver={(event) => (event.preventDefault(), setDragging(true))}
			onDragLeave={() => setDragging(false)}
			onDrop={(event) => {
				event.preventDefault();
				setDragging(false);
				if (event.dataTransfer?.files.length) add(event.dataTransfer.files);
			}}>
			<Show when={props.queued || images().length || props.chips.length || mentioned().length}>
				<div class="chips">
					<Show when={props.queued}><span class="chip queued" title="Pi lo legge appena finisce il passo in corso"><b>{props.queued} in coda</b>{props.queuedText || "Pi lo legge appena finisce"}</span></Show>
					<For each={images()}>
						{(image, index) => (
							<span class="chip attachment">
								<img src={`data:${image.mimeType};base64,${image.data}`} alt="allegato" />
								<button type="button" class="remove" aria-label="Togli" onClick={() => setImages(images().filter((_, i) => i !== index()))}><X size={11} /></button>
							</span>
						)}
					</For>
					<For each={mentioned()}>{(path) => <span class="chip file" title={path}><span class="at">@</span>{path}<button type="button" class="x" aria-label="Togli" onClick={() => setMentioned(mentioned().filter((p) => p !== path))}>×</button></span>}</For>
					<For each={props.chips}>{(chip) => <span class="chip status">{chip}</span>}</For>
				</div>
			</Show>
			<div class="input-wrap">
			<Show when={!text()}>
				{/* The placeholder of the design: the words in the UI font, the hints in mono. */}
				<div class="placeholder" aria-hidden="true">{props.placeholder.split("   ")[0]}<Show when={props.placeholder.includes("   ")}><span>{props.placeholder.split("   ")[1]}</span></Show></div>
			</Show>
			<textarea id="input" rows="1" ref={area} value={text()} aria-label={props.placeholder}
				onInput={(event) => (changed(event.currentTarget.value), lookup(event.currentTarget.value))}
				onPaste={(event) => {
					const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
					if (files.length) {
						event.preventDefault();
						add(files);
						return;
					}
					// No image and no text: the picture may be on a clipboard the page cannot see (Windows, under WSL).
					if (!event.clipboardData?.getData("text/plain")) {
						event.preventDefault();
						desk.clipboardImage?.().then((image) => image && setImages([...images(), image].slice(0, 6)));
					}
				}}
				onKeyDown={(event) => {
					const open = menu();
					if (open) {
						const move = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
						if (move) return event.preventDefault(), setMenu({ ...open, index: (open.index + move + open.items.length) % open.items.length });
						if (event.key === "Enter" || event.key === "Tab") return event.preventDefault(), pickFile(open.items[open.index]);
						if (event.key === "Escape") return event.preventDefault(), setMenu(undefined);
					}
					if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
						event.preventDefault();
						send();
					}
				}} />
			</div>
			<Show when={menu()}>
				<div class="mentions" role="listbox">
					<For each={menu()!.items}>{(path, i) => <button type="button" role="option" classList={{ on: i() === menu()!.index }} onMouseDown={(event) => (event.preventDefault(), pickFile(path))}><span class="name">{path.slice(path.lastIndexOf("/") + 1)}</span><span class="dir">{path}</span></button>}</For>
				</div>
			</Show>
			<div class="row">
				<button type="button" class="attach" title="Allega un'immagine" onClick={() => picker.click()}>+</button>
				<input ref={picker} type="file" accept="image/*" multiple hidden onChange={(event) => (add(event.currentTarget.files ?? []), (event.currentTarget.value = ""))} />
				<Show when={props.model}><span class="model" title="Modello e ragionamento">{props.model!.split("·")[0]}<Show when={props.roomy && props.model!.includes("·")}><span class="sep">·</span><span class="level">{props.model!.split("·")[1]}</span></Show></span></Show>
				<span class="modes">
					<For each={MODES}>{([mode, tip]) => <button type="button" title={tip} classList={{ on: props.mode === mode }} onClick={() => props.onMode(mode)}>{mode}</button>}</For>
				</span>
				<Show when={props.roomy && props.memory}><span class="memory">{props.memory}</span></Show>
				<span class="grow" />
				<Show when={props.roomy}><span class="hint">⏎ invia</span></Show>
				<Show when={props.busy}><button type="button" id="stop" class="stop" title="Interrompi (Esc)" onClick={props.onStop}>■</button></Show>
				<button type="submit" id="send" class="send" title="Invia (Invio)" disabled={!text().trim() && !images().length}>↑</button>
			</div>
		</form>
	);
}
