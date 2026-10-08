#!/usr/bin/env node
// Does Claude Code write its auto-memory when driven headless (-p, stream-json), as the eval drives it?
// Session 1 teaches a rule and asks to remember it; session 2 (new process, same directory) asks for it.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeHarness } from "../harness.mjs";
import { overageActive } from "./quota.mjs";

const dir = join(homedir(), ".cache/pi-eval/work2/probe-cc-memory");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
execSync("git init -q && echo '# probe' > README.md && git add . && git commit -qm init", { cwd: dir });
if (overageActive()) throw new Error("extra usage attivo: stop");

const first = new ClaudeCodeHarness(dir, "opus", { effort: "high" });
await first.runTurn("Regola di questo progetto: i messaggi di errore vanno sempre scritti in italiano. Ricordatelo per le prossime sessioni.");
first.close();
const second = new ClaudeCodeHarness(dir, "opus", { effort: "high" });
const turn = await second.runTurn("In che lingua vanno scritti i messaggi di errore in questo progetto? Rispondi con una parola.");
second.close();

const slug = dir.replace(/[^a-zA-Z0-9]/g, "-");
const memoryDir = join(homedir(), ".claude/projects", slug, "memory");
const files = existsSync(memoryDir) ? readdirSync(memoryDir) : [];
console.log(JSON.stringify({ answer: turn.answer, memoryDir, files, remembered: /italian/i.test(turn.answer) }, null, 2));
