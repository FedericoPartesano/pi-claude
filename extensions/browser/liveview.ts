/**
 * The page Pi drives, drawn inside Pi's own screen: a non-capturing overlay on the right with the latest frame as a
 * kitty/iTerm2 inline image (the same Image Pi uses for screenshots). No split pane, no terminal configuration, no
 * second window: any terminal that shows Pi's images shows the page, and the user keeps typing in Pi.
 */
import { allocateImageId, getCapabilities, Image, type Component, type TUI } from "@earendil-works/pi-tui";

const plain = { fallbackColor: (text: string) => text };

export class LiveView implements Component {
	private frame?: string;
	private image?: Image;
	private readonly imageId = allocateImageId();
	title = "";

	private readonly tui: TUI;

	constructor(tui: TUI) {
		this.tui = tui;
	}

	/** A new frame: drawn on the next render, same image id so the terminal replaces it in place. */
	setFrame(png: string): void {
		this.frame = png;
		this.image = undefined;
		this.tui.requestRender();
	}

	invalidate(): void {
		this.image = undefined;
	}

	render(width: number): string[] {
		const head = `\x1b[2m ${this.title || "browser"}\x1b[0m`;
		if (!this.frame) return [head, "\x1b[2m (in attesa della pagina…)\x1b[0m"];
		this.image ??= new Image(this.frame, "image/png", plain, { maxWidthCells: Math.max(10, width - 2), imageId: this.imageId });
		return [head, ...this.image.render(width)];
	}
}

/** Can this terminal draw inline images? (kitty or iTerm2 protocol, or PI_IMAGE_PROTOCOL). */
export function canShowImages(): boolean {
	return Boolean(getCapabilities().images);
}
