import { For, Match, Show, Switch } from "solid-js";
import { Collapsible } from "@kobalte/core/collapsible";
import { ChevronRight } from "lucide-solid";
import type { Part, Turn } from "../state";
import { answer } from "../render";
import { clean } from "../bridge";
import { Markdown } from "./Markdown";
import { Steps } from "./Steps";
import { openImage } from "./Lightbox";

function Thinking(props: { part: Extract<Part, { kind: "thinking" }> }) {
	return (
		<Collapsible class="thinking" classList={{ live: props.part.live }} open={props.part.live} >
			<Collapsible.Trigger class="thinking-head">
				<ChevronRight size={12} class="chevron" />
				{props.part.live ? "Ragionamento…" : `Ragionamento · ${props.part.seconds ?? 1} s`}
			</Collapsible.Trigger>
			<Collapsible.Content class="thinking-body">{props.part.text}</Collapsible.Content>
		</Collapsible>
	);
}

function PiTurn(props: { turn: Extract<Turn, { role: "pi" }>; onSuggestion: (text: string) => void }) {
	// Suggestions come from the last text, once the turn is done.
	const suggestions = () => {
		if (!props.turn.done) return [];
		const texts = props.turn.parts.filter((part) => part.kind === "text") as Extract<Part, { kind: "text" }>[];
		return texts.length ? (answer(texts[texts.length - 1].text).suggestions as string[]) : [];
	};
	return (
		<div class="turn-pi">
			<div class="who"><span class="logo">π</span><b>Pi</b></div>
			<For each={props.turn.parts}>
				{(part) => (
					<Switch>
						<Match when={part.kind === "thinking"}><Thinking part={part as Extract<Part, { kind: "thinking" }>} /></Match>
						<Match when={part.kind === "text"}><Markdown text={(part as Extract<Part, { kind: "text" }>).text} /></Match>
						<Match when={part.kind === "steps"}><Steps steps={(part as Extract<Part, { kind: "steps" }>).steps} /></Match>
						<Match when={part.kind === "error"}><div class="error-card">{clean((part as Extract<Part, { kind: "error" }>).text)}</div></Match>
					</Switch>
				)}
			</For>
			<Show when={suggestions().length}>
				<div class="suggestions">
					<For each={suggestions()}>{(text) => <button type="button" onClick={() => props.onSuggestion(text)}>{text}</button>}</For>
				</div>
			</Show>
		</div>
	);
}

export function Thread(props: { turns: Turn[]; onSuggestion: (text: string) => void }) {
	return (
		<div class="thread">
			<For each={props.turns}>
				{(turn) => (
					<Switch>
						<Match when={turn.role === "user"}>
							<div class="turn-user">
								<Show when={(turn as Extract<Turn, { role: "user" }>).images?.length}>
									<div class="thumbs">
										<For each={(turn as Extract<Turn, { role: "user" }>).images}>{(image) => <img src={`data:${image.mimeType};base64,${image.data}`} alt="allegato" onClick={(event) => openImage(event.currentTarget.src, event.currentTarget)} />}</For>
									</div>
								</Show>
								{(turn as Extract<Turn, { role: "user" }>).text}
							</div>
						</Match>
						<Match when={turn.role === "pi"}><PiTurn turn={turn as Extract<Turn, { role: "pi" }>} onSuggestion={props.onSuggestion} /></Match>
						<Match when={turn.role === "note"}>
							<div class={(turn as Extract<Turn, { role: "note" }>).tone === "error" ? "error-card" : "note"}>{(turn as Extract<Turn, { role: "note" }>).text}</div>
						</Match>
					</Switch>
				)}
			</For>
		</div>
	);
}
