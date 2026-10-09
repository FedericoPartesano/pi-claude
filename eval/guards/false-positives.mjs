// False alarms of the guards on real data: the bash commands of past Claude Code sessions (~/.claude/projects) and the
// text files of the user's projects. node eval/guards/false-positives.mjs <rootBefore> <rootAfter> [projectsDir]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";

const [before, after, projects = join(homedir(), "documents/projects")] = process.argv.slice(2);
const oldPermission = await import(join(before, "pi-ui/src/permission.ts"));
const newPermission = await import(join(after, "pi-ui/src/permission.ts"));
const packages = await import(join(after, "extensions/guard/packages.ts"));
const unicode = await import(join(after, "extensions/guard/unicode.ts"));

function* walk(dir, filter, depth = 0) {
	let entries = [];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (depth < 12 && entry.name !== ".git") yield* walk(path, filter, depth + 1);
		} else if (filter(path)) yield path;
	}
}

// 1. Commands.
const commands = new Set();
for (const file of walk(join(homedir(), ".claude/projects"), (path) => path.endsWith(".jsonl"))) {
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line.includes('"Bash"')) continue;
		try {
			for (const block of JSON.parse(line).message?.content ?? []) if (block.type === "tool_use" && block.name === "Bash" && block.input?.command) commands.add(block.input.command);
		} catch {}
	}
}
const newlyAsked = [...commands].filter((command) => newPermission.dangerReason(command) && !oldPermission.dangerReason(command));
console.log(`comandi bash reali: ${commands.size}`);
console.log(`  conferma chiesta prima: ${[...commands].filter((c) => oldPermission.dangerReason(c)).length} · dopo: ${[...commands].filter((c) => newPermission.dangerReason(c)).length} · nuove: ${newlyAsked.length}`);
for (const command of newlyAsked) console.log(`    + [${newPermission.dangerReason(command)}] ${command.replace(/\s+/g, " ").slice(0, 150)}`);

const installs = [...commands].flatMap((command) => packages.parseInstalls(command).map((install) => ({ command, install })));
const checked = installs.filter(({ install }) => !packages.isPopular(install));
const unique = [...new Map(checked.map(({ install }) => [`${install.ecosystem}:${install.name}`, install])).values()];
console.log(`installazioni nei comandi: ${installs.length} (pacchetti diversi non famosi da controllare: ${unique.length})`);
let blocked = 0;
for (const install of unique) {
	const finding = packages.assessPackage(install, await packages.registryInfo(install));
	if (finding) {
		blocked++;
		console.log(`    ! ${finding}`);
	}
}
console.log(`  fermate dalla guardia: ${blocked}/${unique.length}`);

// 2. Text files.
const TEXT = new Set([".md", ".ts", ".js", ".mjs", ".json", ".txt", ".py", ".yml", ".yaml", ".html", ".css", ".tsx", ".jsx", ".sh", ".toml", ".sql", ".cs", ".java", ".xml"]);
let files = 0;
let bytes = 0;
const flagged = [];
for (const file of walk(projects, (path) => TEXT.has(extname(path)))) {
	let text;
	try {
		if (statSync(file).size > 2_000_000) continue;
		text = readFileSync(file, "utf8");
	} catch {
		continue;
	}
	files++;
	bytes += text.length;
	const scan = unicode.scanHidden(text);
	if (scan.kinds.tag || scan.kinds.bidi) flagged.push(`${file.replace(projects, "")}: ${unicode.describeHidden(scan)}`);
}
console.log(`file di testo nei progetti (node_modules inclusi): ${files} (${Math.round(bytes / 1e6)} MB) · con tag o bidi (avviso o pulizia): ${flagged.length}`);
for (const line of flagged.slice(0, 40)) console.log(`    ~ ${line}`);
