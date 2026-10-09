// Pi Desk rendering: Markdown → safe HTML (everything escaped first: model and page text are untrusted), the blocks
// Pi's terminal UI also understands (```grafico charts, <!--suggerimenti--> next steps), and charts as SVG.
// A classic script (window.PiRender) so the page needs no bundler; tests run it in a vm.
(function (root) {
	const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

	// ---- Inline ---------------------------------------------------------------------------------------------------
	function inline(raw) {
		const codes = [];
		let text = escapeHtml(raw).replace(/`([^`\n]+)`/g, (_, code) => {
			codes.push(code);
			return `\u0000${codes.length - 1}\u0000`;
		});
		text = text
			.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" title="$2">$1</a>')
			.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, '$1<a href="$2">$2</a>')
			.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
			.replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
			.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, "$1<em>$2</em>")
			.replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?!\w)/g, "$1<em>$2</em>")
			.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
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
			html += `<li>${inline(match[3])}</li>`;
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
		return `<div class="table"><table><thead><tr>${head.map((cell, index) => `<th${cls(index)}>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
	}

	function code(lang, body) {
		const label = lang || "testo";
		return `<div class="code" data-lang="${escapeHtml(label)}"><div class="code-head"><span>${escapeHtml(label)}</span><button class="copy" type="button">Copia</button></div><pre><code>${escapeHtml(body)}</code></pre></div>`;
	}

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
				html += code(fence[2], body.join("\n"));
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
				html += `<blockquote>${markdown(quote.join("\n"))}</blockquote>`;
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
	const TYPES = { barre: "bar", bar: "bar", colonne: "bar", "barre-orizzontali": "hbar", hbar: "hbar", orizzontali: "hbar", linee: "line", linea: "line", line: "line" };

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

	function chartSvg(spec) {
		const width = 640;
		const height = spec.type === "hbar" ? Math.max(160, 34 * spec.labels.length + 50) : 280;
		const left = spec.type === "hbar" ? 110 : 44;
		const top = 14;
		const right = 16;
		const bottom = spec.type === "hbar" ? 26 : 40;
		const plotW = width - left - right;
		const plotH = height - top - bottom;
		const all = spec.series.flatMap((series) => series.values).filter(Number.isFinite);
		const max = niceMax(Math.max(0, ...all));
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
		} else {
			const x = (i) => left + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
			const y = (value) => top + plotH - (plotH * Math.max(0, value)) / max;
			spec.series.forEach((series, s) => {
				const color = COLORS[s % COLORS.length];
				const points = series.values.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
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
	function answerBlocks(source) {
		const { marked, suggestions, charts } = extract(source);
		const html = splitBlocks(marked).map((block) =>
			memo(block, () => markdown(block.replace(/<!--chart:(\d+)-->/g, "@@CHART$1@@")).replace(/<p>@@CHART(\d+)@@<\/p>|@@CHART(\d+)@@/g, (_, a, b) => chartSvg(charts[Number(a ?? b)]))),
		);
		return { blocks: html, suggestions };
	}

	const api = { escapeHtml, markdown, extract, chartSvg, answer, answerBlocks, splitBlocks };
	root.PiRender = api;
})(typeof window !== "undefined" ? window : globalThis);
