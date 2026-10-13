import assert from "node:assert/strict";
import { test } from "node:test";
import { todoInsideCodemode } from "./guard/todo.ts";

test("blocca tools.todo dentro codemode, in tutte le forme di scrittura", () => {
	assert.equal(todoInsideCodemode("codemode", { code: 'await tools.todo({action:"list"})' }), true);
	assert.equal(todoInsideCodemode("codemode", { code: 'const u=async(id,s)=>tools.todo({action:"update",id,status:s})' }), true);
	assert.equal(todoInsideCodemode("codemode", { code: 'await tools["todo"]({action:"list"})' }), true);
	assert.equal(todoInsideCodemode("codemode", "tools . todo(x)"), true);
});

test("non tocca il tool todo diretto né altro codice", () => {
	assert.equal(todoInsideCodemode("todo", { action: "list" }), false);
	assert.equal(todoInsideCodemode("codemode", { code: "await tools.bash({command:'ls'})" }), false);
	assert.equal(todoInsideCodemode("codemode", { code: "const todos = []; tools.todolist" }), false);
	assert.equal(todoInsideCodemode("bash", { command: "tools.todo()" }), false);
	assert.equal(todoInsideCodemode("codemode", {}), false);
});
