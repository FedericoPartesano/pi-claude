import { test } from "node:test";
import assert from "node:assert/strict";
import { RecallIndex, recall } from "../src/recall.ts";
import type { MemoryRecord } from "../src/store.ts";

const rec = (id: string, text: string): MemoryRecord => ({ id, type: "fatto", text, pinned: false, confirmations: 2, created: "2026-10-01", last: "2026-10-06", status: "active", entities: [] });
const filler = Array.from({ length: 400 }, (_, i) => rec(`f${i}`, `${["ordini", "clienti", "listini", "resi"][i % 4]}Service${i} ${i % 25 === 0 ? "scrive" : "legge"} i dati su S3`));

test("one common word in common is not evidence ('scrivi una poesia' recalled memories that 'scrive')", () => {
	const index = new RecallIndex([...filler, rec("x", "Le esportazioni Excel usano exceljs in streaming")]);
	assert.deepEqual(recall(index, "scrivi una poesia sul mare d'inverno", { today: "2026-10-08" }).hits, []);
});

test("one rare word is still enough (a library, a file name)", () => {
	const index = new RecallIndex([...filler, rec("x", "Le esportazioni Excel usano exceljs in streaming")]);
	assert.deepEqual(recall(index, "aggiorna exceljs", { today: "2026-10-08" }).hits.map((hit) => hit.record.id), ["x"]);
});
