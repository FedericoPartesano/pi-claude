/** Answer touches: `file:riga` references become clickable VS Code links (only where the terminal supports links). */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export function vscodeUrl(path: string, line: number, distro: string | undefined): string {
	return distro ? `vscode://vscode-remote/wsl+${distro}${path}:${line}` : `vscode://file${path}:${line}`;
}

let cachedDistro: string | null | undefined;
/** WSL distribution name: from the environment, or from `wslpath -w /` (\\wsl.localhost\Ubuntu\) inside tmux. */
export function wslDistro(): string | undefined {
	if (cachedDistro !== undefined) return cachedDistro ?? undefined;
	cachedDistro = process.env.WSL_DISTRO_NAME || null;
	if (!cachedDistro) {
		try {
			cachedDistro = /\\\\wsl(?:\.localhost|\$)\\([^\\]+)/.exec(execFileSync("wslpath", ["-w", "/"], { encoding: "utf8", timeout: 2000 }))?.[1] ?? null;
		} catch {
			cachedDistro = null;
		}
	}
	return cachedDistro ?? undefined;
}

const FILE_REF = /(^|[\s(])((?:\.{0,2}\/)?(?:[\w@.-]+\/)*[\w@-][\w@.-]*\.[A-Za-z]\w{0,5})(?::(\d+))?(?=$|[\s),;:!?]|\.(?:\s|$))/g;

/** Links `path` and `path:line` to existing files; leaves code blocks, code spans and existing links alone. */
export function linkFileRefs(markdown: string, cwd: string, toUrl: (absolutePath: string, line: number) => string): string {
	const isFile = (path: string) => {
		try {
			const absolute = isAbsolute(path) ? path : resolve(cwd, path);
			return existsSync(absolute) && statSync(absolute).isFile() ? absolute : undefined;
		} catch {
			return undefined;
		}
	};
	// Split out fenced blocks, code spans and existing links: only plain prose is rewritten.
	return markdown
		.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`|\[[^\]\n]*\]\([^)\n]*\))/)
		.map((part, index) =>
			index % 2 === 1
				? part
				: part.replace(FILE_REF, (whole, before: string, path: string, line: string | undefined) => {
						const absolute = isFile(path);
						if (!absolute) return whole;
						return `${before}[${path}${line ? `:${line}` : ""}](${toUrl(absolute, Number(line ?? 1))})`;
					}),
		)
		.join("");
}
