import assert from "node:assert/strict";
import { test } from "node:test";
import testMonitor from "./test-monitor.ts";
import { MONITORS, detectMonitor, simpleCommands } from "./test-monitor/monitors.ts";
import { visibleWidth } from "./test-monitor/render.ts";
import { renderView, type ViewState } from "./test-monitor/views.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const names = (command: string) => detectMonitor(command)?.name;

/** Runs a monitor on a text the way the extension does and returns the state. */
function fold(command: string, text: string): ViewState {
	const monitor = detectMonitor(command)!;
	const state = monitor.init(command, 0);
	monitor.update(state, text);
	return state;
}

test("detectMonitor: which command gets which view", () => {
	assert.equal(names("tsc --noEmit -p pi-ui"), "tsc");
	assert.equal(names("npx tsc --noEmit"), "tsc");
	assert.equal(names("cd pi-claude-code && npx tsc -p ."), "tsc");
	assert.equal(names("npm run typecheck"), "tsc");
	assert.equal(names("eslint src --max-warnings 0"), "eslint");
	assert.equal(names("pnpm lint"), "eslint");
	assert.equal(names("npm install"), "install");
	assert.equal(names("npm ci --omit=dev"), "install");
	assert.equal(names("pip install -r requirements.txt"), "install");
	assert.equal(names("git push origin main"), "git");
	assert.equal(names("git -C /tmp/x pull --rebase"), "git");
	assert.equal(names("git add . && git commit -m x && git push"), "git");
	assert.equal(names("docker build -t app ."), "docker-build");
	assert.equal(names("docker buildx build --platform linux/amd64 ."), "docker-build");
	assert.equal(names("docker compose build web"), "docker-build");
	assert.equal(names("docker pull node:22"), "docker-pull");
	assert.equal(names("vite build"), "build");
	assert.equal(names("npm run build 2>&1 | tail -20"), "build");
	assert.equal(names("cargo build --release"), "build");
	// Left alone: quick commands, watchers, scripts, quoted words.
	for (const command of ["git status", "git commit -m 'tsc fixed'", "git log --oneline", "docker ps", "docker run --rm app", "tsc --watch", "ls", "echo npm install", "tsc\nls"]) {
		assert.equal(names(command), undefined, command);
	}
	assert.deepEqual(simpleCommands("FOO=1 npx -y tsc -p . | tail -5 && git push"), ["tsc -p .", "git push"]);
	assert.ok(MONITORS.every((monitor) => monitor.name));
});

// Real output of tsc 5 on two files.
const TSC = `a.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.
a.ts(2,5): error TS2322: Type 'number' is not assignable to type 'string'.
b.ts(1,5): error TS2322: Type 'number' is not assignable to type 'boolean'.
`;

test("tsc: errors become issues; the pretty format works too", () => {
	const state = fold("tsc --noEmit", TSC);
	assert.ok(state.kind === "issues");
	assert.equal(state.errors, 3);
	assert.equal(state.files, 2);
	assert.equal(state.issues[0].rule, "TS2322");
	assert.equal(state.issues[2].file, "b.ts");
	const pretty = fold("tsc --pretty", "\x1b[96msrc/x.ts\x1b[0m:\x1b[93m4\x1b[0m:\x1b[93m9\x1b[0m - \x1b[91merror\x1b[0m\x1b[90m TS2304: \x1b[0mCannot find name 'foo'.\n");
	assert.ok(pretty.kind === "issues" && pretty.issues[0].file === "src/x.ts" && pretty.issues[0].line === 4);
	assert.equal(strip(renderView({ ...state, endedAt: 3000, failed: true }, 100, 3000, 0).join("\n")).includes("TYPECHECK FOUND ISSUES"), true);
});

test("eslint stylish output", () => {
	const text = `
/repo/src/a.ts
  3:10  error    'x' is defined but never used  @typescript-eslint/no-unused-vars
  9:1   warning  Unexpected console statement   no-console

/repo/src/b.ts
  1:5  error  Parsing error: Unexpected token

✖ 3 problems (2 errors, 1 warning)
`;
	const state = fold("eslint .", text);
	assert.ok(state.kind === "issues");
	assert.equal(state.errors, 2);
	assert.equal(state.warnings, 1);
	assert.equal(state.files, 2);
	assert.equal(state.issues[0].rule, "@typescript-eslint/no-unused-vars");
	assert.equal(state.issues[2].message, "Parsing error: Unexpected token");
});

test("install: pnpm progress, npm summary, pip", () => {
	const pnpm = fold("pnpm install", "Progress: resolved 120, reused 100, downloaded 20, added 90\n");
	assert.ok(pnpm.kind === "feed" && pnpm.items === 120 && pnpm.added === 90 && pnpm.phase === "installing");
	const npm = fold("npm install", "npm warn deprecated x@1.0.0: old\n\nadded 312 packages, and removed 4 packages in 9s\n");
	assert.ok(npm.kind === "feed" && npm.added === 312 && npm.removed === 4 && npm.phase === "done");
	const pip = fold("pip install requests", "Collecting requests\n  Downloading requests-2.32.whl\nCollecting urllib3\nInstalling collected packages: urllib3, requests\n");
	assert.ok(pip.kind === "feed" && pip.items === 2 && pip.phase === "installing" && pip.last === "urllib3");
	assert.ok(fold("yarn", "[2/4] Fetching packages...\n").kind === "feed");
});

test("git: stage from the command, last line, errors, and progress when it is there", () => {
	const idle = MONITORS.find((monitor) => monitor.name === "git")!.init("git push origin main", 0);
	assert.ok(idle.kind === "bar" && idle.stage === "push");
	const state = fold("git push origin main", "To /tmp/mon/bare\n   b32232d..d34d9e1  HEAD -> master\n");
	assert.ok(state.kind === "bar" && state.current === "   b32232d..d34d9e1  HEAD -> master".trim() && state.errors === 0);
	const failed = fold("git push", "To github.com:a/b.git\n ! [rejected]  main -> main (fetch first)\nerror: failed to push some refs to 'github.com:a/b.git'\n");
	assert.ok(failed.kind === "bar" && failed.errors === 1);
	const progress = fold("git clone x", "Cloning into 'x'...\nReceiving objects:  45% (45/100)\rReceiving objects:  60% (60/100)\r");
	assert.ok(progress.kind === "bar" && progress.done === 60 && progress.total === 100 && progress.stage === "receiving objects");
});

// Real output of `docker build` (BuildKit, plain) on a three-COPY Dockerfile, trimmed.
const BUILD = `#0 building with "default" instance using docker driver

#1 [internal] load build definition from Dockerfile
#1 transferring dockerfile: 80B 0.0s done
#1 DONE 0.1s

#2 [internal] load .dockerignore
#2 DONE 0.1s

#3 [internal] load build context
#3 DONE 0.0s

#4 [1/3] COPY a /a
#4 DONE 0.0s

#5 [2/3] COPY a /b
`;

test("docker build: steps done over steps seen, the running step, errors", () => {
	const state = fold("docker build .", BUILD);
	assert.ok(state.kind === "bar");
	assert.equal(state.done, 4);
	assert.equal(state.total, 5);
	assert.equal(state.stage, "[2/3]");
	assert.equal(state.current, "COPY a /b");
	const done = fold("docker build .", `${BUILD}#5 DONE 0.1s\n\n#6 exporting to image\n#6 DONE 0.4s\n`);
	assert.ok(done.kind === "bar" && done.done === 6 && done.total === 6);
	const failed = fold("docker build .", `${BUILD}#6 [3/3] RUN npm ci\n#6 ERROR: process "/bin/sh -c npm ci" did not complete successfully: exit code: 1\nERROR: failed to solve: process did not complete\n`);
	assert.ok(failed.kind === "bar" && failed.errors === 2);
	const classic = fold("docker build .", "Step 1/4 : FROM node\n---> abc\nStep 2/4 : RUN npm ci\n");
	assert.ok(classic.kind === "bar" && classic.done === 1 && classic.total === 4 && classic.stage === "[2/4]");
});

test("docker pull: layers complete over layers seen", () => {
	const state = fold("docker pull node:22", "22: Pulling from library/node\n8a1b2c3d4e5f: Pulling fs layer\n9b2c3d4e5f6a: Pulling fs layer\n8a1b2c3d4e5f: Downloading  12MB/50MB\n9b2c3d4e5f6a: Pull complete\n8a1b2c3d4e5f: Extracting  1MB/50MB\n");
	assert.ok(state.kind === "bar" && state.total === 2 && state.done === 1 && state.stage === "extracting");
});

test("build: percent when printed, modules, errors and warnings, last line", () => {
	const state = fold("vite build", "vite v5 building for production...\n✓ 34 modules transformed.\nwarn: big chunk\nerror during build:\n");
	assert.ok(state.kind === "bar" && state.done === 34 && state.warnings === 1 && state.errors === 1);
	assert.equal(state.current, "error during build:");
	const webpack = fold("webpack build", " 45% building 12/40 modules\n 60% sealing\n");
	assert.ok(webpack.kind === "bar" && webpack.done === 60 && webpack.total === 100);
});

test("every monitor renders its state at several widths without overflowing", () => {
	const samples: [string, string][] = [["tsc", TSC], ["eslint .", "/a.ts\n  1:1  error  x  y\n"], ["npm install", "added 3 packages\n"], ["git pull", "Already up to date.\n"], ["docker build .", BUILD], ["docker pull x", "a1b2c3: Pull complete\n"], ["npm run build", "building\n"]];
	for (const [command, text] of samples) {
		const state = fold(command, text);
		for (const width of [24, 60, 140]) for (const end of [undefined, 5000]) {
			const rows = renderView({ ...state, endedAt: end, failed: end ? true : undefined } as ViewState, width, 6000, 2);
			assert.equal(rows.length, 3, command);
			for (const row of rows) assert.equal(visibleWidth(row), width, `${command} @${width}`);
		}
	}
});

test("extension: tsc gets a live view from the partial output, a verdict from the exit status, and is never rewritten", async () => {
	const handlers = new Map<string, (event: any, ctx: any) => any>();
	let widget: any;
	testMonitor({ on: (name: string, handler: any) => handlers.set(name, handler) } as any);
	const ctx = { hasUI: true, cwd: process.cwd(), ui: { theme: { name: "x" }, setWidget: (_k: string, factory: any) => (widget = factory({ requestRender() {} })) } };
	handlers.get("session_start")!({}, ctx);
	const input = { command: "npx tsc --noEmit -p pi-ui 2>&1 | tail -5" };
	handlers.get("tool_call")!({ toolName: "bash", toolCallId: "ts1", input }, ctx);
	assert.equal(input.command, "npx tsc --noEmit -p pi-ui 2>&1 | tail -5");
	assert.match(widget.render(100).map(strip).join("\n"), /TYPECHECK RUNNING/);
	handlers.get("tool_execution_update")!({ toolCallId: "ts1", partialResult: { content: [{ type: "text", text: TSC }] } }, ctx);
	assert.match(widget.render(100).map(strip).join("\n"), /3 errors/);
	handlers.get("tool_execution_end")!({ toolCallId: "ts1", isError: true, result: { content: [{ type: "text", text: TSC }] } }, ctx);
	const rows = widget.render(100).map(strip).join("\n");
	assert.match(rows, /TYPECHECK FOUND ISSUES/);
	assert.match(rows, /b\.ts:1/);
	// A test run after it takes the panel over; a plain command leaves things alone.
	const test = { command: "node --test a.test.ts" };
	handlers.get("tool_call")!({ toolName: "bash", toolCallId: "n1", input: test }, ctx);
	assert.match(widget.render(100).map(strip).join("\n"), /TESTS RUNNING/);
	handlers.get("session_shutdown")!({}, ctx);
});
