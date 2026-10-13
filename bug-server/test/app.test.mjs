import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../app.mjs";

function memoryStorage() {
	const files = [];
	let next = 1;
	return {
		files,
		async save(stream, meta) {
			const chunks = [];
			for await (const chunk of stream) chunks.push(chunk);
			const file = { id: next++, size: Buffer.concat(chunks).length, meta };
			files.push(file);
			return file.id;
		},
		async remove(id) { files.splice(files.findIndex((f) => f.id === id), 1); },
		async usage() { return files.reduce((sum, f) => sum + f.size, 0); },
		async removeOldest(keep) {
			const index = files.findIndex((f) => f.id !== keep);
			if (index < 0) return false;
			files.splice(index, 1);
			return true;
		},
	};
}

async function run(options, steps) {
	const storage = memoryStorage();
	const app = createApp({ storage, token: "t", ...options });
	await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${app.address().port}`;
	try {
		await steps(url, storage);
	} finally {
		app.close();
	}
}
const post = (url, body, headers = {}) => fetch(url, { method: "POST", body, headers: { authorization: "Bearer t", "x-bug-title": encodeURIComponent("Todo è sparita"), "x-bug-severity": "blocca", "x-bug-name": "a b.tar.gz", ...headers } });

test("salva il pacchetto con i dati del modulo", () => run({}, async (url, storage) => {
	const response = await post(url, Buffer.alloc(1000, 1));
	assert.equal(response.status, 201);
	assert.equal(storage.files.length, 1);
	assert.equal(storage.files[0].size, 1000);
	assert.equal(storage.files[0].meta.title, "Todo è sparita");
	assert.equal(storage.files[0].meta.name, "a_b.tar.gz");
	assert.equal((await fetch(`${url}/health`)).status, 200);
}));

test("rifiuta token sbagliato, metodo e percorso sbagliati", () => run({}, async (url, storage) => {
	assert.equal((await post(url, "x", { authorization: "Bearer no" })).status, 401);
	assert.equal((await fetch(url)).status, 404);
	assert.equal((await post(`${url}/altro`, "x")).status, 404);
	assert.equal(storage.files.length, 0);
}));

test("limite di dimensione: dichiarata e reale", () => run({ maxBytes: 100 }, async (url, storage) => {
	assert.equal((await post(url, Buffer.alloc(500))).status, 413);
	assert.equal(storage.files.length, 0);
}));

test("limite di invii all'ora per IP", () => run({ perHour: 2 }, async (url) => {
	assert.equal((await post(url, "a")).status, 201);
	assert.equal((await post(url, "b")).status, 201);
	assert.equal((await post(url, "c")).status, 429);
}));

test("quota: toglie i più vecchi, tiene l'ultimo", () => run({ quotaBytes: 2500 }, async (url, storage) => {
	for (let i = 0; i < 4; i++) assert.equal((await post(url, Buffer.alloc(1000))).status, 201);
	assert.deepEqual(storage.files.map((f) => f.id), [3, 4]);
}));
