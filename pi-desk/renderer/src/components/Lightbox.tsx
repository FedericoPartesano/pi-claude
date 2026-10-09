import { createSignal, Show } from "solid-js";
import { X } from "lucide-solid";

const [image, setImage] = createSignal<string>();
export const openImage = (src: string) => setImage(src);
export const lightboxOpen = () => Boolean(image());

/** Any image full size; Esc or a click closes it. (The browser panel hides meanwhile: it is a native view on top.) */
export function Lightbox() {
	return (
		<Show when={image()}>
			<div class="lightbox" onClick={() => setImage(undefined)} onKeyDown={(event) => event.key === "Escape" && setImage(undefined)} tabindex="-1" ref={(element) => setTimeout(() => element.focus())}>
				<img src={image()} alt="immagine" />
				<button type="button" class="icon close" aria-label="Chiudi"><X size={18} /></button>
			</div>
		</Show>
	);
}
