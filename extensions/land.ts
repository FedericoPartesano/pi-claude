/**
 * /land: integrate the current branch into main when its checks pass (see land/land.ts). For parallel sessions in
 * git worktrees; sessions landing at the same time queue. Only a command: no tool, no prompt text.
 *
 *   /land                          checks from package.json (npm test), onto main
 *   /land --check "npm test" --check "npx tsc -p ." --onto develop
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defaultChecks, land } from "./land/land.ts";

export function parseLandArgs(args: string): { checks: string[]; onto?: string } | { error: string } {
	const tokens = [...args.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]);
	const checks: string[] = [];
	let onto: string | undefined;
	for (let index = 0; index < tokens.length; index++) {
		const flag = tokens[index];
		const value = tokens[index + 1];
		if ((flag === "--check" || flag === "--onto") && value) {
			if (flag === "--check") checks.push(value);
			else onto = value;
			index++;
		} else return { error: `Argomento non capito: ${flag}. Uso: /land [--check "cmd"]… [--onto main]` };
	}
	return { checks, onto };
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("land", {
		description: "Integra il branch corrente in main se i controlli passano (rebase, test, fast-forward; in coda con le altre sessioni)",
		handler: async (args, ctx) => {
			const tell = (text: string, level: "info" | "warning" | "error" = "info") => (ctx.hasUI ? ctx.ui.notify(text, level) : console.error(text));
			const parsed = parseLandArgs(args);
			if ("error" in parsed) return tell(parsed.error, "warning");
			if (!ctx.isIdle()) return tell("Pi sta lavorando: /land a fine turno (il rebase cambia i file).", "warning");
			const onto = parsed.onto ?? "main";
			const checks = parsed.checks.length ? parsed.checks : defaultChecks(ctx.cwd);
			const status = (line?: string) => ctx.hasUI && ctx.ui.setStatus("land", line && `land ${line}`);
			status(`▶ ${onto}${checks.length ? ` · ${checks.join(", ")}` : " · nessun controllo"}`);
			try {
				const result = await land({ cwd: ctx.cwd, onto, checks, onProgress: (line) => status(line) });
				tell(result.message, result.ok ? "info" : "warning");
			} finally {
				status(undefined);
			}
		},
	});
}
