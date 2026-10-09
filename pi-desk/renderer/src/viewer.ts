// The right-hand viewer: what is open in it, as tabs (image, code, document, PDF, web page). Closing the last tab
// closes the panel; opening anything reopens it. PDF and web pages live in the one native browser view.
import { createRoot } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { DocFile } from "./bridge";

import type { Edit } from "./turns";
export type { Edit };
export type Tab = {
	id: string;
	kind: "img" | "code" | "doc" | "pdf" | "web";
	name: string;
	path?: string;
	/** img: the picture; pdf and web: the address loaded in the native view. */
	src?: string;
	doc?: DocFile;
	/** code: what the turn changed in this file. */
	edits?: Edit[];
};

export const ICON: Record<Tab["kind"], string> = { img: "▣", code: "‹›", doc: "▤", pdf: "▤", web: "◎" };

export const viewer = createRoot(() => {
	const [state, set] = createStore({ tabs: [] as Tab[], active: "", open: false });
	const open = (tab: Tab) => {
		set(produce((s) => {
			const index = s.tabs.findIndex((t) => t.id === tab.id);
			if (index >= 0) s.tabs[index] = { ...s.tabs[index], ...tab };
			else s.tabs.push(tab);
			s.active = tab.id;
			s.open = true;
		}));
	};
	const close = (id: string) => {
		set(produce((s) => {
			const index = s.tabs.findIndex((t) => t.id === id);
			if (index < 0) return;
			s.tabs.splice(index, 1);
			if (s.active === id) s.active = s.tabs[Math.min(index, s.tabs.length - 1)]?.id ?? "";
			if (!s.tabs.length) s.open = false;
		}));
	};
	return {
		state,
		open,
		close,
		activate: (id: string) => set({ active: id, open: true }),
		hide: () => set("open", false),
		current: () => (state.open ? state.tabs.find((t) => t.id === state.active) : undefined),
		/** The web tab follows what the native view shows. */
		setWeb: (src: string, name: string) => set("tabs", (t) => t.id === "web", produce((t: Tab) => ((t.src = src), (t.name = name)))),
	};
});

const tail = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
/** A picture in the viewer: from a step, an answer or an attachment (data: or file: address). */
export function showImage(src: string, name?: string, path?: string) {
	viewer.open({ id: `img:${path ?? src.slice(0, 64) + src.length}`, kind: "img", name: name ?? (path ? tail(path) : "immagine"), path, src });
}
export { tail };
