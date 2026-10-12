/**
 * Updates: at every startup of Pi (and pi-full) it looks, in the background, whether pi-claude has new commits on its
 * remote or Pi has a newer version. If so, a question appears right away; "Aggiorna ora" runs bin/pi-update.mjs, which
 * adapts to the situation (see there). Nothing is sent to the model and nothing is shown when there is nothing new.
 * PI_UPDATE_CHECK=0 turns it off.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "pi-update.mjs");

export interface UpdateCheck {
	claude?: { branch: string; behind: number; ahead: number; subjects: string[] };
	pi?: { current: string; latest: string; newer: boolean };
}

/** The question's text, or undefined when there is nothing worth asking. */
export function describeUpdates(check: UpdateCheck): string | undefined {
	const lines: string[] = [];
	if (check.claude && check.claude.behind > 0 && check.claude.ahead === 0) {
		lines.push(`pi-claude: ${check.claude.behind === 1 ? "1 novità" : `${check.claude.behind} novità`}`, ...check.claude.subjects.slice(0, 3).map((subject) => `   · ${subject}`));
	}
	if (check.pi?.newer) lines.push(`Pi: ${check.pi.current} → ${check.pi.latest}`);
	return lines.length ? [...lines, "", "Aggiorno adesso? Ci vuole circa un minuto."].join("\n") : undefined;
}

const runScript = (args: string[], version: string, onLine?: (line: string) => void, timeoutMs = 600_000): Promise<{ out: string; ok: boolean }> =>
	new Promise((resolve) => {
		const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, PI_CURRENT_VERSION: version }, stdio: ["ignore", "pipe", "ignore"] });
		let out = "";
		const timer = setTimeout(() => child.kill(), timeoutMs);
		child.stdout.on("data", (chunk) => {
			out += chunk;
			for (const line of String(chunk).split("\n")) if (line.trim()) onLine?.(line);
		});
		child.on("error", () => resolve({ out, ok: false }));
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ out, ok: code === 0 });
		});
	});

export default function (pi: ExtensionAPI) {
	if (process.env.PI_UPDATE_CHECK === "0") return;

	pi.on("session_start", (event, ctx: ExtensionContext) => {
		if (!ctx.hasUI || event.reason !== "startup") return;
		void (async () => {
			try {
				const { VERSION } = await import("@earendil-works/pi-coding-agent");
				const { out, ok } = await runScript(["--check"], VERSION, undefined, 60_000);
				const question = ok ? describeUpdates(JSON.parse(out) as UpdateCheck) : undefined;
				if (!question) return;
				if (!(await ctx.ui.confirm("Aggiornamenti disponibili", question))) return;
				ctx.ui.notify("Aggiorno…", "info");
				const result = await runScript([], VERSION);
				const final = result.out.split("\n").reverse().find((line) => line.startsWith("RISULTATO:"));
				const details = result.out.split("\n").filter((line) => line.trim() && !line.startsWith("RISULTATO:")).join("\n");
				ctx.ui.notify([final?.replace("RISULTATO: ", "") ?? "aggiornamento finito male.", details].filter(Boolean).join("\n"), result.ok ? "info" : "warning");
			} catch {
				// A check must never get in the way: no network, a stale ctx after a reload, a closed UI.
			}
		})();
	});
}
