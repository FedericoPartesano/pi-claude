/**
 * setWidget that also works outside the TUI. In RPC mode component factories are ignored by Pi, so the component is
 * rendered here and the lines are sent as a plain string-array widget (only when they change, at most every 200 ms).
 */
interface Ui {
	setWidget(key: string, content: unknown, options?: unknown): void;
}
interface Component {
	render(width: number): string[];
}

export function setWidgetCompat(
	ctx: { mode?: string; ui: Ui },
	key: string,
	factory: (tui: { requestRender(): void }, theme?: unknown) => Component,
	options: unknown,
	assign: (tui: { requestRender(): void }) => void,
	width = 33, // matches the side panel of the RPC chat; wider hosts just get compact lines
): void {
	if (ctx.mode === undefined || ctx.mode === "tui") {
		ctx.ui.setWidget(key, (tui: { requestRender(): void }, theme?: unknown) => {
			assign(tui);
			return factory(tui, theme);
		}, options);
		return;
	}
	let last = "";
	let timer: ReturnType<typeof setTimeout> | undefined;
	let component: Component | undefined;
	const push = () => {
		timer = undefined;
		component ??= factory(tui);
		let lines: string[] = [];
		try {
			lines = component.render(width);
		} catch {}
		const text = lines.join("\n");
		if (text === last) return;
		last = text;
		ctx.ui.setWidget(key, lines.length ? lines : undefined);
	};
	const tui = {
		requestRender() {
			timer ??= setTimeout(push, 200);
			timer.unref?.();
		},
	};
	assign(tui);
	component = factory(tui);
}
