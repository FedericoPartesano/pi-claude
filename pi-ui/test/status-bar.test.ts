import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { initialStatus, nextStatus, type TurnStatus } from "../src/status.ts";
import { formatTokens, renderStatusBar } from "../src/status-bar.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const working: TurnStatus = { ...nextStatus(initialStatus(), { type: "agent_start", at: 1000 }), activity: "eseguo i test", step: 4 };
const states: Record<string, TurnStatus> = {
	PRONTO: initialStatus(),
	"AL LAVORO": working,
	"TOCCA A TE": nextStatus(working, { type: "waiting", question: "posso eseguire npm test?", answers: "s sì · n no · a sempre" }),
	FERMO: nextStatus(working, { type: "settled", at: 2000, outcome: "aborted" }),
	FATTO: { ...nextStatus(working, { type: "settled", at: 49_000, outcome: "completed" }), tokensIn: 12_400, tokensOut: 2100 },
};

test("every state has its tag and fills the width exactly", () => {
	for (const [tag, status] of Object.entries(states)) {
		for (const width of [40, 80, 120]) {
			const line = renderStatusBar(status, width, 8000, 0);
			assert.equal(visibleWidth(line), width, `${tag} @${width}`);
			assert.match(strip(line), new RegExp(tag), `${tag} @${width}`);
		}
	}
});

test("working shows activity, step, seconds and how to interrupt", () => {
	const line = strip(renderStatusBar(working, 120, 9000, 0));
	assert.match(line, /eseguo i test · passo 4 · 8s/);
	assert.match(line, /esc interrompi/);
	assert.doesNotMatch(strip(renderStatusBar({ ...working, step: 0, activity: "penso…" }, 120, 1000, 0)), /passo/);
});

test("waiting shows the question and the answers; done shows time and tokens", () => {
	assert.match(strip(renderStatusBar(states["TOCCA A TE"], 120, 0, 0)), /posso eseguire npm test\?.*s sì · n no · a sempre/);
	assert.match(strip(renderStatusBar(states.FATTO, 120, 0, 0)), /48s · ↑12,4k ↓2,1k tok/);
	assert.match(strip(renderStatusBar(states.FERMO, 120, 0, 0)), /interrotto/);
});

test("formatTokens", () => {
	assert.equal(formatTokens(950), "950");
	assert.equal(formatTokens(12_400), "12,4k");
	assert.equal(formatTokens(1_250_000), "1,3M");
});
