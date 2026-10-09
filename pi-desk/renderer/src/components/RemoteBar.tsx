import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { RemoteStatus } from "../bridge";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const tokens = (count = 0) => (count < 1000 ? String(count) : `${(count / 1000).toFixed(1).replace(".", ",")}k`);

/**
 * The status line of a Pi running in a terminal, as its own pi-ui shows it there: AL LAVORO, TOCCA A TE (with the
 * question, answered here with the buttons or S/N/A), FATTO, FERMO.
 */
export function RemoteBar(props: { status?: RemoteStatus; onAnswer: (value: "yes" | "no" | "always") => void; composerEmpty: () => boolean }) {
	const [frame, setFrame] = createSignal(0);
	const [now, setNow] = createSignal(Date.now());
	const timer = setInterval(() => (setFrame((value) => value + 1), setNow(Date.now())), 100);
	onCleanup(() => clearInterval(timer));
	const onKey = (event: KeyboardEvent) => {
		if (props.status?.mode !== "waiting" || event.ctrlKey || event.metaKey || event.altKey) return;
		// Like the terminal: keys answer while nothing is being written.
		if (!props.composerEmpty()) return;
		const key = event.key.toLowerCase();
		const value = key === "s" || key === "y" ? "yes" : key === "n" ? "no" : key === "a" ? "always" : undefined;
		if (!value) return;
		event.preventDefault();
		props.onAnswer(value);
	};
	onMount(() => window.addEventListener("keydown", onKey, true));
	onCleanup(() => window.removeEventListener("keydown", onKey, true));
	const seconds = () => Math.max(0, Math.floor(((props.status?.mode === "working" ? now() : props.status?.endedAt || now()) - (props.status?.startedAt ?? now())) / 1000));
	return (
		<Show when={props.status && props.status.mode !== "idle"}>
			<div class="workbar remote" classList={{ waiting: props.status!.mode === "waiting", done: props.status!.mode === "done", stopped: props.status!.mode === "stopped" }}>
				<Show when={props.status!.mode === "working"}>
					<span class="tag">{SPINNER[frame() % SPINNER.length]} AL LAVORO</span>
					<span class="what">
						<Show when={props.status!.phase === "thinking"} fallback={<span class="shimmer">{props.status!.activity || "lavoro"}</span>}>
							<span class="wave"><i /><i /><i /></span> penso<Show when={props.status!.thought}><span class="thought"> · {props.status!.thought}</span></Show>
						</Show>
					</span>
					<span class="meta">{props.status!.step ? `passo ${props.status!.step} · ` : ""}{seconds()}s</span>
				</Show>
				<Show when={props.status!.mode === "waiting"}>
					<span class="tag ask">◆ TOCCA A TE</span>
					<span class="what question">{props.status!.question}</span>
					<span class="answers">
						<button type="button" class="yes" onClick={() => props.onAnswer("yes")}>Sì <kbd>S</kbd></button>
						<button type="button" class="no" onClick={() => props.onAnswer("no")}>No <kbd>N</kbd></button>
						<button type="button" onClick={() => props.onAnswer("always")}>Sempre <kbd>A</kbd></button>
					</span>
				</Show>
				<Show when={props.status!.mode === "done"}>
					<span class="tag ok">✓ FATTO</span>
					<span class="what">{seconds()}s · ↑{tokens(props.status!.tokensIn)} ↓{tokens(props.status!.tokensOut)} tok{props.status!.warning ? ` · ⚠ ${props.status!.warning}` : ""}</span>
				</Show>
				<Show when={props.status!.mode === "stopped"}>
					<span class="tag err">✗ FERMO</span>
					<span class="what">{props.status!.activity}</span>
				</Show>
			</div>
		</Show>
	);
}
