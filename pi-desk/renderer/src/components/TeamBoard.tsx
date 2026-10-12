import { For, Show } from "solid-js";
import type { TeamBoard as Board } from "../state";

const PHASE: Record<Board["phase"], string> = {
	baseline: "controlli iniziali",
	tasks: "compiti",
	final: "verifica finale",
	fix: "correzione",
	review: "revisione",
	done: "fine",
};
const OUTCOME: Record<string, string> = {
	verified: "verificato",
	verified_with_review_notes: "verificato, con note del revisore",
	verified_with_preexisting_failures: "verificato (restano errori preesistenti)",
	failed: "non verificato",
};
const ICON: Record<Board["tasks"][number]["state"], string> = { pending: "·", running: "", verifying: "⧗", retry: "↻", done: "✓", failed: "✗", skipped: "⤼" };
const STATE: Record<Board["tasks"][number]["state"], string> = { pending: "in attesa", running: "lavora", verifying: "controlli", retry: "riprova", done: "fatto", failed: "fallito", skipped: "saltato" };

const tokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** pi-team's board under the team step: one row per task, then the final checks and the review. */
export function TeamBoard(props: { board: Board; spin: () => string }) {
	const done = () => props.board.tasks.filter((task) => task.state === "done").length;
	const live = () => props.board.phase !== "done";
	return (
		<div class={`team-board${live() ? " live" : ""}`}>
			<div class="tb-head">
				<span class="tb-phase">{live() ? PHASE[props.board.phase] : OUTCOME[props.board.outcome ?? ""] ?? "fine"}</span>
				<span class="tb-count">{done()}/{props.board.tasks.length} compiti</span>
				<Show when={props.board.fixRounds}><span class="tb-fix">giri correttivi {props.board.fixRounds}</span></Show>
			</div>
			<For each={props.board.tasks}>{(task) => (
				<div class={`tb-task ${task.state}`} title={task.summary || task.error || task.title}>
					<span class="ico">{task.state === "running" ? props.spin() : ICON[task.state]}</span>
					<span class="tb-id">{task.id}</span>
					<span class="tb-role">{task.role}<span class="tb-model"> · {task.model}</span></span>
					<span class="tb-title">
						{task.title}
						<Show when={task.error && task.state !== "done"}><span class="tb-err"> — {task.error}</span></Show>
					</span>
					<span class="tb-meta">
						{STATE[task.state]}
						<Show when={task.attempts > 1}> · {task.attempts}° tentativo</Show>
						<Show when={task.parallel && task.state === "running"}> · in parallelo</Show>
						<Show when={task.tokens}> · {tokens(task.tokens)} tok</Show>
					</span>
				</div>
			)}</For>
			<Show when={props.board.preexisting.length}>
				<div class="tb-note">già falliti prima del team: <For each={props.board.preexisting}>{(command) => <code>{command}</code>}</For></div>
			</Show>
			<Show when={props.board.finalChecks.length}>
				<div class="tb-checks">
					<For each={props.board.finalChecks}>{(check) => <span class={check.ok ? "ok" : "err"}>{check.ok ? "✓" : "✗"} <code>{check.command}</code></span>}</For>
				</div>
			</Show>
			<Show when={props.board.review}><div class="tb-note">revisione: {props.board.review}</div></Show>
		</div>
	);
}
