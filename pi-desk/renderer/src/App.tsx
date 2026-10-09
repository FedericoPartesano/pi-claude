import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import { actions } from "./actions";
import { onTableClick } from "./enhance";
import { clean, desk, type Img, type Info, type RemoteStatus, type Session } from "./bridge";
import { createChat, transcriptTurns, type Turn } from "./state";
import { Thread, TurnMap } from "./components/Thread";
import { setImageBase } from "./render";
import { Composer, type ComposerApi, type Mode } from "./components/Composer";
import { Sidebar, type RowState } from "./components/Sidebar";
import { localQuestion, remoteQuestion } from "./components/Ask";
import { type Bar, StatusBar } from "./components/StatusBar";
import { Viewer } from "./components/Viewer";
import { Lightbox, lightboxOpen } from "./components/Lightbox";
import { cells, SPINNER } from "./components/Steps";
import { showImage, tail, viewer } from "./viewer";
import { duration, tokens } from "./turns";
import type { Edit } from "./turns";

const EXAMPLES = ["Riassumi lo stato del progetto", "Trova i test che falliscono e sistemali", "Apri nel browser localhost:3000 e prova il login", "Cosa ricordi di questo progetto?"];
const PREFIX: Record<Mode, string> = {
	Agisci: "",
	Piano: "[Modalità Piano] Proponi prima un piano a passi numerati e aspetta la mia conferma: non modificare file e non eseguire comandi che cambiano qualcosa.\n\n",
	Chiedi: "[Modalità Chiedi] Rispondi soltanto: non modificare file e non eseguire comandi che cambiano qualcosa.\n\n",
};
const SESSION_CHIPS = [["goal", "GOAL"], ["loop", "LOOP"], ["team", "TEAM"]] as const;
const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "") || "browser";

export function App() {
	const chat = createChat();
	const { state, work } = chat;
	const [project, setProject] = createSignal("");
	const [home, setHome] = createSignal("");
	const [info, setInfo] = createSignal<Info>();
	const [vw, setVw] = createSignal(window.innerWidth);
	const onResize = () => setVw(window.innerWidth);
	window.addEventListener("resize", onResize);
	onCleanup(() => window.removeEventListener("resize", onResize));
	// The sidebar closes by itself on narrow windows (narrower still with the viewer open); ☰ / Ctrl+B override.
	const [sidebarChoice, setSidebarChoice] = createSignal<boolean>();
	const sidebar = () => sidebarChoice() ?? vw() >= (viewer.state.open ? 1360 : 1000);
	const wide = () => vw() >= (viewer.state.open ? 1500 : 1100);
	const roomy = () => vw() >= (viewer.state.open ? 1400 : 1100);
	const [mode, setMode] = createSignal<Mode>("Agisci");
	const [now, setNow] = createSignal(Date.now());
	const clock = setInterval(() => setNow(Date.now()), 500);
	onCleanup(() => clearInterval(clock));
	let composer: ComposerApi | undefined;
	let composerText = "";
	const composerEmpty = () => !composerText.trim();
	let search: HTMLInputElement | undefined;

	const refreshInfo = () => desk.info?.().then(setInfo, () => undefined);
	refreshInfo();
	const infoTimer = setInterval(refreshInfo, 30_000);
	onCleanup(() => clearInterval(infoTimer));

	// ---- The viewer: files, code with the turn's changes, web pages and PDFs (the native view) ----------------------
	async function openFile(path: string) {
		const file = await desk.file(path);
		if (file.error && !file.kind) return chat.addNote(file.error, "error");
		const name = file.name ?? tail(path);
		const where = file.path ?? path;
		if (file.kind === "pdf") return viewer.open({ id: `pdf:${where}`, kind: "pdf", name, path: where, src: file.url });
		if (file.kind === "html") return openWeb(file.url!);
		if (file.kind === "image") return showImage(file.url!, name, where);
		if (file.kind === "text" || file.kind === "json") return viewer.open({ id: `code:${where}`, kind: "code", name, path: where, doc: file });
		viewer.open({ id: `doc:${where}`, kind: "doc", name, path: where, doc: file });
	}
	async function openCode(path: string, edits?: Edit[]) {
		const file = await desk.file(path);
		if (file.kind && file.kind !== "text" && file.kind !== "json") return openFile(path);
		viewer.open({ id: `code:${file.path ?? path}`, kind: "code", name: tail(path), path, doc: file, edits });
	}
	function openWeb(url?: string) {
		viewer.open({ id: "web", kind: "web", name: url ? host(url) : "browser", ...(url ? { src: url } : {}) });
	}
	actions.openFile = openFile;
	actions.openCode = openCode;
	actions.openWeb = openWeb;
	const go = (value: string) => {
		const target = value.trim();
		if (target) openWeb(/\s/.test(target) || !/[.:]/.test(target) ? `https://duckduckgo.com/?q=${encodeURIComponent(target)}` : target);
	};
	// What the native view shows follows the active tab (a PDF tab, the web tab).
	let loaded = "";
	createEffect(() => {
		const tab = viewer.current();
		if ((tab?.kind === "web" || tab?.kind === "pdf") && tab.src && tab.src !== loaded) {
			loaded = tab.src;
			desk.browser("go", tab.src);
		}
	});
	const [url, setUrl] = createSignal("");
	const [nav, setNav] = createSignal({ back: false, forward: false });
	const [driving, setDriving] = createSignal(false);
	const [stats, setStats] = createSignal({ errors: 0, requests: 0 });
	desk.on("browser-stats", setStats);
	// What Pi is doing on the page now ("◆ click e12"), shown on the viewer while the step runs.
	const [acting, setActing] = createSignal("");
	desk.on("browser-url", ({ url: next, back, forward }) => {
		const shown = !next || next.startsWith("data:") ? "" : next;
		setNav({ back, forward });
		if (!shown) return;
		loaded = shown;
		setUrl(shown);
		if (viewer.current()?.kind !== "pdf") viewer.setWeb(shown, host(shown));
	});
	let slot: HTMLDivElement | undefined;
	const [slotSize, setSlotSize] = createSignal("");
	const sendRect = () => {
		const kind = viewer.current()?.kind;
		if (!slot || lightboxOpen() || (kind !== "web" && kind !== "pdf")) return desk.browserRect({ x: 0, y: 0, width: 0, height: 0 });
		const rect = slot.getBoundingClientRect();
		setSlotSize(`${Math.round(rect.width)}×${Math.round(rect.height)}`);
		desk.browserRect({ x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) });
	};
	onMount(() => {
		if (slot) createResizeObserver(slot, sendRect);
		window.addEventListener("resize", sendRect);
		sendRect();
	});
	createEffect(() => {
		viewer.current();
		viewer.state.open;
		lightboxOpen();
		sidebar();
		queueMicrotask(sendRect);
	});
	const [picking, setPicking] = createSignal(false);
	async function pick() {
		setPicking(true);
		try {
			const picked = await desk.pick();
			if (picked) composer?.attach(`Nel browser (${picked.url}) ho indicato questo elemento: ${picked.role}${picked.name ? ` «${picked.name}»` : ""}\nselettore: \`${picked.selector}\``, picked.image ? { data: picked.image, mimeType: "image/png" } : undefined);
		} finally {
			setPicking(false);
		}
	}

	// ---- Following the end of the thread: eased, stops when the user scrolls up, resumes at the end ----------------
	let scroll!: HTMLDivElement;
	const [stuck, setStuck] = createSignal(true);
	const [unseen, setUnseen] = createSignal(false);
	let glide = 0;
	const distance = () => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
	const step = () => {
		glide = 0;
		if (!stuck()) return;
		const left = distance();
		if (left <= 1) return;
		scroll.scrollTop += Math.max(1, Math.ceil(left * 0.2));
		glide = requestAnimationFrame(step);
	};
	const kick = () => {
		if (stuck()) {
			if (!glide) glide = requestAnimationFrame(step);
		} else setUnseen(true);
	};
	const follow = (change: () => void) => {
		change();
		queueMicrotask(kick);
	};
	const toEnd = () => {
		setStuck(true);
		setUnseen(false);
		kick();
	};

	// ---- Pi events ------------------------------------------------------------------------------------------------
	desk.on("pi-event", (event) => {
		follow(() => chat.onEvent(event));
		if (event.type === "tool_execution_start" && event.toolName === "browser" && event.args?.action !== "close") {
			setDriving(true);
			const a = event.args ?? {};
			setActing(a.action === "act" ? `◆ ${a.do ?? "azione"}${a.text ? ` «${String(a.text).slice(0, 40)}»` : a.ref ? ` ${a.ref}` : ""}` : a.action === "open" ? "◆ apro la pagina" : a.action === "snapshot" ? "◆ leggo la pagina" : a.action === "shot" ? "◆ screenshot" : "");
			if (viewer.current()?.kind !== "web") openWeb();
		}
		if (event.type === "tool_execution_end") setActing("");
		if (event.type === "agent_settled") {
			setDriving(false);
			refreshInfo();
		}
	});
	desk.on("pi-ui", (request) => chat.onUi(request));
	desk.on("pi-stderr", (text: string) => {
		if (/\b(error|errore)\b/i.test(text) && !/MODULE_TYPELESS|ExperimentalWarning/.test(text)) chat.addNote(text.trim().slice(0, 240));
	});
	desk.on("pi-exit", (code: string) => chat.exited(code));
	desk.on("download", ({ path, state: done, bytes }) => {
		chat.addNote(done === "completed" ? `⇣ Scaricato in ${path} (${Math.round(bytes / 1024)} KB)` : `Download non riuscito: ${path}`, done === "completed" ? undefined : "error");
		if (done === "completed") openFile(path);
	});
	desk.on("home", (path: string) => {
		setHome(path);
		setImageBase({ project: project(), home: path });
	});
	desk.on("project", (path: string) => {
		setProject(path);
		setImageBase({ project: path, home: home() });
		refreshInfo();
	});
	onMount(() => document.addEventListener("error", (event) => {
		const target = event.target as HTMLElement;
		if (target instanceof HTMLImageElement && target.closest(".md")) target.classList.add("broken");
	}, true));

	// ---- Sessions from the sidebar --------------------------------------------------------------------------------
	const [viewing, setViewing] = createSignal<{ session: Session; turns: Turn[]; writable: boolean; label: string }>();
	desk.on("session-append", ({ path, items }) => {
		const current = viewing();
		if (current?.session.path === path) follow(() => setViewing({ ...current, turns: [...current.turns, ...transcriptTurns(items)] }));
	});
	const [remote, setRemote] = createSignal<RemoteStatus>();
	let remoteTimer: ReturnType<typeof setInterval> | undefined;
	const stopRemote = () => {
		clearInterval(remoteTimer);
		remoteTimer = undefined;
		setRemote(undefined);
	};
	const watchRemote = (pid: number) => {
		stopRemote();
		const read = () => desk.sessionStatus(pid).then((reply) => setRemote(reply.status ?? undefined), () => setRemote(undefined));
		read();
		remoteTimer = setInterval(read, 600);
	};
	const answerRemote = async (value: "yes" | "no" | "always") => {
		const current = viewing();
		if (!current?.session.running) return;
		try {
			await desk.answerSession(current.session.running.pid, value);
			setRemote((status) => (status ? { ...status, mode: "working", activity: value === "no" ? "rifiutato" : "ripreso" } : status));
		} catch (error) {
			chat.addNote(clean((error as Error).message), "error");
		}
	};
	async function openSession(session: Session) {
		stopRemote();
		if (session.running?.own) return backToChat();
		const turns = transcriptTurns(await desk.openSession(session.path));
		setViewing({ session, turns, writable: false, label: session.running ? "In corso nel terminale · collegamento…" : "Sessione chiusa · sola lettura: «Riprendi qui» per continuarla" });
		queueMicrotask(() => (scroll.scrollTop = scroll.scrollHeight));
		if (!session.running) return;
		try {
			await desk.linkSession(session.running.pid, session.path);
			const current = viewing();
			if (current?.session.path === session.path) {
				setViewing({ ...current, writable: true, label: "In corso nel terminale · scrivi qui: arriva a quel Pi" });
				watchRemote(session.running.pid);
			}
		} catch (error) {
			const current = viewing();
			if (current?.session.path === session.path) setViewing({ ...current, label: `In corso nel terminale · sola lettura: ${clean((error as Error).message)}` });
		}
	}
	function backToChat() {
		stopRemote();
		if (viewing()) desk.closeSession();
		setViewing(undefined);
	}
	async function resume() {
		const current = viewing()!;
		const items = await desk.resumeSession(current.session.path, current.session.cwd);
		chat.replace([...transcriptTurns(items), { id: Date.now(), role: "note", text: `Sessione ripresa in ${current.session.cwd}` }]);
		setViewing(undefined);
		queueMicrotask(() => (scroll.scrollTop = scroll.scrollHeight));
	}
	async function newSession() {
		await desk.newSession();
		chat.replace([]);
		backToChat();
	}

	// ---- Sending --------------------------------------------------------------------------------------------------
	async function send(text: string, images: Img[]) {
		const current = viewing();
		if (current?.writable) {
			try {
				const reply = await desk.sendToSession(current.session.running!.pid, `${PREFIX[mode()]}${text}`);
				setViewing({ ...current, turns: [...current.turns, { id: Date.now(), role: "note", text: reply.queued ? "Inviato: in coda, Pi lo legge appena finisce il passo in corso" : "Inviato al Pi nel terminale" }] });
			} catch (error) {
				setViewing({ ...current, turns: [...current.turns, { id: Date.now(), role: "note", tone: "error", text: `Non inviato: ${clean((error as Error).message)}` }] });
			}
			return;
		}
		chat.addUser(text, images.length ? images : undefined);
		toEnd();
		try {
			const result = await desk.prompt(`${PREFIX[mode()]}${text}`, images.map((image) => ({ type: "image" as const, ...image })));
			if (result?.disposition === "queued") chat.addNote("In coda: Pi lo legge appena finisce");
		} catch (error) {
			chat.addNote(clean((error as Error).message), "error");
		}
	}
	async function fork(text: string, occurrence: number) {
		try {
			const result = await desk.fork(text, occurrence);
			if (result.cancelled) return;
			chat.replace([...transcriptTurns(result.items), { id: Date.now(), role: "note", text: "Nuova sessione diramata da qui: il messaggio è nel campo sotto" }]);
			if (result.text) composer?.fill(result.text);
			refreshInfo();
		} catch (error) {
			chat.addNote(`Non diramata: ${clean((error as Error).message)}`, "error");
		}
	}

	// ---- The status bar: this window's Pi, or the terminal Pi whose session is open ---------------------------------
	const lastUser = () => [...state.turns].reverse().find((t) => t.role === "user") as Extract<Turn, { role: "user" }> | undefined;
	const localBar = createMemo<Bar>(() => {
		const seconds = Math.max(0, Math.floor((now() - work.started) / 1000));
		if (state.dialog) {
			const q = localQuestion(state.dialog);
			return { state: "wait", text: q.head, meta: q.code ? `$ ${q.code}` : "serve la tua risposta", keys: q.options.map((o) => o.key.toUpperCase()).join(" · ") || "⏎ conferma" };
		}
		if (state.exited) return { state: "err", text: `Pi si è fermato (${state.exited})`, meta: "", keys: "R riavvia" };
		if (work.phase === "compacting") return { state: "compact", text: "riassumo la conversazione", meta: `${work.activity} · ${seconds}s`, keys: "" };
		if (state.busy) {
			const thinking = work.phase === "thinking";
			const meta = [work.steps ? `passo ${work.steps}` : "", `${seconds}s`, work.tokensOut ? `↓${tokens(work.tokensOut)} tok` : "", work.retry, work.queued ? `${work.queued} in coda` : ""].filter(Boolean).join(" · ");
			return { state: "run", text: thinking ? `penso${work.thought ? ` · ${work.thought}` : ""}` : work.activity || "lavoro", meta, keys: "esc interrompi", thinking };
		}
		if (work.error) return { state: "err", text: clean(work.error).slice(0, 140), meta: "", keys: "R riprova · ⏎ scrivi tu" };
		if (work.phase === "done") return { state: "done", text: "Turno completato", meta: `${duration(work.seconds)} · ↑${tokens(work.tokensIn)} ↓${tokens(work.tokensOut)} tok${work.steps ? ` · ${work.steps} ${work.steps === 1 ? "passo" : "passi"}` : ""}`, keys: "1–4 suggerimenti" };
		return { state: "idle", text: "Pronto", meta: "", keys: "" };
	});
	const remoteBar = createMemo<Bar>(() => {
		const status = remote();
		const current = viewing();
		if (!status || status.mode === "idle") return { state: "idle", text: current?.writable ? "Pi nel terminale in attesa" : current?.label ?? "", meta: "", keys: current?.writable ? "⏎ invia" : "" };
		const seconds = Math.max(0, Math.floor(((status.mode === "working" ? now() : status.endedAt || now()) - (status.startedAt ?? now())) / 1000));
		if (status.mode === "waiting") return { state: "wait", text: status.question ?? "Pi aspetta una risposta", meta: "serve il permesso", keys: "S · A · N" };
		if (status.mode === "stopped") return { state: "err", text: status.activity ?? "fermo", meta: "", keys: "⏎ scrivi tu" };
		if (status.mode === "done") return { state: "done", text: "Turno completato", meta: `${duration(seconds)} · ↑${tokens(status.tokensIn)} ↓${tokens(status.tokensOut)} tok${status.warning ? ` · ⚠ ${status.warning}` : ""}`, keys: "" };
		const thinking = status.phase === "thinking";
		return { state: "run", text: thinking ? `penso${status.thought ? ` · ${status.thought}` : ""}` : status.activity || "lavoro", meta: [status.step ? `passo ${status.step}` : "", `${seconds}s`].filter(Boolean).join(" · "), keys: "", thinking };
	});
	const bar = () => (viewing() ? remoteBar() : localBar());
	// The same object while it is the same question: the status is polled every 600 ms, and a new object would remount
	// the box (and its one-answer guard) each time.
	const question = createMemo(() => (viewing() ? (remote()?.mode === "waiting" ? remoteQuestion(remote()!.question ?? "Pi aspetta una risposta") : undefined) : state.dialog ? localQuestion(state.dialog) : undefined), undefined, { equals: (a, b) => a?.id === b?.id });
	const onAnswer = (fields: object) => {
		if (viewing()) return answerRemote((fields as { value: "yes" | "no" | "always" }).value);
		const request = state.dialog;
		if (!request) return;
		desk.answer(request.id, fields);
		chat.closeDialog();
	};
	// The row of this session in the sidebar follows the bar.
	const currentRow = createMemo<RowState | undefined>(() => {
		const b = bar();
		const frame = Math.floor(now() / 80) % SPINNER.length;
		if (b.state === "run" || b.state === "compact") return { glyph: SPINNER[frame], tone: "run", right: work.steps && !viewing() ? `passo ${work.steps}` : "al lavoro" };
		if (b.state === "wait") return { glyph: "◆", tone: "wait", right: "permesso" };
		if (b.state === "err") return { glyph: "✗", tone: "err", right: "errore" };
		if (b.state === "done") return { glyph: "✓", tone: "ok", right: "ora" };
		return undefined;
	});

	// ---- Clicks and keys ------------------------------------------------------------------------------------------
	const onClick = (event: MouseEvent) => {
		const target = event.target as HTMLElement;
		if (onTableClick(target)) return;
		const link = target.closest?.(".md a[href]");
		if (link) {
			event.preventDefault();
			const href = link.getAttribute("href")!;
			if (/^[a-z]+:\/\//i.test(href) || /^(localhost|127\.)/.test(href)) go(href);
			else openFile(href.replace(/:\d+$/, ""));
			return;
		}
		// Inline code that names a file of the project ("src/cart.js:5") opens it in the viewer.
		const code = target.closest?.(".md code.file") as HTMLElement | null;
		if (code) return void openFile(code.dataset.path ?? code.textContent!.replace(/:\d+(:\d+)?$/, ""));
		const copy = target.closest?.(".code .copy") as HTMLElement | null;
		if (copy) navigator.clipboard?.writeText(copy.closest(".code")!.querySelector("code")!.textContent ?? "").then(() => {
			copy.textContent = "Copiato";
			setTimeout(() => (copy.textContent = "Copia"), 1400);
		});
		const image = target.closest?.(".md img") as HTMLImageElement | null;
		if (image) showImage(image.src, image.alt || undefined);
	};
	const typing = (event: KeyboardEvent) => (event.target as HTMLElement)?.matches?.("input, textarea, select") && !(event.target as HTMLElement).matches("#input");
	const onKey = (event: KeyboardEvent) => {
		const ctrl = event.ctrlKey || event.metaKey;
		if (ctrl && event.key.toLowerCase() === "k") return event.preventDefault(), setSidebarChoice(true), queueMicrotask(() => search?.focus());
		if (ctrl && event.key.toLowerCase() === "b") return event.preventDefault(), setSidebarChoice(!sidebar());
		if (ctrl && event.key.toLowerCase() === "n") return event.preventDefault(), void newSession();
		if (ctrl && event.key === "\\") return event.preventDefault(), viewer.hide();
		if (event.defaultPrevented) return;
		if (event.key === "Escape" && state.busy && !state.dialog && !lightboxOpen() && !viewing()) return void desk.abort();
		if (ctrl || event.altKey || typing(event) || !composerEmpty() || question()) return;
		if (/^[1-4]$/.test(event.key)) {
			const button = document.querySelector(`.suggestions button[data-key="${event.key}"]`) as HTMLButtonElement | null;
			if (button) return event.preventDefault(), button.click();
		}
		if (event.key.toLowerCase() === "r" && bar().state === "err" && !viewing()) {
			event.preventDefault();
			if (state.exited) desk.restart().then(chat.restarted);
			else if (lastUser()) send(lastUser()!.text, []);
		}
	};
	onMount(() => {
		document.addEventListener("keydown", onKey);
		const leave = (up: boolean) => up && distance() > 4 && (setStuck(false), cancelAnimationFrame(glide), (glide = 0));
		scroll.addEventListener("wheel", (event) => leave(event.deltaY < 0), { passive: true });
		scroll.addEventListener("keydown", (event) => leave(["ArrowUp", "PageUp", "Home"].includes(event.key)));
		scroll.addEventListener("scroll", () => {
			if (distance() < 40 && !stuck()) toEnd();
		});
		new ResizeObserver(kick).observe(scroll.firstElementChild ?? scroll);
		new MutationObserver(kick).observe(scroll, { childList: true, subtree: true, characterData: true });
	});
	onCleanup(() => document.removeEventListener("keydown", onKey));

	// ---- Header ---------------------------------------------------------------------------------------------------
	const turns = () => viewing()?.turns ?? state.turns;
	const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");
	const title = () => viewing()?.session.title ?? info()?.sessionName ?? (state.turns.find((t) => t.role === "user") as Extract<Turn, { role: "user" }> | undefined)?.text.replace(/\s+/g, " ") ?? "Nuova sessione";
	const place = () => {
		const path = viewing()?.session.cwd ?? project();
		return home() && path.startsWith(home()) ? `~${path.slice(home().length)}` : path;
	};
	const chips = () => SESSION_CHIPS.flatMap(([key, name]) => {
		const text = state.statuses[key] && plain(state.statuses[key]).replace(new RegExp(`^${key}\\s*`, "i"), "");
		if (!text || viewing()) return [];
		const [done, total] = (/(\d+)\s*\/\s*(\d+)/.exec(text) ?? []).slice(1).map(Number);
		return [{ key, name, text, progress: total ? Math.min(100, (done / total) * 100) : undefined }];
	});
	const otherStatuses = () => Object.entries(state.statuses).filter(([key]) => !["goal", "loop", "team", "memory"].includes(key)).map(([, text]) => plain(text)).filter(Boolean);
	const memory = () => (state.statuses.memory ? plain(state.statuses.memory).split(" · ")[0] : undefined);
	const model = () => {
		const name = info()?.model;
		if (!name) return undefined;
		const short = /(opus|sonnet|haiku|fable)/i.exec(name)?.[1]?.toLowerCase() ?? name;
		return info()?.thinking ? `${short}·${info()!.thinking}` : short;
	};

	return (
		<div id="app" classList={{ "viewer-open": viewer.state.open }} onClick={onClick}>
			<Show when={sidebar()}>
				<Sidebar active={viewing()?.session.path} current={currentRow()} info={info()} onOpen={openSession} onNew={newSession} onClose={() => setSidebarChoice(false)} searchRef={(el) => (search = el)} />
			</Show>
			<main id="main">
				<header id="top">
					<button type="button" id="toggle-sessions" class="icon" title="Sessioni  Ctrl+B" onClick={() => setSidebarChoice(!sidebar())}>☰</button>
					<div class="where">
						<span class="title" id="session-title">{title()}</span>
						<span class="sub" id="project-path" title={viewing()?.session.cwd ?? project()}>
							<b class="proj">{place().split("/").pop()}</b> <span class="dir">{place().split("/").slice(0, -1).join("/")}</span>
							<Show when={!viewing() && info()?.branch}><span class="branch">  ⎇ {info()!.branch}</span></Show>
							<Show when={!viewing() && info()?.changes}> <span class="changed">✚{info()!.changes}</span></Show>
						</span>
					</div>
					<div class="chips">
						<Show when={wide()}>
							{chips().map((chip) => (
								<span class={`chip ${chip.key}`} title={chip.text}>
									<b>{chip.name}</b>{chip.text}
									<Show when={chip.progress !== undefined}><span class="cells"><b>{cells(chip.progress, 5).full}</b>{cells(chip.progress, 5).empty}</span></Show>
								</span>
							))}
						</Show>
						<Show when={viewing()}>
							<span id="viewer-label" class="chip" classList={{ readonly: !viewing()!.writable, live: viewing()!.writable }} title={viewing()!.label}>{viewing()!.writable ? "● terminale" : "◆ sola lettura"}</span>
							<Show when={!viewing()!.session.running}><button type="button" class="chip action" id="viewer-resume" onClick={resume}>Riprendi qui</button></Show>
							<button type="button" class="chip action" id="viewer-back" onClick={backToChat}>La mia chat</button>
						</Show>
						<button type="button" id="toggle-browser" class="icon" classList={{ on: viewer.current()?.kind === "web" }} title="Browser di Pi" onClick={() => (viewer.current()?.kind === "web" ? viewer.hide() : openWeb())}>◎</button>
					</div>
				</header>
				<div id="body">
					<section id="chat">
						<TurnMap turns={turns()} scroller={() => scroll} />
						<div id="scroll" ref={scroll}>
							<Show when={turns().length || viewing() || question()} fallback={
								<div id="empty" class="thread">
									<div class="hello">
										<div class="logo big">π</div>
										<h1>Di cosa hai bisogno?</h1>
										<p>Pi lavora nella cartella del progetto, con le tue estensioni, la memoria e un browser che si apre quando serve.</p>
										<div class="examples">{EXAMPLES.map((text) => <button type="button" onClick={() => composer?.fill(text)}>{text}</button>)}</div>
									</div>
								</div>
							}>
								<Thread turns={turns()} typing={state.typing && !viewing()} actions={{
									onSuggestion: (text) => composer?.fill(text),
									onEdit: (text) => composer?.fill(text),
									onRetry: (text) => send(text, []),
									get onFork() {
										return viewing() ? undefined : fork;
									},
									get ask() {
										return question();
									},
									onAnswer,
									composerEmpty,
								}} />
							</Show>
							<Show when={state.exited && !viewing()}>
								<div class="thread"><div class="error-card">Pi si è fermato ({state.exited}). <button type="button" onClick={() => desk.restart().then(chat.restarted)}>Riavvia</button></div></div>
							</Show>
						</div>
						<Show when={unseen() && !stuck()}>
							<button type="button" class="to-end" onClick={toEnd}>↓ nuovi messaggi</button>
						</Show>
						<div id="dock" class={bar().state}>
							<StatusBar bar={bar()} remote={Boolean(viewing())} onStop={viewing() ? undefined : () => desk.abort()} />
							<Composer busy={state.busy && !viewing()} readonly={Boolean(viewing()) && !viewing()!.writable} placeholder={viewing()?.writable ? "Scrivi al Pi nel terminale…" : state.busy ? "Scrivi per aggiungere in coda…" : "Chiedi a Pi…   / comandi · @ file"}
								queued={viewing() ? 0 : work.queued} queuedText={work.queuedText} chips={otherStatuses()} model={model()} memory={memory()} roomy={roomy()} mode={mode()} onMode={setMode}
								onSend={send} onStop={() => desk.abort()} ref={(api) => (composer = api)} onText={(value) => (composerText = value)} />
						</div>
					</section>
					<Viewer slot={(el) => (slot = el)} url={url()} nav={nav()} driving={driving()} acting={acting()} stats={stats()} onGo={go} onPick={pick} picking={picking()} slotSize={slotSize()} />
				</div>
			</main>
			<Lightbox />
		</div>
	);
}
