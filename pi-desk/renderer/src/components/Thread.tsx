import { createMemo, createSignal, For, Index, Match, Show, Switch } from "solid-js";
import { Collapsible } from "@kobalte/core/collapsible";
import type { Part, Step, Turn } from "../state";
import { answer, resolveImage } from "../render";
import { clean } from "../bridge";
import { Markdown } from "./Markdown";
import { type Entry, StepsCard } from "./Steps";
import { Ask, type Question } from "./Ask";
import { changes, duration, type Exchange, exchanges, folded, stepsOf, tokens } from "../turns";
import { showImage, tail, viewer } from "../viewer";
import { actions } from "../actions";

type PiTurn = Extract<Turn, { role: "pi" }>;
type UserTurn = Extract<Turn, { role: "user" }>;

export type ThreadActions = {
	onSuggestion: (text: string) => void;
	onEdit: (text: string) => void;
	onRetry: (text: string) => void;
	/** Only for this window's own chat: a new session from the n-th user message. */
	onFork?: (index: number) => void;
	ask?: Question;
	onAnswer: (fields: object) => void;
	composerEmpty: () => boolean;
};

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;
const time = (at?: number) => (at ? new Date(at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "");
const copy = (text: string) => navigator.clipboard?.writeText(text);

function Thinking(props: { part: Extract<Part, { kind: "thinking" }> }) {
	// One line: the latest thought while Pi thinks, then the first one; the whole reasoning on click.
	const line = () => {
		const lines = props.part.text.split(/\n|(?<=[.!?])\s/).map((l) => l.trim()).filter(Boolean);
		return (props.part.live ? lines[lines.length - 1] : lines[0]) ?? "ragiono…";
	};
	return (
		<Collapsible class="thinking" classList={{ live: props.part.live }} open={props.part.live}>
			<Collapsible.Trigger class="thinking-head" title={props.part.live ? "Ragionamento in corso" : `Ragionamento · ${props.part.seconds ?? 1}s`}>◇ {line()}</Collapsible.Trigger>
			<Collapsible.Content class="thinking-body">{props.part.text}</Collapsible.Content>
		</Collapsible>
	);
}

/** Pictures and pages a turn produced, as cards that open in the viewer. */
function Results(props: { steps: Step[] }) {
	const cards = createMemo(() => {
		const out: { key: string; icon: string; name: string; thumb?: string; open: () => void }[] = [];
		for (const step of props.steps) {
			if (step.state !== "ok") continue;
			const path = String(step.args?.path ?? step.args?.file_path ?? "");
			step.images?.forEach((image, i) => {
				const src = `data:${image.mimeType};base64,${image.data}`;
				// The file the step made, when its command names one ("node grafico.mjs out/vendite.png").
				const made = /([\w./-]+\.(?:png|jpe?g|gif|webp|svg))\b/i.exec(String(step.args?.command ?? ""))?.[1];
				const name = step.name === "browser" ? `schermata ${i + 1}.png` : path ? tail(path) : made ? tail(made) : `immagine ${i + 1}`;
				out.push({ key: `${step.id}:${i}`, icon: "▣", name, thumb: src, open: () => showImage(src, name) });
			});
			if (!step.images?.length && ["read", "write"].includes(step.name) && IMAGE_FILE.test(path)) {
				const src = resolveImage(path);
				if (src) out.push({ key: step.id, icon: "▣", name: tail(path), thumb: src, open: () => showImage(src, tail(path), path) });
			}
		}
		const page = [...props.steps].reverse().find((s) => s.name === "browser" && s.state === "ok" && s.args?.url);
		if (page) {
			const url = String(page.args.url);
			out.push({ key: "web", icon: "◎", name: url.replace(/^https?:\/\//, ""), open: () => actions.openWeb(url) });
		}
		return out.slice(-4);
	});
	return (
		<Show when={cards().length}>
			<div class="results">
				<For each={cards()}>
					{(card) => (
						<button type="button" class="result" classList={{ on: viewer.current()?.name === card.name }} onClick={card.open}>
							<span class="preview">{card.thumb ? <img src={card.thumb} alt="" onError={(event) => event.currentTarget.remove()} /> : <span>{card.name}</span>}</span>
							<span class="foot"><span class="ic">{card.icon}</span><span class="name">{card.name}</span><span class="grow" /><span class="go">apri ▸</span></span>
						</button>
					)}
				</For>
			</div>
		</Show>
	);
}

/** "2 file modificati +19 −1": the files of the turn, each opening in the viewer with its changes. */
function Changes(props: { steps: Step[] }) {
	const files = createMemo(() => changes(props.steps));
	const total = () => files().reduce((n, f) => ({ add: n.add + f.add, del: n.del + f.del }), { add: 0, del: 0 });
	return (
		<Show when={files().length}>
			<div class="changes">
				<div class="changes-head">
					<span class="title">{files().length} {files().length === 1 ? "file modificato" : "file modificati"}</span>
					<span class="counts"><span class="add">+{total().add}</span> <span class="del">−{total().del}</span></span>
					<span class="grow" />
					<button type="button" onClick={() => actions.openCode(files()[0].path, files()[0].edits)}>Rivedi</button>
				</div>
				<For each={files()}>
					{(file) => (
						<button type="button" class="change" onClick={() => actions.openCode(file.path, file.edits)}>
							<span class={`st ${file.status}`}>{file.status}</span>
							<span class="path">{file.path}</span>
							<span><span class="add">+{file.add}</span> <Show when={file.del}><span class="del">−{file.del}</span></Show></span>
						</button>
					)}
				</For>
			</div>
		</Show>
	);
}

type Block = { kind: "thinking" | "text" | "error"; index: number } | { kind: "steps"; entries: Entry[] };

function PiTurnView(props: { turn: PiTurn; last: boolean; userText?: string; userIndex: number; actions: ThreadActions }) {
	// All steps of the turn in one block, where the first one was; Pi's words between steps go inside it, in order.
	const blocks = createMemo<Block[]>(() => {
		const parts = props.turn.parts;
		const stepsAt = parts.map((p, i) => (p.kind === "steps" ? i : -1)).filter((i) => i >= 0);
		const first = stepsAt[0] ?? -1;
		const lastSteps = stepsAt[stepsAt.length - 1] ?? -1;
		const out: Block[] = [];
		parts.forEach((part, index) => {
			if (index === 0 && part.kind === "thinking") return; // in the header
			if (first >= 0 && index > first && index <= lastSteps) return; // inside the block
			if (index === first) {
				const entries: Entry[] = [];
				for (let i = first; i <= lastSteps; i++) {
					const p = parts[i];
					if (p.kind === "steps") for (const step of p.steps) entries.push({ kind: "step", step });
					else if (p.kind === "text" && p.text.trim()) entries.push({ kind: "say", text: p.text.trim().replace(/\s+/g, " ") });
				}
				out.push({ kind: "steps", entries });
			} else out.push({ kind: part.kind === "steps" ? "text" : part.kind, index } as Block);
		});
		return out;
	});
	const steps = createMemo(() => stepsOf(props.turn));
	const lastText = () => {
		const texts = props.turn.parts.filter((p) => p.kind === "text") as Extract<Part, { kind: "text" }>[];
		return texts[texts.length - 1]?.text ?? "";
	};
	const suggestions = () => (props.turn.done && props.last ? (answer(lastText()).suggestions as string[]) : []);
	const head = () => (props.turn.parts[0]?.kind === "thinking" ? (props.turn.parts[0] as Extract<Part, { kind: "thinking" }>) : undefined);
	const ask = () => (props.last && !props.turn.done ? props.actions.ask : undefined);
	const AskBox = () => <Show when={ask()} keyed>{(question) => <Ask question={question} onAnswer={props.actions.onAnswer} composerEmpty={props.actions.composerEmpty} />}</Show>;
	const hasSteps = () => blocks().some((b) => b.kind === "steps");
	return (
		<div class="turn-pi">
			<div class="who"><span class="logo">π</span><Show when={head()}><Thinking part={head()!} /></Show></div>
			<Index each={blocks()}>
				{(block) => (
					<Switch>
						<Match when={block().kind === "steps"}>
							<StepsCard entries={(block() as Extract<Block, { kind: "steps" }>).entries} live={!props.turn.done}><AskBox /></StepsCard>
						</Match>
						<Match when={block().kind === "thinking"}><Thinking part={props.turn.parts[(block() as { index: number }).index] as Extract<Part, { kind: "thinking" }>} /></Match>
						<Match when={block().kind === "text"}><Markdown text={(props.turn.parts[(block() as { index: number }).index] as Extract<Part, { kind: "text" }>)?.text ?? ""} /></Match>
						<Match when={block().kind === "error"}><div class="error-card">{clean((props.turn.parts[(block() as { index: number }).index] as Extract<Part, { kind: "error" }>)?.text)}</div></Match>
					</Switch>
				)}
			</Index>
			<Show when={!hasSteps()}><AskBox /></Show>
			<Show when={props.turn.done}>
				<Results steps={steps()} />
				<Changes steps={steps()} />
				<Show when={props.last}>
					<div class="turn-meta">
						<span>{[props.turn.seconds ? duration(props.turn.seconds) : "", props.turn.tokensIn || props.turn.tokensOut ? `↑${tokens(props.turn.tokensIn)} ↓${tokens(props.turn.tokensOut)} tok` : ""].filter(Boolean).join(" · ")}</span>
						<span class="grow" />
						<button type="button" onClick={() => copy(answer(lastText()).text)}>copia</button>
						<Show when={props.userText}><button type="button" onClick={() => props.actions.onRetry(props.userText!)}>riprova</button></Show>
						<Show when={props.actions.onFork && props.userText}><button type="button" title="Nuova sessione da questo punto" onClick={() => props.actions.onFork!(props.userIndex)}>dirama ⎇</button></Show>
					</div>
				</Show>
				<Show when={suggestions().length}>
					<div class="suggestions">
						<For each={suggestions()}>{(text, i) => <button type="button" data-key={i() + 1} onClick={() => props.actions.onSuggestion(text)}><span class="k">{i() + 1}</span>{text}</button>}</For>
					</div>
				</Show>
			</Show>
		</div>
	);
}

function UserView(props: { turn: UserTurn; actions: ThreadActions }) {
	return (
		<div class="user">
			<Show when={props.turn.images?.length}>
				<div class="thumbs">
					<For each={props.turn.images}>{(image) => <img src={`data:${image.mimeType};base64,${image.data}`} alt="allegato" onClick={(event) => showImage(event.currentTarget.src, "allegato")} />}</For>
				</div>
			</Show>
			<div class="turn-user">{props.turn.text}</div>
			<div class="user-meta">
				<Show when={props.turn.at}><span>{time(props.turn.at)}</span></Show>
				<button type="button" onClick={() => props.actions.onEdit(props.turn.text)}>modifica</button>
				<button type="button" onClick={() => copy(props.turn.text)}>copia</button>
			</div>
		</div>
	);
}

function ExchangeView(props: { exchange: Exchange; last: boolean; index: number; actions: ThreadActions }) {
	const [open, setOpen] = createSignal(false);
	const line = () => folded(props.exchange);
	const pis = () => props.exchange.items.filter((t) => t.role === "pi");
	return (
		<div class="exchange" data-exchange={props.exchange.id}>
			<Show when={props.last || open() || !props.exchange.user} fallback={
				<button type="button" class="folded" onClick={() => setOpen(true)} title="Mostra il turno">
					<span class="ic" classList={{ err: !line().ok }}>{line().ok ? "✓" : "✗"}</span>
					<span class="text">{line().text}</span>
					<span class="meta">{line().meta ? `${line().meta} ▸` : "▸"}</span>
				</button>
			}>
				<Show when={!props.last && props.exchange.user}><button type="button" class="fold" onClick={() => setOpen(false)}>▾ piega</button></Show>
				<Show when={props.exchange.user}><UserView turn={props.exchange.user!} actions={props.actions} /></Show>
				<For each={props.exchange.items}>
					{(turn) => (
						<Switch>
							<Match when={turn.role === "pi"}><PiTurnView turn={turn as PiTurn} last={props.last && turn === pis()[pis().length - 1]} userText={props.exchange.user?.text} userIndex={props.index} actions={props.actions} /></Match>
							<Match when={turn.role === "note"}>
								<div class={(turn as Extract<Turn, { role: "note" }>).tone === "error" ? "error-card" : "note"}>{(turn as Extract<Turn, { role: "note" }>).text}</div>
							</Match>
						</Switch>
					)}
				</For>
			</Show>
		</div>
	);
}

export function Thread(props: { turns: Turn[]; typing?: boolean; actions: ThreadActions }) {
	const list = createMemo(() => exchanges(props.turns));
	// The index of each exchange's user message among all user messages (the fork point).
	const userIndex = createMemo(() => {
		let n = -1;
		return list().map((e) => (e.user ? ++n : n));
	});
	const lastHasPi = () => list()[list().length - 1]?.items.some((t) => t.role === "pi" && !t.done);
	return (
		<div class="thread" classList={{ typing: props.typing }}>
			<For each={list()}>{(exchange, i) => <ExchangeView exchange={exchange} last={i() === list().length - 1} index={userIndex()[i()]} actions={props.actions} />}</For>
			<Show when={props.actions.ask && !lastHasPi()} keyed>{(question) => <div class="turn-pi"><Ask question={props.actions.ask!} onAnswer={props.actions.onAnswer} composerEmpty={props.actions.composerEmpty} /></div>}</Show>
		</div>
	);
}

/** The turn map on the right edge: one dash per exchange, the current one long and magenta. */
export function TurnMap(props: { turns: Turn[]; scroller: () => HTMLElement | undefined }) {
	const list = createMemo(() => exchanges(props.turns).filter((e) => e.user));
	return (
		<Show when={list().length > 1}>
			<div class="turn-map">
				<For each={list()}>
					{(exchange, i) => (
						<button type="button" classList={{ current: i() === list().length - 1 }} title={`T${i() + 1} · ${exchange.user!.text.slice(0, 80)}`} onClick={() => props.scroller()?.querySelector(`[data-exchange="${exchange.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })} />
					)}
				</For>
			</div>
		</Show>
	);
}
