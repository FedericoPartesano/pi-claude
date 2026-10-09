// @ts-nocheck — plain JavaScript kept as is (tested in test/render.test.mjs); typed at its exports.
// Pi Desk rendering: Markdown → safe HTML (everything escaped first: model and page text are untrusted), the blocks
// Pi's terminal UI also understands (```grafico charts, <!--suggerimenti--> next steps), and charts as SVG.

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdownLang from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import csharp from "highlight.js/lib/languages/csharp";
import plaintext from "highlight.js/lib/languages/plaintext";

for (const [name, language] of Object.entries({ bash, css, diff, go, java, javascript, json, markdown: markdownLang, python, rust, sql, typescript, xml, yaml, csharp, plaintext })) hljs.registerLanguage(name, language);
const ALIASES = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", sh: "bash", shell: "bash", zsh: "bash", console: "bash", py: "python", rs: "rust", yml: "yaml", html: "xml", svg: "xml", vue: "xml", cs: "csharp", md: "markdown", jsonc: "json", patch: "diff", text: "plaintext", txt: "plaintext" };

// ---- Images: where a path points, and which words are images (the same patterns as pi-ui in the terminal) -------
const imageBase = { project: "", home: "" };
/** Relative paths in answers are the project's; ~ is the user's home. Changing them invalidates the cache. */
function setImageBase(base) {
	imageBase.project = (base.project ?? "").replace(/\/+$/, "");
	imageBase.home = (base.home ?? "").replace(/\/+$/, "");
	cache.clear();
}
const fileUrl = (path) => `file://${encodeURI(path.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1:"))}`;
function resolveImage(ref) {
	if (/^(https?:\/\/|data:image\/|file:\/\/)/i.test(ref)) return ref;
	if (/^[a-z][\w+.-]*:(?![\\/])/i.test(ref)) return undefined; // another scheme (javascript:, …)
	if (ref.startsWith("~/")) return imageBase.home ? fileUrl(`${imageBase.home}/${ref.slice(2)}`) : undefined;
	if (ref.startsWith("/") || /^[A-Za-z]:[\\/]/.test(ref)) return fileUrl(ref);
	return imageBase.project ? fileUrl(`${imageBase.project}/${ref.replace(/^\.\//, "")}`) : undefined;
}
const IMAGE_EXT = "png|jpe?g|gif|webp|svg|bmp|avif";
const URL_IMAGE = new RegExp(`https?://[^\\s)"'<>\`]+?\\.(?:${IMAGE_EXT})(?:\\?[^\\s)"'<>\`]*)?(?=$|[\\s)"'<>\`]|[.,;:!?](?:\\s|$))`, "gi");
const PATH_IMAGE = new RegExp(`(?:^|[\\s(\\[\`'"])((?:~|\\.{1,2})?/?(?:[\\w@.-]+/)*[\\w@-][\\w@.-]*\\.(?:${IMAGE_EXT}))(?=$|[\\s)\\]\`'"]|[.,;:!?](?:\\s|$))`, "gim");
/** Image paths and URLs written in a block (not inside markdown images or code spans with spaces). */
function imageRefs(text) {
	const plain = text.replace(/!\[[^\]\n]*\]\([^)\s]+\)/g, " ").replace(/`[^`\n]*\s[^`\n]*`/g, " ");
	const refs = [];
	for (const match of plain.matchAll(URL_IMAGE)) refs.push({ at: match.index ?? 0, ref: match[0].replace(/[.,;:!?]+$/, "") });
	const withoutUrls = plain.replace(URL_IMAGE, (url) => " ".repeat(url.length));
	for (const match of withoutUrls.matchAll(PATH_IMAGE)) refs.push({ at: (match.index ?? 0) + match[0].indexOf(match[1]), ref: match[1] });
	return [...new Set(refs.sort((a, b) => a.at - b.at).map((entry) => entry.ref))];
}

// ---- Inline ---------------------------------------------------------------------------------------------------
function inline(raw) {
	const codes = [];
	let text = escapeHtml(raw).replace(/`([^`\n]+)`/g, (_, code) => {
		codes.push(code);
		return `\u0000${codes.length - 1}\u0000`;
	});
	text = text
		.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (whole, alt, ref) => {
			const src = resolveImage(ref.replace(/&amp;/g, "&"));
			return src ? `<img class="md-img" src="${escapeHtml(src)}" alt="${alt}" loading="lazy">` : whole;
		})
		.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" title="$2">$1</a>')
		.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, '$1<a href="$2">$2</a>')
		.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
		.replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
		.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, "$1<em>$2</em>")
		.replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?!\w)/g, "$1<em>$2</em>")
		.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
	text = text.replace(/\\\((.+?)\\\)/g, (_, tex) => `<span class="math" data-tex="${tex}">${tex}</span>`).replace(/\$\$([^$\n]+?)\$\$/g, (_, tex) => `<span class="math" data-tex="${tex}">${tex}</span>`);
	return text.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codes[Number(index)]}</code>`);
}

// ---- Blocks ---------------------------------------------------------------------------------------------------
const LIST = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;
const isTableSeparator = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());

function list(lines) {
	// Nested by indentation: a stack of open lists.
	let html = "";
	const stack = [];
	for (const line of lines) {
		const match = LIST.exec(line);
		if (!match) {
			// A continuation line of the last item.
			html = html.replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
			continue;
		}
		const indent = match[1].replace(/\t/g, "  ").length;
		const ordered = /\d/.test(match[2]);
		while (stack.length && indent < stack[stack.length - 1].indent) html += `</${stack.pop().tag}></li>`;
		const top = stack[stack.length - 1];
		if (!top || indent > top.indent) {
			if (top) html = html.replace(/<\/li>$/, "");
			const tag = ordered ? "ol" : "ul";
			const start = ordered && Number.parseInt(match[2], 10) !== 1 && !top ? ` start="${Number.parseInt(match[2], 10)}"` : "";
			html += `<${tag}${start}>`;
			stack.push({ indent, tag });
		}
		const task = /^\[( |x|X)\]\s+(.*)$/.exec(match[3]);
		html += task ? `<li class="task${task[1] === " " ? "" : " done"}"><span class="check">${task[1] === " " ? "" : "✓"}</span> ${inline(task[2])}</li>` : `<li>${inline(match[3])}</li>`;
	}
	while (stack.length) {
		html += `</${stack.pop().tag}>`;
		if (stack.length) html += "</li>";
	}
	return html;
}

function table(lines) {
	const head = cells(lines[0]);
	const align = cells(lines[1]).map((cell) => (/^:-+:$/.test(cell) ? "center" : /-+:$/.test(cell) ? "right" : ""));
	const cls = (index) => (align[index] ? ` class="${align[index]}"` : "");
	const body = lines.slice(2).map((line) => `<tr>${cells(line).map((cell, index) => `<td${cls(index)}>${inline(cell)}</td>`).join("")}</tr>`).join("");
	return `<div class="table"><button class="table-csv" type="button" title="Copia come CSV">CSV</button><table><thead><tr>${head.map((cell, index) => `<th${cls(index)}>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const TONES = { ok: "ok", positivo: "ok", bene: "ok", warn: "warn", attenzione: "warn", medio: "warn", err: "err", errore: "err", negativo: "err", male: "err", info: "info", neutro: "info" };

/** ```kpi: [{"etichetta","valore","variazione"?,"tono"?: ok|warn|err|info,"nota"?}] → cards. */
function kpis(body) {
	let items;
	try {
		items = JSON.parse(body);
	} catch {
		return undefined; // streaming: shown once complete
	}
	if (!Array.isArray(items)) items = [items];
	return `<div class="kpis">${items
		.map((item) => {
			const tone = TONES[String(item.tono ?? item.tone ?? "").toLowerCase()] ?? "info";
			const delta = item.variazione ?? item.delta;
			return `<div class="kpi ${tone}"><div class="kpi-label">${escapeHtml(item.etichetta ?? item.label ?? "")}</div><div class="kpi-value">${escapeHtml(item.valore ?? item.value ?? "")}</div>${delta !== undefined ? `<div class="kpi-delta">${escapeHtml(delta)}</div>` : ""}${item.nota ?? item.note ? `<div class="kpi-note">${escapeHtml(item.nota ?? item.note)}</div>` : ""}</div>`;
		})
		.join("")}</div>`;
}

function code(lang, body, complete = true) {
	const language = (lang || "").toLowerCase();
	// Rendered after: Mermaid diagrams (lazy-loaded, only once the block is complete) and display math.
	if (language === "mermaid") return `<div class="mermaid" data-src="${escapeHtml(body)}" data-complete="${complete ? 1 : 0}"><pre>${escapeHtml(body)}</pre></div>`;
	if (["math", "latex", "katex", "tex"].includes(language)) return `<div class="math" data-tex="${escapeHtml(body.trim())}" data-display="1">${escapeHtml(body)}</div>`;
	if (language === "kpi") {
		const cards = complete ? kpis(body) : undefined;
		if (cards) return cards;
	}
	const known = ALIASES[language] ?? language;
	let highlighted;
	if (known && hljs.getLanguage(known)) {
		try {
			highlighted = hljs.highlight(body, { language: known, ignoreIllegals: true }).value;
		} catch {
			highlighted = undefined;
		}
	}
	const label = lang || "testo";
	return `<div class="code" data-lang="${escapeHtml(label)}"><div class="code-head"><span>${escapeHtml(label)}</span><button class="copy" type="button">Copia</button></div><pre><code class="hljs">${highlighted ?? escapeHtml(body)}</code></pre></div>`;
}

/** GitHub alerts and their Italian names → [class, title, icon]. */
const CALLOUTS = {
	NOTE: ["note", "Nota", "i"], NOTA: ["note", "Nota", "i"],
	TIP: ["tip", "Suggerimento", "✦"], SUGGERIMENTO: ["tip", "Suggerimento", "✦"],
	IMPORTANT: ["important", "Importante", "!"], IMPORTANTE: ["important", "Importante", "!"],
	WARNING: ["warning", "Attenzione", "⚠"], ATTENZIONE: ["warning", "Attenzione", "⚠"],
	CAUTION: ["caution", "Pericolo", "✕"], PERICOLO: ["caution", "Pericolo", "✕"],
};

function markdown(source) {
	const lines = String(source).replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n").split("\n");
	let html = "";
	let paragraph = [];
	const flush = () => {
		if (paragraph.length) html += `<p>${paragraph.map(inline).join("<br>")}</p>`;
		paragraph = [];
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const fence = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/.exec(line);
		if (fence) {
			flush();
			const body = [];
			for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
			html += code(fence[2], body.join("\n"), i < lines.length);
			continue;
		}
		if (/^\s*\$\$/.test(line)) {
			flush();
			const tex = [line.replace(/^\s*\$\$/, "")];
			let closed = /\$\$\s*$/.test(tex[0]) && tex[0].trim() !== "";
			if (closed) tex[0] = tex[0].replace(/\$\$\s*$/, "");
			for (i++; !closed && i < lines.length; i++) {
				if (/\$\$\s*$/.test(lines[i])) {
					tex.push(lines[i].replace(/\$\$\s*$/, ""));
					closed = true;
					break;
				}
				tex.push(lines[i]);
			}
			const source = tex.join("\n").trim();
			html += `<div class="math" data-tex="${escapeHtml(source)}" data-display="1">${escapeHtml(source)}</div>`;
			continue;
		}
		if (!line.trim()) {
			flush();
			continue;
		}
		const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
		if (heading) {
			flush();
			// # and ## both h2 (an h1 is too loud in a chat), down to h4.
			const level = Math.min(4, Math.max(2, heading[1].length));
			html += `<h${level}>${inline(heading[2])}</h${level}>`;
			continue;
		}
		if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
			flush();
			html += "<hr>";
			continue;
		}
		if (/^\s*>/.test(line)) {
			flush();
			const quote = [];
			for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ""));
			i--;
			const callout = /^\s*\[!(\w+)\]\s*(.*)$/.exec(quote[0] ?? "");
			const kind = callout && CALLOUTS[callout[1].toUpperCase()];
			if (kind) {
				const rest = [callout[2], ...quote.slice(1)].filter((part, index) => index > 0 || part.trim()).join("\n");
				html += `<div class="callout ${kind[0]}"><div class="callout-title"><span class="callout-icon">${kind[2]}</span>${kind[1]}</div>${markdown(rest)}</div>`;
			} else html += `<blockquote>${markdown(quote.join("\n"))}</blockquote>`;
			continue;
		}
		if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
			flush();
			const rows = [line, lines[i + 1]];
			for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) rows.push(lines[i]);
			i--;
			html += table(rows);
			continue;
		}
		if (LIST.test(line)) {
			flush();
			const items = [];
			// A blank line between two items does not end the list ("loose" lists: numbering goes on).
			const kind = (text) => (/^\s*\d/.test(text) ? "ol" : "ul");
			const sameKind = (next) => LIST.test(next) && /^\S/.test(next) === /^\S/.test(items.findLast((item) => LIST.test(item)) ?? "") && kind(next) === kind(items.findLast((item) => LIST.test(item) && /^\S/.test(item)) ?? next);
			for (; i < lines.length && (LIST.test(lines[i]) || (lines[i].trim() && /^\s{2,}\S/.test(lines[i])) || (!lines[i].trim() && sameKind(lines[i + 1] ?? ""))); i++) if (lines[i].trim()) items.push(lines[i]);
			i--;
			html += list(items);
			continue;
		}
		paragraph.push(line);
	}
	flush();
	return html;
}

// ---- Pi's blocks: charts and suggestions -------------------------------------------------------------------------
const SUGGESTION_MARK = "<!--suggerimenti-->";
const TYPES = { barre: "bar", bar: "bar", colonne: "bar", "barre-orizzontali": "hbar", hbar: "hbar", orizzontali: "hbar", linee: "line", linea: "line", line: "line", torta: "pie", pie: "pie", ciambella: "donut", donut: "donut", area: "area", aree: "area", "barre-impilate": "stacked", impilate: "stacked", stacked: "stacked" };

function toChart(json) {
	const spec = JSON.parse(json);
	const series = (spec.serie ?? spec.series ?? []).map((item) => ({ name: item.nome ?? item.name ?? "", values: (item.valori ?? item.values ?? []).map(Number) }));
	return { type: TYPES[spec.tipo ?? spec.type] ?? "bar", title: spec.titolo ?? spec.title ?? "", labels: (spec.etichette ?? spec.labels ?? []).map(String), series, unit: spec.unita ?? spec.unit ?? "" };
}

/** Cuts the chart blocks and the suggestions out of an answer. */
function extract(source) {
	let text = String(source);
	let suggestions = [];
	const mark = text.indexOf(SUGGESTION_MARK);
	if (mark >= 0) {
		suggestions = text
			.slice(mark + SUGGESTION_MARK.length)
			.split("\n")
			.map((line) => /^\s*[-*•]\s+(.+?)\s*$/.exec(line)?.[1])
			.filter(Boolean)
			.slice(0, 4);
		text = text.slice(0, mark);
	}
	const charts = [];
	text = text.replace(/```grafico\s*\n([\s\S]*?)(```|$)/g, (_, json) => {
		try {
			charts.push(toChart(json));
			return `\n\n<!--chart:${charts.length - 1}-->\n\n`;
		} catch {
			return ""; // still streaming, or not JSON: shown once complete
		}
	});
	const marked = text.replace(/\n{3,}/g, "\n\n").trimEnd();
	return { text: marked.replace(/\n*<!--chart:\d+-->\n*/g, "\n\n").replace(/\n{3,}/g, "\n\n").trim(), marked, suggestions, charts };
}

// Neon Night (pi-ui/src/palette.ts): cyan, magenta, yellow, green, amber, red.
const COLORS = ["#2ee6ff", "#ff3fd8", "#f5e14a", "#3df2a0", "#f5b942", "#ff4d6d"];
const fmt = (value) => (Math.abs(value) >= 1000 ? value.toLocaleString("it-IT", { maximumFractionDigits: 0 }) : value.toLocaleString("it-IT", { maximumFractionDigits: 2 }));

function niceMax(value) {
	if (value <= 0) return 1;
	const power = 10 ** Math.floor(Math.log10(value));
	const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= value / 4) * power;
	return Math.ceil(value / step) * step;
}

/** Pie and donut: the first series, slices with their share; legend with values. */
function pieSvg(spec) {
	const values = (spec.series[0]?.values ?? []).map((value) => Math.max(0, Number(value) || 0));
	const total = values.reduce((sum, value) => sum + value, 0) || 1;
	const unit = spec.unit ? ` ${spec.unit}` : "";
	const cx = 150;
	const cy = 130;
	const r = 110;
	let angle = -Math.PI / 2;
	let body = "";
	values.forEach((value, i) => {
		const share = value / total;
		const next = angle + share * Math.PI * 2;
		const large = next - angle > Math.PI ? 1 : 0;
		const [x1, y1, x2, y2] = [cx + r * Math.cos(angle), cy + r * Math.sin(angle), cx + r * Math.cos(next), cy + r * Math.sin(next)];
		const d = share >= 0.9999 ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z` : `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
		body += `<path d="${d}" fill="${COLORS[i % COLORS.length]}" stroke="#13121a" stroke-width="2"><title>${escapeHtml(spec.labels[i] ?? "")}: ${fmt(value)}${escapeHtml(unit)} (${Math.round(share * 100)}%)</title></path>`;
		angle = next;
	});
	if (spec.type === "donut") body += `<circle class="donut-hole" cx="${cx}" cy="${cy}" r="${r * 0.58}" fill="var(--surface, #13121a)"/><text x="${cx}" y="${cy + 6}" text-anchor="middle" class="donut-total">${fmt(total)}${escapeHtml(unit)}</text>`;
	const legend = `<div class="legend vertical">${spec.labels.map((label, i) => `<span><i style="background:${COLORS[i % COLORS.length]}"></i>${escapeHtml(label)} <b>${fmt(values[i] ?? 0)}${escapeHtml(unit)}</b> <small>${Math.round(((values[i] ?? 0) / total) * 100)}%</small></span>`).join("")}</div>`;
	return `<figure class="chart pie">${spec.title ? `<figcaption>${escapeHtml(spec.title)}</figcaption>` : ""}<div class="pie-row"><svg viewBox="0 0 300 260" role="img" aria-label="${escapeHtml(spec.title || "grafico")}">${body}</svg>${legend}</div></figure>`;
}

function chartSvg(spec) {
	if (spec.type === "pie" || spec.type === "donut") return pieSvg(spec);
	const width = 640;
	const height = spec.type === "hbar" ? Math.max(160, 34 * spec.labels.length + 50) : 280;
	const left = spec.type === "hbar" ? 110 : 44;
	const top = 14;
	const right = 16;
	const bottom = spec.type === "hbar" ? 26 : 40;
	const plotW = width - left - right;
	const plotH = height - top - bottom;
	const all = spec.series.flatMap((series) => series.values).filter(Number.isFinite);
	// Stacked bars: the scale is the tallest stack.
	const stackTotals = spec.labels.map((_, i) => spec.series.reduce((sum, series) => sum + Math.max(0, series.values[i] ?? 0), 0));
	const max = niceMax(Math.max(0, ...(spec.type === "stacked" ? stackTotals : all)));
	const unit = spec.unit ? ` ${spec.unit}` : "";
	const tip = (series, label, value) => `<title>${escapeHtml(series.name ? `${series.name} · ` : "")}${escapeHtml(label)}: ${fmt(value)}${escapeHtml(unit)}</title>`;
	let body = "";
	const ticks = 4;
	for (let t = 0; t <= ticks; t++) {
		const value = (max / ticks) * t;
		if (spec.type === "hbar") {
			const x = left + (plotW * t) / ticks;
			body += `<line class="grid" x1="${x}" y1="${top}" x2="${x}" y2="${top + plotH}"/><text class="axis" x="${x}" y="${height - 8}" text-anchor="middle">${fmt(value)}</text>`;
		} else {
			const y = top + plotH - (plotH * t) / ticks;
			body += `<line class="grid" x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}"/><text class="axis" x="${left - 6}" y="${y + 4}" text-anchor="end">${fmt(value)}</text>`;
		}
	}
	const n = spec.labels.length || 1;
	const k = spec.series.length || 1;
	if (spec.type === "bar") {
		const band = plotW / n;
		const barW = Math.max(3, (band * 0.72) / k);
		spec.labels.forEach((label, i) => {
			spec.series.forEach((series, s) => {
				const value = series.values[i] ?? 0;
				const h = (plotH * Math.max(0, value)) / max;
				const x = left + band * i + (band - barW * k) / 2 + barW * s;
				body += `<rect rx="3" x="${x.toFixed(1)}" y="${(top + plotH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${COLORS[s % COLORS.length]}">${tip(series, label, value)}</rect>`;
			});
			if (n <= 24 || i % Math.ceil(n / 24) === 0) body += `<text class="axis" x="${(left + band * i + band / 2).toFixed(1)}" y="${top + plotH + 18}" text-anchor="middle">${escapeHtml(label.slice(0, 12))}</text>`;
		});
	} else if (spec.type === "hbar") {
		const band = plotH / n;
		const barH = Math.max(3, (band * 0.7) / k);
		spec.labels.forEach((label, i) => {
			body += `<text class="axis" x="${left - 8}" y="${(top + band * i + band / 2 + 4).toFixed(1)}" text-anchor="end">${escapeHtml(label.slice(0, 16))}</text>`;
			spec.series.forEach((series, s) => {
				const value = series.values[i] ?? 0;
				const w = (plotW * Math.max(0, value)) / max;
				const y = top + band * i + (band - barH * k) / 2 + barH * s;
				body += `<rect rx="3" x="${left}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${barH.toFixed(1)}" fill="${COLORS[s % COLORS.length]}">${tip(series, label, value)}</rect>`;
			});
		});
	} else if (spec.type === "stacked") {
		const band = plotW / n;
		const barW = Math.max(4, band * 0.6);
		spec.labels.forEach((label, i) => {
			let base = top + plotH;
			spec.series.forEach((series, s) => {
				const value = Math.max(0, series.values[i] ?? 0);
				const h = (plotH * value) / max;
				base -= h;
				body += `<rect x="${(left + band * i + (band - barW) / 2).toFixed(1)}" y="${base.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${COLORS[s % COLORS.length]}" stroke="#13121a" stroke-width="1">${tip(series, label, value)}</rect>`;
			});
			if (n <= 24 || i % Math.ceil(n / 24) === 0) body += `<text class="axis" x="${(left + band * i + band / 2).toFixed(1)}" y="${top + plotH + 18}" text-anchor="middle">${escapeHtml(label.slice(0, 12))}</text>`;
		});
	} else {
		const x = (i) => left + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
		const y = (value) => top + plotH - (plotH * Math.max(0, value)) / max;
		spec.series.forEach((series, s) => {
			const color = COLORS[s % COLORS.length];
			const points = series.values.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
			if (spec.type === "area" && series.values.length) body += `<path class="area" d="M ${x(0).toFixed(1)} ${top + plotH} L ${points.split(" ").join(" L ")} L ${x(series.values.length - 1).toFixed(1)} ${top + plotH} Z" fill="${color}" fill-opacity=".16"/>`;
			body += `<polyline fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" points="${points}"/>`;
			series.values.forEach((value, i) => (body += `<circle cx="${x(i).toFixed(1)}" cy="${y(value).toFixed(1)}" r="3.6" fill="${color}">${tip(series, spec.labels[i] ?? "", value)}</circle>`));
		});
		spec.labels.forEach((label, i) => {
			if (n <= 12 || i % Math.ceil(n / 12) === 0) body += `<text class="axis" x="${x(i).toFixed(1)}" y="${top + plotH + 18}" text-anchor="middle">${escapeHtml(label.slice(0, 12))}</text>`;
		});
	}
	const legend = spec.series.some((series) => series.name) ? `<div class="legend">${spec.series.map((series, s) => `<span><i style="background:${COLORS[s % COLORS.length]}"></i>${escapeHtml(series.name)}</span>`).join("")}</div>` : "";
	return `<figure class="chart">${spec.title ? `<figcaption>${escapeHtml(spec.title)}${unit ? `<small>${escapeHtml(spec.unit)}</small>` : ""}</figcaption>` : ""}<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(spec.title || "grafico")}">${body}</svg>${legend}</figure>`;
}

/** An answer as HTML: markdown with its charts in place; suggestions returned apart (rendered as buttons). */
function answer(source) {
	const { marked, suggestions, charts } = extract(source);
	const html = markdown(marked.replace(/<!--chart:(\d+)-->/g, "@@CHART$1@@")).replace(/<p>@@CHART(\d+)@@<\/p>|@@CHART(\d+)@@/g, (_, a, b) => chartSvg(charts[Number(a ?? b)]));
	return { html, suggestions };
}

// ---- Memoised, block by block (what useMemo would do): an answer is split into top-level blocks at blank lines
// outside code fences; each block's HTML is cached by its text. While streaming only the last block changes, so
// only it is rendered again — and the page updates only its node.
const cache = new Map();
const CACHE_MAX = 600;
function memo(key, compute) {
	const hit = cache.get(key);
	if (hit !== undefined) {
		cache.delete(key);
		cache.set(key, hit); // most recently used last
		return hit;
	}
	const value = compute();
	cache.set(key, value);
	if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
	return value;
}

/** Top-level blocks: split at blank lines, never inside a fence (``` or ~~~), a list or a table. */
function splitBlocks(text) {
	const blocks = [];
	let current = [];
	let fence = "";
	for (const line of text.split("\n")) {
		const marker = /^\s*(```|~~~)/.exec(line)?.[1];
		if (marker) fence = fence === marker ? "" : fence || marker;
		if (!fence && !line.trim() && current.length) {
			blocks.push(current.join("\n"));
			current = [];
			continue;
		}
		current.push(line);
	}
	if (current.length) blocks.push(current.join("\n"));
	// A list or a table continues across a blank line: glue such blocks back (rendering them apart would restart numbering).
	const glued = [];
	for (const block of blocks) {
		const previous = glued[glued.length - 1];
		if (previous !== undefined && /^\s*([-*+•]|\d+[.)])\s/.test(block) && /(^|\n)\s*([-*+•]|\d+[.)])\s[^\n]*$/.test(previous)) glued[glued.length - 1] = `${previous}\n\n${block}`;
		else glued.push(block);
	}
	return glued;
}

/** An answer as a list of block HTML strings (memoised) and its suggestions. */
/** Thumbnails for the images a block mentions (outside code blocks). */
function thumbs(block) {
	if (/^\s*(```|~~~)/.test(block)) return "";
	const images = imageRefs(block).map((ref) => [ref, resolveImage(ref)]).filter(([, src]) => src);
	return images.length ? `<div class="thumbs">${images.map(([ref, src]) => `<img src="${escapeHtml(src)}" alt="${escapeHtml(ref)}" title="${escapeHtml(ref)}" loading="lazy">`).join("")}</div>` : "";
}

function answerBlocks(source) {
	const { marked, suggestions, charts } = extract(source);
	const html = splitBlocks(marked).map((block) =>
		memo(block, () => markdown(block.replace(/<!--chart:(\d+)-->/g, "@@CHART$1@@")).replace(/<p>@@CHART(\d+)@@<\/p>|@@CHART(\d+)@@/g, (_, a, b) => chartSvg(charts[Number(a ?? b)])) + thumbs(block)),
	);
	return { blocks: html, suggestions };
}


export { escapeHtml, markdown, extract, chartSvg, answer, answerBlocks, splitBlocks, setImageBase, resolveImage };
export type ChartSpec = { type: "bar" | "hbar" | "line"; title: string; labels: string[]; series: { name: string; values: number[] }[]; unit: string };
