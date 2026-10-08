/**
 * File skeletons for the `outline` tool: functions, classes and methods with their line ranges, and the body of one
 * symbol, so the model reads what it needs instead of the whole file. Regular expressions and brace counting (JS/TS,
 * Go, Rust, Java-like) or indentation (Python): no native parser.
 */

export interface CodeSymbol {
	kind: "function" | "class" | "method";
	/** "Class.method" for methods. */
	name: string;
	line: number;
	endLine: number;
}

const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "with", "else", "do", "try", "new", "await", "typeof"]);
const MODIFIERS = String.raw`(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?`;
const FUNCTION = new RegExp(String.raw`^\s*${MODIFIERS}function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]`);
const CLASS = new RegExp(String.raw`^\s*${MODIFIERS}class\s+([A-Za-z_$][\w$]*)`);
const ARROW = new RegExp(String.raw`^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=>)`);
const GO_RUST = /^\s*(?:pub\s+)?(?:async\s+)?(?:fn|func)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*[<(]/;
const METHOD = /^\s+(?:(?:public|private|protected|static|readonly|override|async|get|set)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^;]*$/;

/** Last line (1-based) of the block opened at `start`, by counting braces outside strings and comments. */
function blockEnd(lines: string[], start: number): number {
	let depth = 0;
	let opened = false;
	let quote = "";
	let blockComment = false;
	for (let index = start; index < lines.length; index++) {
		const line = lines[index];
		for (let column = 0; column < line.length; column++) {
			const char = line[column];
			const next = line[column + 1];
			if (blockComment) {
				if (char === "*" && next === "/") {
					blockComment = false;
					column++;
				}
				continue;
			}
			if (quote) {
				if (char === "\\") column++;
				else if (char === quote) quote = "";
				continue;
			}
			if (char === "/" && next === "/") break;
			if (char === "/" && next === "*") {
				blockComment = true;
				column++;
			} else if (char === '"' || char === "'" || char === "`") quote = char;
			else if (char === "{") {
				depth++;
				opened = true;
			} else if (char === "}") {
				depth--;
				if (opened && depth === 0) {
					// Braces closed mid-line on the declaration line (an object type in the signature): the body opens
					// later on the same line.
					if (index === start && line.slice(column + 1).includes("{")) {
						opened = false;
						continue;
					}
					return index + 1;
				}
			}
		}
		// A single-quote/double-quote string never spans lines; a template literal may.
		if (quote !== "`") quote = "";
		// An arrow function or declaration without braces ends on its own line.
		if (!opened && /[;,]\s*$/.test(line)) return index + 1;
	}
	return opened ? lines.length : start + 1;
}

function braceOutline(source: string): CodeSymbol[] {
	const lines = source.split("\n");
	const symbols: CodeSymbol[] = [];
	const classes: { name: string; end: number; indent: number }[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const indent = line.length - line.trimStart().length;
		while (classes.length && index + 1 > classes[classes.length - 1].end) classes.pop();
		const owner = classes[classes.length - 1];
		const klass = CLASS.exec(line);
		if (klass) {
			const end = blockEnd(lines, index);
			symbols.push({ kind: "class", name: klass[1], line: index + 1, endLine: end });
			classes.push({ name: klass[1], end, indent });
			continue;
		}
		const declared = FUNCTION.exec(line) ?? ARROW.exec(line) ?? GO_RUST.exec(line);
		if (declared && (!owner || indent <= owner.indent)) {
			symbols.push({ kind: "function", name: declared[1], line: index + 1, endLine: blockEnd(lines, index) });
			continue;
		}
		const method = owner && indent > owner.indent ? METHOD.exec(line) : null;
		if (method && !KEYWORDS.has(method[1]) && /\{\s*$/.test(line)) {
			const end = blockEnd(lines, index);
			symbols.push({ kind: "method", name: `${owner.name}.${method[1]}`, line: index + 1, endLine: end });
			index = end - 1;
		}
	}
	return symbols;
}

function pythonOutline(source: string): CodeSymbol[] {
	const lines = source.split("\n");
	const indentOf = (line: string) => line.length - line.trimStart().length;
	const endOf = (start: number, indent: number) => {
		let end = start;
		for (let index = start + 1; index < lines.length; index++) {
			if (!lines[index].trim()) continue;
			if (indentOf(lines[index]) <= indent) break;
			end = index;
		}
		return end + 1;
	};
	const symbols: CodeSymbol[] = [];
	const classes: { name: string; indent: number; end: number }[] = [];
	lines.forEach((line, index) => {
		const match = /^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/.exec(line);
		if (!match) return;
		const indent = match[1].length;
		while (classes.length && (index + 1 > classes[classes.length - 1].end || indent <= classes[classes.length - 1].indent)) classes.pop();
		const end = endOf(index, indent);
		const owner = classes[classes.length - 1];
		if (match[2] === "class") {
			symbols.push({ kind: "class", name: match[3], line: index + 1, endLine: end });
			classes.push({ name: match[3], indent, end });
		} else symbols.push(owner ? { kind: "method", name: `${owner.name}.${match[3]}`, line: index + 1, endLine: end } : { kind: "function", name: match[3], line: index + 1, endLine: end });
	});
	return symbols;
}

export const outline = (source: string, path: string): CodeSymbol[] => (/\.py[iw]?$/.test(path) ? pythonOutline(source) : braceOutline(source));

export function formatOutline(symbols: CodeSymbol[], totalLines: number): string {
	const range = (symbol: CodeSymbol) => (symbol.endLine > symbol.line ? `${symbol.line}-${symbol.endLine}` : String(symbol.line)).padEnd(7);
	return [
		`${totalLines} righe`,
		...symbols.map((symbol) => (symbol.kind === "method" ? `    ${range(symbol)}method ${symbol.name.split(".").pop()}` : `  ${range(symbol)}${symbol.kind} ${symbol.name}`)),
	].join("\n");
}

/** The symbol's lines ("N\ttext"), with the comment or decorators right above it; undefined if not found. */
export function symbolBody(source: string, path: string, name: string): string | undefined {
	const symbols = outline(source, path);
	const symbol = symbols.find((entry) => entry.name === name) ?? symbols.find((entry) => entry.name.split(".").pop() === name);
	if (!symbol) return undefined;
	const lines = source.split("\n");
	let start = symbol.line - 1;
	while (start > 0 && /^\s*(\/\*\*|\*|\/\/|@|#)/.test(lines[start - 1]) && lines[start - 1].trim()) start--;
	return lines.slice(start, symbol.endLine).map((line, index) => `${start + index + 1}\t${line}`).join("\n");
}
