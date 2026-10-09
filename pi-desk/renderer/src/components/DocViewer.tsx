import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { ArrowDown, ArrowUp, FileText, X } from "lucide-solid";
import type { DocFile } from "../bridge";
import { Markdown } from "./Markdown";
import { openImage } from "./Lightbox";

const size = (bytes = 0) => (bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
const numeric = (value: string) => /^-?[\d.,\s]+%?$/.test(value.trim()) && value.trim() !== "";
const toNumber = (value: string) => Number(value.replace(/\s|%/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));

/** A CSV as a table: sticky header, click a column to sort (numbers as numbers), row count. */
function Table(props: { rows: string[][]; truncated?: boolean }) {
	const [sort, setSort] = createSignal<{ column: number; down: boolean }>();
	const header = () => props.rows[0] ?? [];
	const numericColumns = createMemo(() => header().map((_, column) => props.rows.slice(1, 50).every((row) => !row[column] || numeric(row[column]))));
	const body = createMemo(() => {
		const rows = props.rows.slice(1);
		const by = sort();
		if (!by) return rows;
		const factor = by.down ? -1 : 1;
		return [...rows].sort((a, b) => {
			const x = a[by.column] ?? "";
			const y = b[by.column] ?? "";
			return factor * (numericColumns()[by.column] ? toNumber(x) - toNumber(y) : x.localeCompare(y, "it", { numeric: true }));
		});
	});
	return (
		<div class="doc-table">
			<table>
				<thead>
					<tr>
						<For each={header()}>
							{(cell, column) => (
								<th classList={{ right: numericColumns()[column()] }} onClick={() => setSort({ column: column(), down: sort()?.column === column() ? !sort()!.down : false })}>
									{cell}
									<Show when={sort()?.column === column()}>{sort()!.down ? <ArrowDown size={11} /> : <ArrowUp size={11} />}</Show>
								</th>
							)}
						</For>
					</tr>
				</thead>
				<tbody>
					<For each={body()}>{(row) => <tr><For each={header()}>{(_, column) => <td classList={{ right: numericColumns()[column()] }}>{row[column()] ?? ""}</td>}</For></tr>}</For>
				</tbody>
			</table>
			<div class="doc-foot">{props.rows.length - 1} righe{props.truncated ? " (troncato)" : ""}</div>
		</div>
	);
}

function Code(props: { text: string }) {
	const lines = createMemo(() => props.text.split("\n"));
	return (
		<pre class="doc-code"><For each={lines()}>{(line, index) => <div><span class="ln">{index() + 1}</span>{line || " "}</div>}</For></pre>
	);
}

export function DocViewer(props: { doc: DocFile; onClose: () => void }) {
	const json = createMemo(() => {
		if (props.doc.kind !== "json") return "";
		try {
			return JSON.stringify(JSON.parse(props.doc.text ?? ""), null, 2);
		} catch {
			return props.doc.text ?? "";
		}
	});
	return (
		<div class="doc">
			<div class="doc-head">
				<FileText size={15} />
				<div class="doc-title"><b>{props.doc.name}</b><span title={props.doc.path}>{props.doc.path} · {size(props.doc.size)}</span></div>
				<button type="button" class="icon" title="Chiudi il documento" onClick={props.onClose}><X size={16} /></button>
			</div>
			<div class="doc-body">
				<Switch fallback={<div class="note">{props.doc.error ?? "Formato non visualizzabile"}</div>}>
					<Match when={props.doc.error}><div class="error-card">{props.doc.error}</div></Match>
					<Match when={props.doc.kind === "markdown"}><div class="doc-md"><Markdown text={props.doc.text ?? ""} /></div></Match>
					<Match when={props.doc.kind === "csv" || props.doc.kind === "tsv"}><Table rows={props.doc.rows ?? []} truncated={props.doc.truncated} /></Match>
					<Match when={props.doc.kind === "json"}><Code text={json()} /></Match>
					<Match when={props.doc.kind === "text"}><Code text={props.doc.text ?? ""} /></Match>
					<Match when={props.doc.kind === "image"}><div class="doc-image"><img src={props.doc.url} alt={props.doc.name} onClick={(event) => openImage(event.currentTarget.src, event.currentTarget)} /></div></Match>
				</Switch>
				<Show when={props.doc.truncated && props.doc.kind !== "csv" && props.doc.kind !== "tsv"}><div class="doc-foot">File lungo: mostrati i primi 2 MB</div></Show>
			</div>
		</div>
	);
}
