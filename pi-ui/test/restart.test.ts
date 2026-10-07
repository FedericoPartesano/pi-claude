import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRestartRequest, writeRestartRequest } from "../src/restart.ts";

test("restart request: written by /custom-reload, read once by the launcher", () => {
	const file = join(mkdtempSync(join(tmpdir(), "pi-ui-restart-")), "restart");
	writeRestartRequest(file, { session: "/s/abc.jsonl", cwd: "/home/u/progetto" });
	assert.match(readFileSync(file, "utf8"), /^session=\/s\/abc.jsonl\ncwd=\/home\/u\/progetto\n$/);
	assert.deepEqual(readRestartRequest(file), { session: "/s/abc.jsonl", cwd: "/home/u/progetto" });
	assert.equal(readRestartRequest(join(tmpdir(), "nope-pi-ui")), undefined);
});

test("the shell loop reopens Pi on the same session and folder after /custom-reload", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-ui-loop-"));
	const bin = join(dir, "bin");
	const project = join(dir, "progetto");
	mkdirSync(bin);
	mkdirSync(project);
	const log = join(dir, "calls.log");
	const marker = join(dir, "restart");
	// Fake pi: the first run asks for a restart (like /custom-reload), the second just records how it was started.
	writeFileSync(join(bin, "pi"), `#!/bin/bash\necho "$PWD|$*" >> ${log}\nif [ ! -f ${dir}/done ]; then touch ${dir}/done; printf 'session=/s/abc.jsonl\\ncwd=${project}\\n' > ${marker}; fi\n`);
	chmodSync(join(bin, "pi"), 0o755);
	const script = new URL("../shell/pi-custom-reload.sh", import.meta.url).pathname;
	execFileSync("bash", ["-c", `source ${script}; cd ${dir}; pi --model sonnet`], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PI_UI_RESTART_FILE: marker } });
	const calls = readFileSync(log, "utf8").trim().split("\n");
	assert.deepEqual(calls, [`${dir}|--model sonnet`, `${project}|--session /s/abc.jsonl`]);
});
