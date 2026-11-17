#!/usr/bin/env node
// Paperclip `process` adapter command: one heartbeat of /auto. Config in Paperclip:
//   { "adapterType": "process", "adapterConfig": { "command": "node", "args": ["/path/to/pi-claude/bin/pi-auto-paperclip.mjs"], "cwd": "/path/to/repo", "timeoutSec": 0 } }
// Exit 0 = the heartbeat ran (work done, inbox empty or task taken by another agent); 1 = error.
import { heartbeat, readEnv } from "../extensions/auto/paperclip.ts";
import { runHeadless } from "../extensions/auto/headless.ts";

const env = readEnv();
if (typeof env === "string") {
	console.error(`pi-auto-paperclip: ${env}`);
	process.exit(1);
}
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => controller.abort());
const result = await heartbeat(env, {
	fetch,
	signal: controller.signal,
	log: (line) => console.error(`pi-auto-paperclip: ${line}`),
	work: async (goal, slug, signal) => {
		const state = await runHeadless({ cwd: process.cwd(), goal, slug, signal, onLine: (line) => console.error(`auto: ${line}`) });
		return { reason: state.stop?.reason ?? "?", detail: state.stop?.detail ?? "", branch: state.branch, worktree: state.worktree, steps: state.steps, tokens: state.tokens };
	},
});
console.log(JSON.stringify(result));
process.exit(result.outcome === "errore" ? 1 : 0);
