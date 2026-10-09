import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { X } from "lucide-solid";
import { desk, type Session } from "../bridge";

const ago = (ms: number) => {
	const minutes = Math.round((Date.now() - ms) / 60000);
	if (minutes < 1) return "adesso";
	if (minutes < 60) return `${minutes} min fa`;
	const hours = Math.round(minutes / 60);
	return hours < 24 ? `${hours} h fa` : `${Math.round(hours / 24)} g fa`;
};
const GROUPS = ["In corso", "Oggi", "Ieri", "Ultimi 7 giorni", "Più vecchie"];
function bucket(session: Session) {
	if (session.running) return "In corso";
	const day = 86400000;
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	if (session.modified >= today.getTime()) return "Oggi";
	if (session.modified >= today.getTime() - day) return "Ieri";
	if (session.modified >= today.getTime() - 7 * day) return "Ultimi 7 giorni";
	return "Più vecchie";
}
type Row = { kind: "group"; name: string } | { kind: "session"; session: Session };

/** Every Pi session on this PC, refreshed every few seconds while open; the list is virtualised (only visible rows exist). */
export function Sidebar(props: { active?: string; onOpen: (session: Session) => void; onClose: () => void }) {
	const [sessions, setSessions] = createSignal<Session[]>([]);
	const [filter, setFilter] = createSignal("");
	let signature = "";
	const refresh = async () => {
		const all = await desk.sessions().catch(() => []);
		const next = JSON.stringify(all.map((session) => [session.path, session.title, session.modified, session.running?.pid]));
		if (next !== signature) {
			signature = next;
			setSessions(all);
		}
	};
	refresh();
	const timer = setInterval(refresh, 4000);
	onCleanup(() => clearInterval(timer));

	const rows = createMemo<Row[]>(() => {
		const query = filter().trim().toLowerCase();
		const shown = sessions().filter((session) => !query || `${session.title} ${session.project} ${session.cwd}`.toLowerCase().includes(query));
		const out: Row[] = [];
		for (const name of GROUPS) {
			const items = shown.filter((session) => bucket(session) === name);
			if (!items.length) continue;
			out.push({ kind: "group", name });
			for (const session of items) out.push({ kind: "session", session });
		}
		return out;
	});
	let scroller!: HTMLDivElement;
	const virtual = createVirtualizer({
		get count() {
			return rows().length;
		},
		getScrollElement: () => scroller,
		estimateSize: (index) => (rows()[index]?.kind === "group" ? 34 : 54),
		overscan: 8,
	});

	return (
		<aside id="sidebar" aria-label="Sessioni">
			<div class="side-head"><span>Sessioni</span><button type="button" class="icon" title="Chiudi" onClick={props.onClose}><X size={16} /></button></div>
			<input id="session-filter" placeholder="Cerca per titolo o progetto" spellcheck={false} value={filter()} onInput={(event) => setFilter(event.currentTarget.value)} />
			<div id="session-list" ref={scroller}>
				<Show when={rows().length} fallback={<div class="note">Nessuna sessione</div>}>
					<div style={{ height: `${virtual.getTotalSize()}px`, position: "relative" }}>
						<For each={virtual.getVirtualItems()}>
							{(item) => {
								const row = () => rows()[item.index];
								return (
									<div style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${item.start}px)` }}>
										<Show when={row()?.kind === "group"} fallback={(() => {
											const session = () => (row() as Extract<Row, { kind: "session" }>).session;
											return (
												<button type="button" class="session" classList={{ active: props.active === session().path }} title={session().cwd} onClick={() => props.onOpen(session())}>
													<span class="title">{session().title}</span>
													<span class="meta">
														<Show when={session().running}>{session().running!.own ? <span class="own">● questa finestra</span> : <span class="live">● in corso</span>}</Show>
														<span>{session().project}</span>·<span>{ago(session().modified)}</span>
													</span>
												</button>
											);
										})()}>
											<div class="group">{(row() as Extract<Row, { kind: "group" }>).name}</div>
										</Show>
									</div>
								);
							}}
						</For>
					</div>
				</Show>
			</div>
		</aside>
	);
}
