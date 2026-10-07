#!/usr/bin/env node
// Fake `pi --mode json`: prints its argv to FAKE_PI_ARGS, then FAKE_PI_TURNS assistant messages of
// FAKE_PI_INPUT input tokens each, waiting 50 ms between them (time for the runner to kill it).
import { writeFileSync } from "node:fs";
if (process.env.FAKE_PI_ARGS) writeFileSync(process.env.FAKE_PI_ARGS, JSON.stringify(process.argv.slice(2)));
const turns = Number(process.env.FAKE_PI_TURNS ?? 1);
for (let turn = 1; turn <= turns; turn++) {
	const message = { role: "assistant", content: [{ type: "text", text: `turno ${turn}\n## Risultati\nok` }], usage: { input: Number(process.env.FAKE_PI_INPUT ?? 1000), output: 10, cacheRead: 0, cacheWrite: 0 } };
	console.log(JSON.stringify({ type: "message_end", message }));
	await new Promise((resolve) => setTimeout(resolve, 50));
}
