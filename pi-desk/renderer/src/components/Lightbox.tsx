// Images full size with PhotoSwipe: wheel/click/pinch zoom, drag to pan, arrows and swipe between the images of the
// same message, Esc to close. The browser panel (a native view on top) hides while it is open.
import { createSignal } from "solid-js";
import PhotoSwipe from "photoswipe";
import "photoswipe/style.css";

const [open, setOpen] = createSignal(false);
export const lightboxOpen = open;

/** Natural size of an image (PhotoSwipe needs it to zoom and to animate from the thumbnail). */
function size(src: string): Promise<{ src: string; width: number; height: number }> {
	return new Promise((resolve) => {
		const image = new Image();
		image.onload = () => resolve({ src, width: image.naturalWidth || 1200, height: image.naturalHeight || 800 });
		image.onerror = () => resolve({ src, width: 1200, height: 800 });
		image.src = src;
	});
}

/**
 * Opens `src`; `from` (the clicked image) gives the gallery: every image of the same message, in order.
 */
export async function openImage(src: string, from?: HTMLElement) {
	const scope = from?.closest(".turn-pi, .turn-user, .step, .md");
	const elements = scope ? ([...scope.querySelectorAll("img")] as HTMLImageElement[]).filter((image) => !image.classList.contains("broken")) : [];
	const sources = elements.length ? elements.map((image) => image.src) : [src];
	const index = Math.max(0, sources.indexOf(src));
	const dataSource = await Promise.all(sources.map(size));
	setOpen(true);
	const gallery = new PhotoSwipe({
		dataSource,
		index,
		bgOpacity: 0.94,
		wheelToZoom: true,
		showHideAnimationType: elements[index] ? "zoom" : "fade",
		secondaryZoomLevel: 2,
		maxZoomLevel: 6,
		pswpModule: PhotoSwipe,
	} as never);
	// Zoom-in animation starts from the clicked thumbnail.
	gallery.addFilter("thumbBounds", (bounds, _data, itemIndex) => {
		const thumb = elements[itemIndex];
		if (!thumb) return bounds;
		const rect = thumb.getBoundingClientRect();
		return { x: rect.left, y: rect.top, w: rect.width };
	});
	gallery.on("destroy", () => setOpen(false));
	gallery.init();
}

/** Kept for the layout (PhotoSwipe mounts itself on the body). */
export function Lightbox() {
	return null;
}
