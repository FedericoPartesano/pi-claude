/** pi-ui state rebuilt from a resumed session: its image entries and the suggestions of the last turn. */
interface EntryLike {
	type: string;
	customType?: string;
	data?: unknown;
	message?: { role?: string };
}

export function restoreSession(entries: readonly EntryLike[]): { images: string[]; suggestions: string[] } {
	const images: string[] = [];
	let suggestions: string[] = [];
	for (const entry of entries) {
		if (entry.type === "message" && entry.message?.role === "user") suggestions = [];
		if (entry.type !== "custom") continue;
		if (entry.customType === "pi-ui-image") {
			const ref = (entry.data as { ref?: string } | undefined)?.ref;
			if (ref && !images.includes(ref)) images.push(ref);
		}
		if (entry.customType === "pi-ui-suggestions") suggestions = [...((entry.data as { items?: string[] } | undefined)?.items ?? [])];
	}
	return { images, suggestions };
}
