// What plain HTML cannot do, done after a block is in the page: Mermaid diagrams and KaTeX formulas. Both libraries
// are big and loaded only the first time an answer needs them (vendor/, copied by scripts/vendor.mjs).
const loaded = new Map<string, Promise<void>>();

function load(src: string, css?: string): Promise<void> {
	let promise = loaded.get(src);
	if (!promise) {
		promise = new Promise<void>((resolve, reject) => {
			if (css) {
				const link = document.createElement("link");
				link.rel = "stylesheet";
				link.href = css;
				document.head.appendChild(link);
			}
			const script = document.createElement("script");
			script.src = src;
			script.onload = () => resolve();
			script.onerror = () => reject(new Error(`non caricato: ${src}`));
			document.head.appendChild(script);
		});
		loaded.set(src, promise);
	}
	return promise;
}

let mermaidReady: Promise<any> | undefined;
function mermaid(): Promise<any> {
	mermaidReady ??= load("./vendor/mermaid.min.js").then(() => {
		const m = (window as any).mermaid;
		m.initialize({
			startOnLoad: false,
			securityLevel: "strict",
			theme: "base",
			fontFamily: "Inter, Segoe UI, system-ui, sans-serif",
			themeVariables: {
				darkMode: true,
				background: "#13121a",
				primaryColor: "#1a1824",
				primaryTextColor: "#f3f5fb",
				primaryBorderColor: "#2ee6ff",
				secondaryColor: "#1c1326",
				secondaryBorderColor: "#ff3fd8",
				tertiaryColor: "#13121a",
				lineColor: "#ff3fd8",
				textColor: "#dcdfe8",
				noteBkgColor: "#221f2e",
				noteTextColor: "#dcdfe8",
				noteBorderColor: "#f5e14a",
				actorBkg: "#1a1824",
				actorBorder: "#2ee6ff",
				signalColor: "#dcdfe8",
				sequenceNumberColor: "#0c0c0c",
			},
		});
		return m;
	});
	return mermaidReady;
}

let diagram = 0;

export function enhance(root: HTMLElement) {
	for (const element of root.querySelectorAll<HTMLElement>('.mermaid[data-complete="1"]:not([data-done])')) {
		element.dataset.done = "1";
		mermaid()
			.then((m) => m.render(`pi-diagram-${++diagram}`, element.dataset.src ?? ""))
			.then(({ svg }: { svg: string }) => {
				element.innerHTML = svg;
				element.classList.add("drawn");
			})
			.catch((error: Error) => {
				element.classList.add("failed");
				element.insertAdjacentHTML("beforeend", `<div class="diagram-error">Diagramma non valido: ${String(error.message ?? error).slice(0, 160).replace(/</g, "&lt;")}</div>`);
			});
	}
	const formulas = root.querySelectorAll<HTMLElement>(".math:not([data-done])");
	if (formulas.length) {
		load("./vendor/katex.min.js", "./vendor/katex.min.css").then(() => {
			const katex = (window as any).katex;
			for (const element of formulas) {
				element.dataset.done = "1";
				try {
					katex.render(element.dataset.tex ?? "", element, { displayMode: element.dataset.display === "1", throwOnError: false, output: "html" });
				} catch {
					// Left as text.
				}
			}
		});
	}
}

/** Tables in answers: click a header to sort (numbers as numbers); the CSV button copies the table. */
export function onTableClick(target: HTMLElement): boolean {
	const csv = target.closest?.(".table-csv") as HTMLElement | null;
	if (csv) {
		const table = csv.closest(".table")!.querySelector("table")!;
		const quote = (value: string) => (/[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
		const text = [...table.rows].map((row) => [...row.cells].map((cell) => quote(cell.innerText.trim())).join(",")).join("\n");
		navigator.clipboard?.writeText(text).then(() => {
			csv.textContent = "Copiata";
			setTimeout(() => (csv.textContent = "CSV"), 1400);
		});
		return true;
	}
	const th = target.closest?.(".md th") as HTMLTableCellElement | null;
	if (!th) return false;
	const table = th.closest("table")!;
	const column = th.cellIndex;
	const down = th.dataset.sort === "up";
	for (const other of table.querySelectorAll("th")) delete (other as HTMLElement).dataset.sort;
	th.dataset.sort = down ? "down" : "up";
	const body = table.tBodies[0];
	const rows = [...body.rows];
	const value = (row: HTMLTableRowElement) => row.cells[column]?.innerText.trim() ?? "";
	const numeric = rows.every((row) => !value(row) || /^-?[\d.,\s]+%?$/.test(value(row)));
	const toNumber = (text: string) => Number(text.replace(/\s|%/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
	rows.sort((a, b) => (down ? -1 : 1) * (numeric ? toNumber(value(a)) - toNumber(value(b)) : value(a).localeCompare(value(b), "it", { numeric: true })));
	body.append(...rows);
	return true;
}
