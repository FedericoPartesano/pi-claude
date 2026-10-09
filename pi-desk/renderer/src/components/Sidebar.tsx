import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { desk, type Info, type RemoteStatus, type Session } from "../bridge";
import { cells, SPINNER } from "./Steps";

/** "20m", "7h", "1g": how long ago, as short as the row allows. */
export const ago = (ms: number) => {
	const minutes = Math.round((Date.now() - ms) / 60000);
	if (minutes < 1) return "ora";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}g`;
};

/** What a session is doing, for its row: the glyph, its colour and the word on the right. */
export type RowState = { glyph: string; tone: "run" | "wait" | "err" | "ok" | "dim"; right: string };
export function rowState(status?: RemoteStatus, frame = 0): RowState | undefined {
	if (!status) return undefined;
	if (status.mode === "waiting") return { glyph: "◆", tone: "wait", right: "permesso" };
	if (status.mode === "stopped") return { glyph: "✗", tone: "err", right: "errore" };
	if (status.mode === "working") return { glyph: SPINNER[frame % SPINNER.length], tone: "run", right: status.step ? `passo ${status.step}` : "al lavoro" };
	if (status.mode === "done") return { glyph: "✓", tone: "ok", right: "ora" };
	return undefined;
}

type Row = { kind: "group"; name: string; tone: string; count?: number } | { kind: "session"; session: Session; current?: boolean };

/**
 * Every Pi session on this PC: the ones that need you first (a terminal Pi waiting for a permission, or stopped), then
 * the one shown here, the others running, the recent ones. Refreshed every few seconds; only visible rows exist.
 */
export function Sidebar(props: { active?: string; current?: RowState; info?: Info; onOpen: (session: Session) => void; onNew: () => void; onClose: () => void; searchRef?: (el: HTMLInputElement) => void }) {
	const [sessions, setSessions] = createSignal<Session[]>([]);
	const [states, setStates] = createSignal<Record<number, RemoteStatus | undefined>>({});
	const [filter, setFilter] = createSignal("");
	const [project, setProject] = createSignal("");
	const [frame, setFrame] = createSignal(0);
	let signature = "";
	const refresh = async () => {
		const all = await desk.sessions().catch(() => [] as Session[]);
		const next = JSON.stringify(all.map((session) => [session.path, session.title, session.modified, session.running?.pid]));
		if (next !== signature) {
			signature = next;
			setSessions(all);
		}
		// Terminal Pis with desk-link say what they are doing (the old ones do not answer: no state, as before).
		const running = all.filter((session) => session.running && !session.running.own);
		const replies = await Promise.all(running.map((session) => desk.sessionStatus(session.running!.pid).then((reply) => [session.running!.pid, reply.status ?? undefined] as const, () => [session.running!.pid, undefined] as const)));
		setStates(Object.fromEntries(replies));
	};
	refresh();
	const timer = setInterval(refresh, 4000);
	const spin = setInterval(() => setFrame((n) => n + 1), 80);
	onCleanup(() => (clearInterval(timer), clearInterval(spin)));

	const projects = createMemo(() => [...new Set(sessions().map((s) => s.project))].sort());
	const stateOf = (session: Session): RowState | undefined => (session.path === props.active || session.running?.own ? props.current : rowState(states()[session.running?.pid ?? -1], frame()));
	const rows = createMemo<Row[]>(() => {
		const query = filter().trim().toLowerCase();
		const shown = sessions().filter((s) => (!project() || s.project === project()) && (!query || `${s.title} ${s.project} ${s.cwd}`.toLowerCase().includes(query)));
		const isCurrent = (s: Session) => (props.active ? s.path === props.active : Boolean(s.running?.own));
		const needsYou = shown.filter((s) => !isCurrent(s) && s.running && ["waiting", "stopped"].includes(states()[s.running.pid]?.mode ?? ""));
		const current = shown.filter(isCurrent);
		const live = shown.filter((s) => s.running && !isCurrent(s) && !needsYou.includes(s));
		const recent = shown.filter((s) => !s.running && !isCurrent(s));
		const out: Row[] = [];
		const group = (name: string, tone: string, items: Session[], count = false) => {
			if (!items.length) return;
			out.push({ kind: "group", name, tone, count: count ? items.length : undefined });
			for (const session of items) out.push({ kind: "session", session, current: isCurrent(session) });
		};
		group("RICHIEDONO TE", "wait", needsYou, true);
		group("QUESTA SESSIONE", "dim", current);
		group("IN CORSO", "run", live);
		group("RECENTI", "faint", recent);
		return out;
	});
	let scroller!: HTMLDivElement;
	const virtual = createVirtualizer({
		get count() {
			return rows().length;
		},
		getScrollElement: () => scroller,
		// Sizes are kept per row, not per position: the groups change as sessions start, wait and end.
		getItemKey: (index) => {
			const row = rows()[index];
			return !row ? index : row.kind === "group" ? `g:${row.name}` : `s:${row.session.path}`;
		},
		estimateSize: (index) => (rows()[index]?.kind === "group" ? 28 : 48),
		overscan: 8,
	});
	const usage = () => [
		["5H", props.info?.usage?.fiveHour],
		["7G", props.info?.usage?.sevenDay],
		["CTX", props.info?.context],
	] as const;
	const user = () => props.info?.user ?? "";

	return (
		<aside id="sidebar" aria-label="Sessioni">
			<div class="side-head">
				<span class="logo">π</span>
				<span class="brand">PI//CLAUDE</span>
				<span class="grow" />
				<button type="button" class="square" id="new-session" title="Nuova sessione  Ctrl+N" onClick={props.onNew}>+</button>
			</div>
			<div class="side-tools">
				<label class="project-pick">
					<span class="mark">◆</span><span class="grow">{project() || "Tutti i progetti"}</span><span class="count">{projects().length} ⌄</span>
					<select value={project()} onChange={(event) => setProject(event.currentTarget.value)} aria-label="Progetto">
						<option value="">Tutti i progetti</option>
						<For each={projects()}>{(name) => <option value={name}>{name}</option>}</For>
					</select>
				</label>
				<label class="search">
					<span class="mark">⌕</span>
					<input id="session-filter" placeholder="Cerca sessioni" spellcheck={false} value={filter()} onInput={(event) => setFilter(event.currentTarget.value)} ref={props.searchRef} />
					<span class="kbd">Ctrl K</span>
				</label>
			</div>
			<div id="session-list" ref={scroller}>
				<Show when={rows().length} fallback={<div class="empty-list">Nessuna sessione</div>}>
					<div style={{ height: `${virtual.getTotalSize()}px`, position: "relative" }}>
						<For each={virtual.getVirtualItems()}>
							{(item) => {
								const row = () => rows()[item.index];
								return (
									<div data-index={item.index} ref={(el) => queueMicrotask(() => el.isConnected && virtual.measureElement(el))} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${item.start}px)` }}>
										<Show when={row()?.kind === "group"} fallback={(() => {
											const r = () => row() as Extract<Row, { kind: "session" }>;
											const state = () => stateOf(r().session);
											return (
												<button type="button" class="session" classList={{ active: r().current }} title={r().session.cwd} onClick={() => props.onOpen(r().session)}>
													<span class={`glyph ${state()?.tone ?? (r().session.running ? "run" : "dim")}`}>{state()?.glyph ?? (r().session.running ? "●" : "·")}</span>
													<span class="title">{r().session.title}</span>
													<span class={`right ${state()?.tone ?? ""}`}>{state()?.right ?? (r().session.running ? (r().session.running!.own ? "questa finestra" : "in corso") : ago(r().session.modified))}</span>
													<span />
													<span class="meta">{r().session.project}</span>
												</button>
											);
										})()}>
											<div class={`group ${(row() as Extract<Row, { kind: "group" }>).tone}`}><span>{(row() as Extract<Row, { kind: "group" }>).name}</span><span>{(row() as Extract<Row, { kind: "group" }>).count ?? ""}</span></div>
										</Show>
									</div>
								);
							}}
						</For>
					</div>
				</Show>
			</div>
			<div class="side-foot">
				<div class="usage">
					<For each={usage()}>
						{([key, value]) => (
							<div class="meter" classList={{ warn: (value ?? 0) >= 75, err: (value ?? 0) >= 90 }}>
								<span>{key}</span>
								<span class="cells"><b>{cells(value).full}</b>{cells(value).empty}</span>
								<span class="pct">{value === undefined ? "–" : `${value}%`}</span>
							</div>
						)}
					</For>
				</div>
				<Show when={user()}>
					<div class="who">
						<span class="avatar">{user().slice(0, 2).toUpperCase()}</span>
						<span class="names"><span>{user()}</span><span classList={{ over: props.info?.usage?.overage }}>{props.info?.usage?.overage ? "⚠ extra usage attivo" : props.info?.usage?.updatedAt ? `uso aggiornato alle ${new Date(props.info.usage.updatedAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}` : "uso non disponibile"}</span></span>
						<button type="button" class="icon" title="Chiudi la barra  Ctrl+B" onClick={props.onClose}>‹</button>
					</div>
				</Show>
			</div>
		</aside>
	);
}
