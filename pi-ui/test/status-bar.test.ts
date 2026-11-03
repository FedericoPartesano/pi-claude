import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { initialStatus, nextStatus, type TurnStatus } from "../src/status.ts";
import { formatTokens, renderStatusBar } from "../src/status-bar.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const working: TurnStatus = { ...nextStatus(initialStatus(), { type: "agent_start", at: 1000 }), activity: "eseguo i test", step: 4, phase: "tool" };
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
	assert.match(line, /eseguo i test · passo 4 da 8s · in tutto 8s/);
	assert.match(line, /esc interrompi/);
	assert.doesNotMatch(strip(renderStatusBar({ ...working, step: 0, activity: "thinking…" }, 120, 1000, 0)), /passo/);
});

test("waiting shows the question and the answers; done shows time and tokens", () => {
	assert.match(strip(renderStatusBar(states["TOCCA A TE"], 120, 0, 0)), /posso eseguire npm test\?.*s sì · n no · a sempre/);
	assert.match(strip(renderStatusBar(states.FATTO, 120, 0, 0)), /48s · ↑12,4k ↓2,1k tok/);
	assert.match(strip(renderStatusBar(states.FERMO, 120, 0, 0)), /interrotto/);
	assert.match(strip(renderStatusBar({ ...states.FATTO, warning: "ultimo passo non riuscito: eseguo i test" }, 120, 0, 0)), /FATTO.*⚠ ultimo passo non riuscito: eseguo i test/);
});

test("done with suggestions tells which keys pick them", () => {
	assert.match(strip(renderStatusBar(nextStatus(states.FATTO, { type: "suggestions", count: 3 }), 120, 0, 0)), /1-3 suggerimenti$/);
	assert.doesNotMatch(strip(renderStatusBar(nextStatus(states.FATTO, { type: "suggestions", count: 0 }), 120, 0, 0)), /suggerimenti/);
});

test("formatTokens", () => {
	assert.equal(formatTokens(950), "950");
	assert.equal(formatTokens(12_400), "12,4k");
	assert.equal(formatTokens(1_250_000), "1,3M");
});

test("a long question never pushes the answer keys out of the bar", () => {
	const question = `posso eseguire ${"rm -rf build ".repeat(8)}? cancella file ricorsivamente o forzatamente`;
	for (const width of [80, 120]) {
		const line = renderStatusBar(nextStatus(working, { type: "waiting", question, answers: "s sì · n no · a sempre per questo comando" }), width, 0, 0);
		assert.equal(visibleWidth(line), width);
		assert.match(strip(line), /s sì · n no · a sempre per questo comando$/);
	}
});

test("a long warning never pushes the suggestion keys out of the bar", () => {
	const status = nextStatus({ ...states.FATTO, warning: "ultimo passo non riuscito: eseguo un comando lunghissimo che non entra" }, { type: "suggestions", count: 3 });
	const line = renderStatusBar(status, 80, 0, 0);
	assert.equal(visibleWidth(line), 80);
	assert.match(strip(line), /1-3 suggerimenti$/);
});

test("while thinking the bar shows a moving wave and the latest thought", () => {
	const thinking = nextStatus(working, { type: "thinking", text: "Controllo i casi limite di paginate." });
	for (const width of [40, 80, 120]) assert.equal(visibleWidth(renderStatusBar(thinking, width, 9000, 3)), width);
	const line = strip(renderStatusBar(thinking, 120, 9000, 3));
	assert.match(line, /AL LAVORO\s+[▁-█]{6} thinking · Controllo i casi limite di paginate\./);
	assert.notEqual(renderStatusBar(thinking, 120, 9000, 3), renderStatusBar(thinking, 120, 9000, 4), "animated");
});

test("the bar follows the token flow: idle is flat and slow, pouring is tall and its spinner turns faster", () => {
	const thinking = nextStatus(working, { type: "thinking", text: "Controllo." });
	const wave = (flow: { level: number; phase: number }) => /AL LAVORO\s+([▁-█]{6})/.exec(strip(renderStatusBar(thinking, 120, 9000, 0, undefined, flow)))![1];
	const spread = (bars: string) => Math.max(...[...bars].map((c) => "▁▂▃▄▅▆▇█".indexOf(c))) - Math.min(...[...bars].map((c) => "▁▂▃▄▅▆▇█".indexOf(c)));
	assert.ok(spread(wave({ level: 0, phase: 2 })) <= 1);
	assert.ok(spread(wave({ level: 1, phase: 2 })) >= 3);
	assert.notEqual(renderStatusBar(thinking, 120, 9000, 0, undefined, { level: 1, phase: 1 }), renderStatusBar(thinking, 120, 9000, 0, undefined, { level: 1, phase: 2 }));
});

import { silenceNote } from "../src/status-bar.ts";

test("silenceNote: nothing while fresh, then 'ultimo segnale da N s', minutes after 60 s", () => {
	const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
	assert.equal(silenceNote(0, 99_000), "");
	assert.equal(silenceNote(95_000, 100_000), "");
	assert.equal(plain(silenceNote(88_000, 100_000)), " · ultimo segnale da 12s");
	assert.match(silenceNote(60_000, 100_000), /38;2;/, "colored");
	assert.equal(plain(silenceNote(0 + 1, 1 + 75_000)), " · ultimo segnale da 1m 15s");
});
