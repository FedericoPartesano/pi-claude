// Copy to clipboard: fenced code blocks of a message and the whole message. Pure helpers plus the OSC 52 sequence.

/** Contents of the fenced code blocks of a markdown text, in order. ```grafico blocks with valid JSON are charts, not code. */
export function codeBlocks(text) {
	const out = [], lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const m = /^```\s*(\S*)/.exec(lines[i]);
		if (!m) continue;
		let j = i + 1;
		while (j < lines.length && !/^```/.test(lines[j])) j++;
		const body = lines.slice(i + 1, j);
		let chart = false;
		if (m[1] === "grafico" && /^```\s*grafico\s*$/.test(lines[i]) && j < lines.length) try { JSON.parse(body.join("\n")); chart = true; } catch {}
		if (!chart && j < lines.length) out.push(body.join("\n"));
		else if (!chart && body.length) out.push(body.join("\n")); // still streaming: copy what is there
		i = j;
	}
	return out;
}

/** OSC 52 "set clipboard" sequence: works over SSH and in Windows Terminal, kitty, WezTerm, iTerm2. */
export const osc52 = (text) => `\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`;

/** System clipboard commands to try, in order (WSL first: clip.exe). */
export const clipCommands = (platform = process.platform) =>
	platform === "win32" ? [["clip", []]] : [["clip.exe", []], ["wl-copy", []], ["xclip", ["-selection", "clipboard"]]];

/** Plain text of one rendered chat row: no colors, no message gutter (▍) or code gutter (│), no padding; code-block borders give undefined. */
export function rowText(row) {
	const t = row.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\s+$/, "");
	if (/^▍ [╭╰]─/.test(t)) return undefined;
	return t.replace(/^▍ ?/, "").replace(/^│ /, "");
}

/** Text of the rows lo..hi (inclusive) of the rendered body, borders dropped. */
export const rowsText = (body, lo, hi) => body.slice(Math.max(0, lo), hi + 1).map(rowText).filter((l) => l !== undefined).join("\n");
