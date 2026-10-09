import { createEffect, createSignal, onMount, Show } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import { ArrowLeft, ArrowRight, Globe, Lock, Menu, Plus, RotateCw, TriangleAlert, X } from "lucide-solid";
import { clean, desk, type Img, type Session } from "./bridge";
import { createChat, transcriptTurns, type Turn } from "./state";
import { Thread } from "./components/Thread";
import { setImageBase } from "./render";
import { Composer } from "./components/Composer";
import { Sidebar } from "./components/Sidebar";
import { ExtensionDialog } from "./components/ExtensionDialog";
import { Lightbox, lightboxOpen, openImage } from "./components/Lightbox";

const EXAMPLES = ["Riassumi lo stato del progetto", "Trova i test che falliscono e sistemali", "Apri nel browser localhost:3000 e prova il login", "Cosa ricordi di questo progetto?"];

export function App() {
	const chat = createChat();
	const { state } = chat;
	const [project, setProject] = createSignal("");
	const [sidebar, setSidebar] = makePersisted(createSignal(false), { name: "pi-desk.sidebar" });
	const [chatShare, setChatShare] = makePersisted(createSignal(46), { name: "pi-desk.chat" });
	const [browserOpen, setBrowserOpen] = createSignal(false);
	const [dragging, setDragging] = createSignal(false);
	const [url, setUrl] = createSignal("");
	const [nav, setNav] = createSignal({ back: false, forward: false, title: "" });
	// A session from the sidebar shown instead of this window's chat.
	const [viewing, setViewing] = createSignal<{ session: Session; turns: Turn[]; writable: boolean; label: string }>();
	let scroll!: HTMLDivElement;
	let chatColumn!: HTMLElement;
	let slot!: HTMLDivElement;
	let composer: { fill: (text: string) => void } | undefined;

	// ---- Pi events -----------------------------------------------------------------------------------------------
	const nearEnd = () => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
	const follow = (work: () => void) => {
		const near = nearEnd();
		work();
		if (near) queueMicrotask(() => (scroll.scrollTop = scroll.scrollHeight));
	};
	desk.on("pi-event", (event) => {
		follow(() => chat.onEvent(event));
		if (event.type === "tool_execution_start" && event.toolName === "browser" && event.args?.action !== "close") setBrowserOpen(true);
	});
	desk.on("pi-ui", (request) => chat.onUi(request));
	desk.on("pi-stderr", (text: string) => {
		if (/\b(error|errore)\b/i.test(text) && !/MODULE_TYPELESS|ExperimentalWarning/.test(text)) chat.addNote(text.trim().slice(0, 240));
	});
	desk.on("pi-exit", (code: string) => chat.exited(code));
	// Image paths in answers resolve against the project (relative) and the home (~).
	let home = "";
	desk.on("home", (path: string) => {
		home = path;
		setImageBase({ project: project(), home });
	});
	desk.on("project", (path: string) => {
		setProject(path);
		setImageBase({ project: path, home });
	});
	// An image that does not exist (a path Pi mentioned and then removed): hidden, not a broken icon.
	onMount(() => document.addEventListener("error", (event) => {
		const target = event.target as HTMLElement;
		if (target instanceof HTMLImageElement && target.closest(".md")) target.classList.add("broken");
	}, true));
	desk.on("browser-url", ({ url: next, title, back, forward }) => {
		setUrl(!next || next.startsWith("data:") ? "" : next);
		setNav({ back, forward, title: title ?? "" });
	});
	desk.on("session-append", ({ path, items }) => {
		const current = viewing();
		if (current?.session.path === path) follow(() => setViewing({ ...current, turns: [...current.turns, ...transcriptTurns(items)] }));
	});

	// ---- Sending ---------------------------------------------------------------------------------------------------
	async function send(text: string, images: Img[]) {
		const current = viewing();
		if (current?.writable) {
			try {
				const reply = await desk.sendToSession(current.session.running!.pid, text);
				setViewing({ ...current, turns: [...current.turns, { id: Date.now(), role: "note", text: reply.queued ? "Inviato: in coda, Pi lo legge appena finisce il passo in corso" : "Inviato al Pi nel terminale" }] });
			} catch (error) {
				setViewing({ ...current, turns: [...current.turns, { id: Date.now(), role: "note", tone: "error", text: `Non inviato: ${clean((error as Error).message)}` }] });
			}
			return;
		}
		chat.addUser(text, images.length ? images : undefined);
		queueMicrotask(() => (scroll.scrollTop = scroll.scrollHeight));
		try {
			const result = await desk.prompt(text, images.map((image) => ({ type: "image" as const, ...image })));
			if (result?.disposition === "queued") chat.addNote("In coda: Pi lo legge appena finisce");
		} catch (error) {
			chat.addNote(clean((error as Error).message), "error");
		}
	}

	// ---- Sessions --------------------------------------------------------------------------------------------------
	async function openSession(session: Session) {
		if (session.running?.own) return setViewing(undefined);
		const turns = transcriptTurns(await desk.openSession(session.path));
		const where = `${session.project}`;
		setViewing({ session, turns, writable: false, label: session.running ? `In corso nel terminale · ${where} · collegamento…` : `Sessione chiusa · ${where} · sola lettura` });
		queueMicrotask(() => (scroll.scrollTop = scroll.scrollHeight));
		if (!session.running) return;
		try {
			await desk.linkSession(session.running.pid, session.path);
			const current = viewing();
			if (current?.session.path === session.path) setViewing({ ...current, writable: true, label: `In corso nel terminale · ${where} · scrivi qui: arriva a quel Pi` });
		} catch (error) {
			const current = viewing();
			if (current?.session.path === session.path) setViewing({ ...current, label: `In corso nel terminale · ${where} · sola lettura: ${clean((error as Error).message)}` });
		}
	}
	function backToChat() {
		setViewing(undefined);
		desk.closeSession();
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
		setViewing(undefined);
	}

	// ---- Browser panel: the native view goes exactly over #browser-slot (nothing when closed or under the lightbox) ---
	const sendRect = () => {
		if (!browserOpen() || lightboxOpen() || !slot) return desk.browserRect({ x: 0, y: 0, width: 0, height: 0 });
		const rect = slot.getBoundingClientRect();
		desk.browserRect({ x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) });
	};
	onMount(() => {
		createResizeObserver(slot, sendRect);
		window.addEventListener("resize", sendRect);
		sendRect();
	});
	createEffect(() => {
		browserOpen();
		lightboxOpen();
		sidebar();
		chatShare();
		queueMicrotask(sendRect);
	});
	const go = (value: string) => {
		const target = value.trim();
		if (!target) return;
		setBrowserOpen(true);
		desk.browser("go", /\s/.test(target) || !/[.:]/.test(target) ? `https://duckduckgo.com/?q=${encodeURIComponent(target)}` : target);
	};
	const startDrag = (down: MouseEvent) => {
		down.preventDefault();
		setDragging(true);
		const left = sidebar() ? 272 : 0;
		const move = (event: MouseEvent) => setChatShare(Math.min(75, Math.max(25, ((event.clientX - left) / (window.innerWidth - left)) * 100)));
		const up = () => {
			setDragging(false);
			window.removeEventListener("mousemove", move);
			window.removeEventListener("mouseup", up);
		};
		window.addEventListener("mousemove", move);
		window.addEventListener("mouseup", up);
	};

	// Links in answers open in the browser panel; code blocks copy.
	const onClick = (event: MouseEvent) => {
		const target = event.target as HTMLElement;
		const link = target.closest?.(".md a[href]");
		if (link) {
			event.preventDefault();
			go(link.getAttribute("href")!);
			return;
		}
		const copy = target.closest?.(".code .copy") as HTMLElement | null;
		if (copy) navigator.clipboard?.writeText(copy.closest(".code")!.querySelector("code")!.textContent ?? "").then(() => {
			copy.textContent = "Copiato";
			setTimeout(() => (copy.textContent = "Copia"), 1400);
		});
		const image = target.closest?.(".md img") as HTMLImageElement | null;
		if (image) openImage(image.src, image);
	};
	const onKey = (event: KeyboardEvent) => {
		if (event.key === "Escape" && state.busy && !state.dialog && !lightboxOpen()) desk.abort();
	};
	onMount(() => document.addEventListener("keydown", onKey));

	const turns = () => viewing()?.turns ?? state.turns;
	const statuses = () => Object.values(state.statuses).join("   ·   ");

	return (
		<div id="app" classList={{ "sidebar-open": sidebar(), "browser-closed": !browserOpen() }} style={{ "--chat": `${chatShare()}%` }} onClick={onClick}>
			<Show when={sidebar()} fallback={<aside id="sidebar" />}>
				<Sidebar active={viewing()?.session.path} onOpen={openSession} onClose={() => setSidebar(false)} />
			</Show>

			<section id="chat" ref={chatColumn}>
				<header id="top">
					<button type="button" id="toggle-sessions" class="icon" title="Sessioni di Pi su questo PC" onClick={() => setSidebar(!sidebar())}><Menu size={17} /></button>
					<div class="logo">π</div>
					<div class="where"><b id="project-name">{project().split(/[\\/]/).filter(Boolean).pop() ?? "Pi Desk"}</b><span id="project-path" title={project()}>{project()}</span></div>
					<span id="status" class="pill" classList={{ busy: state.busy, off: Boolean(state.exited) }}>{state.status}</span>
					<button type="button" id="toggle-browser" class="icon" classList={{ on: browserOpen() }} title="Browser di Pi" onClick={() => setBrowserOpen(!browserOpen())}><Globe size={17} /></button>
					<button type="button" id="new-session" class="icon" title="Nuova sessione" onClick={newSession}><Plus size={17} /></button>
				</header>
				<Show when={viewing()}>
					<div id="viewer-bar" classList={{ live: Boolean(viewing()?.session.running) }}>
						<span class="dot" /><span id="viewer-label">{viewing()!.label}</span>
						<Show when={!viewing()!.session.running}><button type="button" id="viewer-resume" onClick={resume}>Riprendi qui</button></Show>
						<button type="button" id="viewer-back" onClick={backToChat}>La mia chat</button>
					</div>
				</Show>
				<div id="scroll" ref={scroll}>
					<Show when={turns().length || viewing()} fallback={
						<div id="empty" class="thread">
							<div class="hello">
								<div class="logo big">π</div>
								<h1>Di cosa hai bisogno?</h1>
								<p>Pi lavora nella cartella del progetto, con le tue estensioni, la memoria e un browser che si apre quando serve.</p>
								<div class="examples">{EXAMPLES.map((text) => <button type="button" onClick={() => composer?.fill(text)}>{text}</button>)}</div>
							</div>
						</div>
					}>
						<Thread turns={turns()} onSuggestion={(text) => composer?.fill(text)} />
					</Show>
					<Show when={state.exited && !viewing()}>
						<div class="thread"><div class="error-card"><TriangleAlert size={14} /> Pi si è fermato ({state.exited}). <button type="button" onClick={() => desk.restart().then(chat.restarted)}>Riavvia</button></div></div>
					</Show>
				</div>
				<Composer busy={state.busy && !viewing()} readonly={Boolean(viewing()) && !viewing()!.writable} placeholder={viewing()?.writable ? "Scrivi al Pi nel terminale…" : "Chiedi a Pi…"} statuses={statuses()} onSend={send} onStop={() => desk.abort()} ref={(api) => (composer = api)} />
				<ExtensionDialog request={state.dialog} mount={chatColumn} onAnswer={(fields) => {
					desk.answer(state.dialog!.id, fields);
					chat.closeDialog();
				}} />
				<Lightbox />
			</section>

			<div id="splitter" classList={{ dragging: dragging() }} onMouseDown={startDrag} title="Trascina per ridimensionare" />

			<section id="browser">
				<nav id="browserbar">
					<button type="button" id="back" class="icon" title="Indietro" disabled={!nav().back} onClick={() => desk.browser("back")}><ArrowLeft size={16} /></button>
					<button type="button" id="forward" class="icon" title="Avanti" disabled={!nav().forward} onClick={() => desk.browser("forward")}><ArrowRight size={16} /></button>
					<button type="button" id="reload" class="icon" title="Ricarica" onClick={() => desk.browser("reload")}><RotateCw size={15} /></button>
					<div class="url" title={nav().title}>
						<Show when={url().startsWith("https:")}><Lock size={12} class="lock" /></Show>
						<input id="url" spellcheck={false} placeholder="Indirizzo o ricerca" value={url()} onKeyDown={(event) => event.key === "Enter" && go(event.currentTarget.value)} />
					</div>
					<button type="button" id="close-browser" class="icon" title="Chiudi il browser" onClick={() => setBrowserOpen(false)}><X size={16} /></button>
				</nav>
				<div id="browser-slot" ref={slot}><div class="slot-hint">Il browser di Pi</div></div>
			</section>
		</div>
	);
}
