import { Show } from "solid-js";
import { useSpinner } from "./Steps";

/** One state at a time, one colour each: AL LAVORO, TOCCA A TE, FERMO, FATTO (and COMPATTO, PRONTO). */
export type BarState = "run" | "wait" | "err" | "done" | "idle" | "compact";
export type Bar = { state: BarState; text: string; meta: string; keys: string; thinking?: boolean };

const TAG: Record<BarState, [string, string]> = {
	run: ["", "AL LAVORO"],
	compact: ["", "COMPATTO"],
	wait: ["◆", "TOCCA A TE"],
	err: ["✗", "FERMO"],
	done: ["✓", "FATTO"],
	idle: ["◇", "PRONTO"],
};

/** The bar above the composer; it also colours the composer's border (the dock carries the state class). */
export function StatusBar(props: { bar: Bar; remote?: boolean; onStop?: () => void }) {
	const spin = useSpinner();
	const icon = () => TAG[props.bar.state][0] || spin();
	return (
		<div class={`workbar ${props.bar.state}${props.remote ? " remote" : ""}`}>
			<span class="tag">{icon()} {TAG[props.bar.state][1]}</span>
			<span class="what" classList={{ thinking: props.bar.thinking }}>{props.bar.text}</span>
			<span class="meta">{props.bar.meta}</span>
			<Show when={props.bar.state === "run" && props.onStop} fallback={<span class="keys">{props.bar.keys}</span>}>
				<button type="button" class="esc" onClick={props.onStop}>esc interrompi</button>
			</Show>
		</div>
	);
}
