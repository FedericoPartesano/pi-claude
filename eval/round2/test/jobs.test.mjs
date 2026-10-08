import { test } from "node:test";
import assert from "node:assert/strict";
import { jobsFor, promptFor } from "../jobs.mjs";

const tasks = [{ id: "yaml-1", issue: { title: "Anchors", body: "They break." } }, { id: "marked-2", issue: { title: "Links", body: "Wrong." } }];

test("jobs interleave harnesses per task and skip the completed ones", () => {
	const jobs = jobsFor(tasks, ["claude-code", "pi-full"], 2, new Set(["yaml-1|pi-full|1"]));
	assert.deepEqual(jobs.map((job) => job.key), [
		"yaml-1|claude-code|1",
		"yaml-1|claude-code|2", "yaml-1|pi-full|2",
		"marked-2|claude-code|1", "marked-2|pi-full|1",
		"marked-2|claude-code|2", "marked-2|pi-full|2",
	]);
});

test("the prompt carries the issue and the same instructions for everyone", () => {
	const prompt = promptFor(tasks[0]);
	assert.match(prompt, /Anchors/);
	assert.match(prompt, /They break\./);
	assert.match(prompt, /Correggilo\. Puoi lanciare i test del progetto\. Non serve fare commit\./);
});
