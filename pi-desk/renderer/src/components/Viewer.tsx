import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { desk } from "../bridge";
import { ICON, type Tab, viewer } from "../viewer";
import { Markdown } from "./Markdown";
import { Table } from "./Table";
import { openImage } from "./Lightbox";

const size = (bytes = 0) => (bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);

function ImageView(props: { tab: Tab }) {
	const [zoom, setZoom] = createSignal(100);
	const [natural, setNatural] = createSignal({ w: 0, h: 0 });
	const type = () => (/^data:image\/(\w+)/.exec(props.tab.src ?? "")?.[1] ?? /\.(\w+)$/.exec(props.tab.path ?? props.tab.src ?? "")?.[1] ?? "").toUpperCase();
	const bytes = () => (props.tab.src?.startsWith("data:") ? Math.round(((props.tab.src.length - props.tab.src.indexOf(",") - 1) * 3) / 4) : 0);
	return (
		<div class="pane img">
			<div class="stage">
				<img src={props.tab.src} alt={props.tab.name} style={{ "max-width": zoom() === 100 ? "min(100%, 640px)" : "none", width: zoom() === 100 ? undefined : `${(natural().w * zoom()) / 100}px` }}
					onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
					onClick={(event) => openImage(event.currentTarget.src, event.currentTarget)} title="Clic: schermo intero" />
			</div>
			<div class="pane-foot">
				<span class="path">{props.tab.path ?? props.tab.name}</span>
				<span>{[natural().w ? `${natural().w}×${natural().h}` : "", type(), bytes() ? size(bytes()) : ""].filter(Boolean).join(" · ")}</span>
				<span class="grow" />
				<span class="zoom"><button type="button" onClick={() => setZoom(Math.max(25, zoom() - 25))}>−</button><b>{zoom()}%</b><button type="button" onClick={() => setZoom(Math.min(400, zoom() + 25))}>+</button></span>
			</div>
		</div>
	);
}

/** A file's lines with a gutter; lines the turn changed in green. "diff" shows the turn's edits instead. */
function CodeView(props: { tab: Tab }) {
	const [mode, setMode] = createSignal<"file" | "diff">("file");
	const text = () => {
		const doc = props.tab.doc;
		if (doc?.kind !== "json") return doc?.text ?? "";
		try {
			return JSON.stringify(JSON.parse(doc.text ?? ""), null, 2);
		} catch {
			return doc.text ?? "";
		}
	};
	const lines = createMemo(() => text().split("\n"));
	const changed = createMemo(() => {
		const marks = new Set<number>();
		for (const edit of props.tab.edits ?? []) {
			const at = text().indexOf(edit.newText);
			if (at < 0 || !edit.newText) continue;
			const first = text().slice(0, at).split("\n").length - 1;
			edit.newText.split("\n").forEach((_, i) => marks.add(first + i));
		}
		return marks;
	});
	const counts = () => (props.tab.edits ?? []).reduce((n, e) => ({ add: n.add + e.newText.split("\n").length, del: n.del + (e.oldText ? e.oldText.split("\n").length : 0) }), { add: 0, del: 0 });
	const diff = createMemo(() => (props.tab.edits ?? []).flatMap((edit, i) => [
		...(i ? [{ sign: "", t: "⋯", cls: "gap" }] : []),
		...(edit.oldText ? edit.oldText.split("\n").map((t) => ({ sign: "−", t, cls: "del" })) : []),
		...edit.newText.split("\n").map((t) => ({ sign: "+", t, cls: "add" })),
	]));
	const [copied, setCopied] = createSignal(false);
	return (
		<div class="pane code">
			<div class="pane-bar">
				<span class="path" title={props.tab.path}>{props.tab.path}</span>
				<Show when={props.tab.edits?.length}><span class="add">+{counts().add}</span><span class="del">−{counts().del}</span></Show>
				<span class="grow" />
				<Show when={props.tab.edits?.length}>
					<span class="seg"><button type="button" classList={{ on: mode() === "file" }} onClick={() => setMode("file")}>file</button><button type="button" classList={{ on: mode() === "diff" }} onClick={() => setMode("diff")}>diff</button></span>
				</Show>
				<button type="button" class="link" onClick={() => navigator.clipboard?.writeText(text()).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1200)))}>{copied() ? "copiato" : "copia"}</button>
			</div>
			<div class="lines">
				<Show when={mode() === "file"} fallback={<For each={diff()}>{(row) => <div class={row.cls}><span class="ln">{row.sign}</span><span>{row.t || " "}</span></div>}</For>}>
					<For each={lines()}>{(line, i) => <div classList={{ add: changed().has(i()) }}><span class="ln">{i() + 1}</span><span>{line || " "}</span></div>}</For>
				</Show>
			</div>
			<Show when={props.tab.doc?.truncated}><div class="pane-foot">File lungo: mostrati i primi 2 MB</div></Show>
		</div>
	);
}

/** The panel: tabs on top, the open one below. PDF and web pages are the native view placed over #browser-slot. */
export function Viewer(props: { slot: (el: HTMLDivElement) => void; url: string; nav: { back: boolean; forward: boolean }; driving: boolean; acting: string; stats: { errors: number; requests: number }; onGo: (url: string) => void; onPick: () => void; picking: boolean; slotSize: string }) {
	const tab = () => viewer.current();
	const native = () => tab()?.kind === "web" || tab()?.kind === "pdf";
	const outside = () => {
		const t = tab();
		const target = t?.kind === "web" ? t.src : t?.path;
		if (target) desk.openExternal(target);
	};
	return (
		<aside id="viewer" hidden={!viewer.state.open}>
			<div class="tabs">
				<div class="tab-list">
					<For each={viewer.state.tabs}>
						{(t) => (
							<div class="tab" classList={{ active: t.id === viewer.state.active }} onClick={() => viewer.activate(t.id)} title={t.path ?? t.src ?? t.name}>
								<span class="ic">{ICON[t.kind]}</span>
								<span class="name">{t.name}</span>
								<button type="button" class="x" title="Chiudi" onClick={(event) => (event.stopPropagation(), viewer.close(t.id))}>×</button>
							</div>
						)}
					</For>
				</div>
				<button type="button" class="icon" title="Apri fuori" onClick={outside}>↗</button>
				<button type="button" class="icon" id="close-browser" title="Chiudi pannello  Ctrl+\" onClick={viewer.hide}>×</button>
			</div>
			<Show when={tab()?.kind === "web"}>
				<nav id="browserbar">
					<button type="button" class="icon" title="Indietro" disabled={!props.nav.back} onClick={() => desk.browser("back")}>‹</button>
					<button type="button" class="icon" title="Avanti" disabled={!props.nav.forward} onClick={() => desk.browser("forward")}>›</button>
					<button type="button" class="icon" title="Ricarica" onClick={() => desk.browser("reload")}>↻</button>
					<input id="url" spellcheck={false} placeholder="Indirizzo o ricerca" value={props.url} onKeyDown={(event) => event.key === "Enter" && props.onGo(event.currentTarget.value)} />
					<Show when={props.acting}><span class="acting">{props.acting}</span></Show>
					<Show when={props.driving}><span class="driving" title="Pi può cliccare, leggere e fare screenshot di questa pagina">● Pi al comando</span></Show>
				</nav>
			</Show>
			<Show when={tab()?.kind === "pdf"}>
				<div class="pane-bar"><span class="path">{tab()!.path}</span><span class="grow" /><span>visore PDF di Chromium · Ctrl+F cerca</span></div>
			</Show>
			<div id="browser-slot" ref={props.slot} hidden={!native()}><div class="slot-hint">Il browser di Pi</div></div>
			<Show when={tab()?.kind === "web"}>
				<div class="pane-foot">
					<span>console <span classList={{ ok: !props.stats.errors, bad: props.stats.errors > 0 }}>{props.stats.errors} {props.stats.errors === 1 ? "errore" : "errori"}</span></span>
					<span>rete {props.stats.requests}</span>
					<button type="button" class="link" classList={{ on: props.picking }} title="Indica a Pi un elemento della pagina (Esc annulla)" onClick={props.onPick}>⌖ indica</button>
					<button type="button" class="link" title="DevTools della pagina" onClick={() => desk.browser("devtools")}>devtools</button>
					<span class="grow" />
					<span>{props.slotSize}</span>
				</div>
			</Show>
			<Switch>
				<Match when={tab()?.kind === "img"}><ImageView tab={tab()!} /></Match>
				<Match when={tab()?.kind === "code"}><CodeView tab={tab()!} /></Match>
				<Match when={tab()?.kind === "doc"}>
					<div class="pane doc">
						<Switch fallback={<div class="note">{tab()!.doc?.error ?? "Formato non visualizzabile"}</div>}>
							<Match when={tab()!.doc?.error}><div class="error-card">{tab()!.doc!.error}</div></Match>
							<Match when={tab()!.doc?.kind === "markdown"}><div class="doc-md"><Markdown text={tab()!.doc!.text ?? ""} /></div></Match>
							<Match when={tab()!.doc?.kind === "csv" || tab()!.doc?.kind === "tsv"}><Table rows={tab()!.doc!.rows ?? []} truncated={tab()!.doc!.truncated} /></Match>
						</Switch>
					</div>
				</Match>
			</Switch>
		</aside>
	);
}
