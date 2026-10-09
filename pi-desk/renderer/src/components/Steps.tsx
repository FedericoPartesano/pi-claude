import { createSignal, For, onCleanup, Show } from "solid-js";
import type { Step } from "../state";
import { phrase } from "../../../../pi-ui/src/phrases.ts";
import { brief } from "../state";
import { editsOf, stepResult, stepsSummary } from "../turns";
import { actions, VIEWABLE } from "../actions";

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/** The only animation besides the intro: the braille spinner, 80 ms a frame. */
export function useSpinner() {
	const [frame, setFrame] = createSignal(0);
	const timer = setInterval(() => setFrame((value) => value + 1), 80);
	onCleanup(() => clearInterval(timer));
	return () => SPINNER[frame() % SPINNER.length];
}

const ICON = { ok: "✓", err: "✗", run: "" } as const;

/** Intermediate words of Pi between steps ("ora leggo il test"), kept in order inside the block. */
export type Entry = { kind: "step"; step: Step } | { kind: "say"; text: string };

function Diff(props: { step: Step }) {
	const rows = () => editsOf(props.step.args).flatMap((edit) => [
		...edit.oldText.split("\n").map((t) => ({ sign: "−", t, cls: "del" })),
		...edit.newText.split("\n").map((t) => ({ sign: "+", t, cls: "add" })),
	]);
	return <div class="diff"><For each={rows().slice(0, 60)}>{(row) => <div class={row.cls}><span>{row.sign}</span><span>{row.t || " "}</span></div>}</For></div>;
}

function StepRow(props: { step: Step; spin: () => string; open?: boolean }) {
	const failed = () => props.step.state === "err";
	const canOpen = () => failed() || Boolean(props.step.output) || (props.step.name === "edit" && editsOf(props.step.args).length > 0);
	// Errors open by themselves; everything else on request.
	const [open, setOpen] = createSignal<boolean | undefined>(undefined);
	const isOpen = () => open() ?? failed();
	const said = () => phrase(props.step.name, props.step.args);
	// A file this step read or wrote that the viewer can show: its path is a link.
	const viewable = () => {
		const path = String(props.step.args?.path ?? props.step.args?.file_path ?? "");
		return ["read", "write", "edit"].includes(props.step.name) && props.step.state !== "err" && VIEWABLE.test(path) ? path : undefined;
	};
	return (
		<div class={`step ${props.step.state}${isOpen() ? " open" : ""}`}>
			<button type="button" class="head" onClick={() => canOpen() && setOpen(!isOpen())} style={{ cursor: canOpen() ? "pointer" : "default" }}>
				<span class="ico">{props.step.state === "run" ? props.spin() : ICON[props.step.state]}</span>
				<span class="label" title={said().text}>{said().text}</span>
				<span class="arg" title={brief(props.step.name, props.step.args)}><span class="tool">{props.step.name}</span>  <Show when={viewable()} fallback={(said().arg || brief(props.step.name, props.step.args)).slice(0, 200)}>
					<span class="view" title="Apri nel pannello" onClick={(event) => (event.stopPropagation(), props.step.name === "edit" ? actions.openCode(viewable()!, editsOf(props.step.args)) : actions.openFile(viewable()!))}>{viewable()}</span>
				</Show></span>
				<span class="res"><For each={stepResult(props.step)}>{(r) => <span class={r.c}>{r.t}</span>}</For></span>
				<span class="chev">{canOpen() ? (isOpen() ? "▾" : "▸") : ""}</span>
			</button>
			<Show when={isOpen()}>
				<Show when={props.step.name === "edit" && !failed() && editsOf(props.step.args).length} fallback={<pre class="out">{props.step.output || "(nessun output)"}</pre>}>
					<Diff step={props.step} />
				</Show>
			</Show>
		</div>
	);
}

/** The turn as a list of steps: closed once the turn is done (its header says what it did), open while it runs. */
export function StepsCard(props: { entries: Entry[]; live: boolean; children?: any }) {
	const spin = useSpinner();
	const steps = () => props.entries.flatMap((e) => (e.kind === "step" ? [e.step] : []));
	const [open, setOpen] = createSignal<boolean | undefined>(undefined);
	const isOpen = () => open() ?? (props.live || steps().some((s) => s.state === "err"));
	const running = () => steps().findIndex((s) => s.state === "run");
	const state = () => (running() >= 0 ? "run" : steps().some((s) => s.state === "err") && !props.live ? "err" : props.live ? "run" : "ok");
	const label = () => (props.live ? `Passo ${running() >= 0 ? running() + 1 : steps().length}` : `${steps().length} ${steps().length === 1 ? "passo" : "passi"}`);
	const meta = () => (props.live && running() >= 0 ? phrase(steps()[running()].name, steps()[running()].args).text.toLowerCase() : stepsSummary(steps()));
	return (
		<div class={`steps ${state()}${isOpen() ? " open" : ""}`}>
			<button type="button" class="steps-head" onClick={() => setOpen(!isOpen())}>
				<span class="ico">{state() === "run" ? spin() : state() === "err" ? "✗" : "✓"}</span>
				<span class="count">{label()}</span>
				<span class="meta">{meta()}</span>
				<span class="grow" />
				<span class="chev">{isOpen() ? "▾" : "▸ dettagli"}</span>
			</button>
			<Show when={isOpen()}>
				<div class="steps-body">
					<For each={props.entries}>{(entry) => (entry.kind === "step" ? <StepRow step={entry.step} spin={spin} /> : <div class="say" title={entry.text}>{entry.text}</div>)}</For>
				</div>
			</Show>
			{props.children}
		</div>
	);
}
