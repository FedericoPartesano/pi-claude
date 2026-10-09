import { createSignal, For, Show } from "solid-js";
import { ArrowUp, ImagePlus, Square, X } from "lucide-solid";
import { desk, type Img } from "../bridge";

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

export function Composer(props: { busy: boolean; readonly: boolean; placeholder: string; statuses: string; onSend: (text: string, images: Img[]) => void; onStop: () => void; ref?: (api: { fill: (text: string) => void }) => void }) {
	const [text, setText] = createSignal("");
	const [images, setImages] = createSignal<Img[]>([]);
	const [dragging, setDragging] = createSignal(false);
	let area!: HTMLTextAreaElement;
	let picker!: HTMLInputElement;

	const grow = () => {
		area.style.height = "auto";
		area.style.height = `${Math.min(area.scrollHeight, window.innerHeight * 0.4)}px`;
	};
	const add = async (files: Iterable<File>) => {
		const added = (await Promise.all([...files].map(toImage))).filter(Boolean) as Img[];
		if (added.length) setImages([...images(), ...added].slice(0, 6));
	};
	const send = () => {
		const value = text().trim();
		if (!value && !images().length) return;
		props.onSend(value, images());
		setText("");
		setImages([]);
		queueMicrotask(grow);
	};
	props.ref?.({ fill: (value) => (setText(value), queueMicrotask(grow), area.focus()) });

	return (
		<form id="composer" classList={{ readonly: props.readonly }} onSubmit={(event) => (event.preventDefault(), send())}>
			<div class="box" classList={{ dragging: dragging() }}
				onDragOver={(event) => (event.preventDefault(), setDragging(true))}
				onDragLeave={() => setDragging(false)}
				onDrop={(event) => {
					event.preventDefault();
					setDragging(false);
					if (event.dataTransfer?.files.length) add(event.dataTransfer.files);
				}}>
				<Show when={images().length}>
					<div class="attachments">
						<For each={images()}>
							{(image, index) => (
								<div class="attachment">
									<img src={`data:${image.mimeType};base64,${image.data}`} alt="allegato" />
									<button type="button" class="remove" aria-label="Togli" onClick={() => setImages(images().filter((_, i) => i !== index()))}><X size={12} /></button>
								</div>
							)}
						</For>
					</div>
				</Show>
				<textarea id="input" rows="1" ref={area} value={text()} placeholder={props.placeholder}
					onInput={(event) => (setText(event.currentTarget.value), grow())}
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
						if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
							event.preventDefault();
							send();
						}
					}} />
				<div class="row">
					<button type="button" class="icon" title="Allega un'immagine" onClick={() => picker.click()}><ImagePlus size={16} /></button>
					<input ref={picker} type="file" accept="image/*" multiple hidden onChange={(event) => (add(event.currentTarget.files ?? []), (event.currentTarget.value = ""))} />
					<span id="chips">{props.statuses}</span>
					<Show when={props.busy}><button type="button" id="stop" class="stop" title="Interrompi (Esc)" onClick={props.onStop}><Square size={11} fill="currentColor" /></button></Show>
					<button type="submit" id="send" class="send" title="Invia (Invio)" disabled={!text().trim() && !images().length}><ArrowUp size={16} stroke-width={2.6} /></button>
				</div>
			</div>
			<div class="hint">Invio invia · Maiusc+Invio va a capo · incolla o trascina un'immagine · Esc interrompe</div>
		</form>
	);
}
