import { createSignal, For, Show } from "solid-js";
import { Brain, Download, FilePlus, FileText, Flag, Folder, Globe, ListChecks, Pencil, Search, Terminal, Wrench } from "lucide-solid";
import type { Step } from "../state";
import { brief } from "../state";
import { openImage } from "./Lightbox";

const ICONS: Record<string, typeof Wrench> = { bash: Terminal, read: FileText, edit: Pencil, write: FilePlus, grep: Search, find: Search, web_search: Search, ls: Folder, browser: Globe, fetch_content: Download, ricorda: Brain, goal_done: Flag, team: Flag, subagent: Flag, todo: ListChecks };
const duration = (ms?: number) => (ms === undefined ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

function StepRow(props: { step: Step }) {
	const [open, setOpen] = createSignal(false);
	const Icon = () => {
		const Component = ICONS[props.step.name] ?? Wrench;
		return <Component size={13} stroke-width={2} />;
	};
	return (
		<div class={`step ${props.step.state}`} classList={{ open: open() }}>
			<button type="button" class="head" onClick={() => props.step.output && setOpen(!open())}>
				<span class="ico"><Icon /></span>
				<span class="name">{props.step.name}</span>
				<span class="arg">{brief(props.step.name, props.step.args).slice(0, 200)}</span>
				<span class="state">{props.step.state === "run" ? "in corso" : duration(props.step.ms)}</span>
			</button>
			<Show when={props.step.images?.length}>
				<div class="thumbs">
					<For each={props.step.images}>{(image) => <img src={`data:${image.mimeType};base64,${image.data}`} alt="risultato del tool" onClick={(event) => openImage(event.currentTarget.src)} />}</For>
				</div>
			</Show>
			<Show when={open()}>
				<pre class="out">{props.step.output}</pre>
			</Show>
		</div>
	);
}

export function Steps(props: { steps: Step[] }) {
	return (
		<div class="steps">
			<For each={props.steps}>{(step) => <StepRow step={step} />}</For>
		</div>
	);
}
