import { createSignal, onCleanup, Show } from "solid-js";
import type { Chat } from "../state";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const tokens = (count: number) => (count < 1000 ? String(count) : count < 1_000_000 ? `${(count / 1000).toFixed(1).replace(".", ",")}k` : `${(count / 1_000_000).toFixed(1).replace(".", ",")}M`);

/** The terminal's status line in the app: AL LAVORO with what Pi is doing now, then FATTO with the turn's totals. */
export function WorkBar(props: { work: Chat["work"]; busy: boolean; onStop: () => void }) {
	const [now, setNow] = createSignal(Date.now());
	const [frame, setFrame] = createSignal(0);
	const timer = setInterval(() => {
		setNow(Date.now());
		setFrame((value) => value + 1);
	}, 100);
	onCleanup(() => clearInterval(timer));
	const seconds = () => Math.max(0, Math.floor((now() - props.work.started) / 1000));
	return (
		<Show when={props.busy || props.work.phase === "done" || props.work.phase === "compacting"}>
			<div class="workbar" classList={{ done: !props.busy && props.work.phase === "done", compacting: props.work.phase === "compacting" }}>
				<Show when={props.work.phase !== "compacting"} fallback={
					<>
						<span class="tag compact">{SPINNER[frame() % SPINNER.length]} COMPATTO</span>
						<span class="what"><span class="shimmer">riassumo la conversazione · {props.work.activity}</span></span>
						<span class="meta">{seconds()}s</span>
					</>
				}>
				<Show when={props.busy} fallback={
					<>
						<span class="tag ok">✓ FATTO</span>
						<span class="what">{props.work.seconds}s · ↑{tokens(props.work.tokensIn)} ↓{tokens(props.work.tokensOut)} tok{props.work.steps ? ` · ${props.work.steps} passi` : ""}</span>
					</>
				}>
					<span class="tag">{SPINNER[frame() % SPINNER.length]} AL LAVORO</span>
					<span class="what" classList={{ thinking: props.work.phase === "thinking" }}>
						<Show when={props.work.phase === "thinking"} fallback={<span class="shimmer">{props.work.activity || "lavoro"}</span>}>
							<span class="wave"><i /><i /><i /></span> penso<Show when={props.work.thought}><span class="thought"> · {props.work.thought}</span></Show>
						</Show>
					</span>
					<Show when={props.work.retry}><span class="retry">{props.work.retry}</span></Show>
					<Show when={props.work.queued}><span class="queued">{props.work.queued} in coda</span></Show>
					<span class="meta">{props.work.steps ? `passo ${props.work.steps} · ` : ""}{seconds()}s</span>
					<button type="button" class="esc" onClick={props.onStop}>esc <span>interrompi</span></button>
				</Show>
				</Show>
			</div>
		</Show>
	);
}
