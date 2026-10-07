/**
 * Natural-language names for tool calls ("Leggo cart.js", "Modifico inventory.js e eseguo i test"), derived from the
 * tool and its arguments only: no model help, no extra tokens.
 */
const base = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

/** Splits a shell command on && || ; | outside quotes; heredoc bodies (after the first line) are ignored. */
export function splitCommand(command: string): string[] {
	const first = command.split("\n")[0];
	const parts: string[] = [];
	let current = "";
	let quote = "";
	for (let index = 0; index < first.length; index++) {
		const char = first[index];
		if (quote) {
			if (char === quote) quote = "";
			current += char;
		} else if (char === "'" || char === '"') {
			quote = char;
			current += char;
		} else if ((char === "&" && first[index + 1] === "&") || (char === "|" && first[index + 1] === "|")) {
			parts.push(current);
			current = "";
			index++;
		} else if (char === ";" || (char === "|" && first[index - 1] !== ">" && first[index - 1] !== "&")) {
			parts.push(current);
			current = "";
		} else {
			current += char;
		}
	}
	parts.push(current);
	return parts.map((part) => part.trim()).filter(Boolean);
}

/** Last file-looking word outside quotes. */
const fileIn = (part: string) => part.replace(/'[^']*'|"[^"]*"/g, " ").match(/[\w./-]+\.\w+/g)?.pop();
const CHECKS = ["test", "build", "lint", "typecheck"];

export function bashPhrase(command: string): string {
	const verbs: string[] = [];
	const add = (verb: string) => {
		if (!verbs.includes(verb)) verbs.push(verb);
	};
	for (const part of splitCommand(command)) {
		const file = fileIn(part);
		const unquoted = part.replace(/'[^']*'|"[^"]*"/g, "");
		if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bnode --test\b|\b(jest|vitest|pytest|mocha)\b|\bgo test\b|\bcargo test\b/.test(part)) add("test");
		else if (/\b(npm|pnpm|yarn|bun)\s+run\s+(build|lint|typecheck)\b|\btsc\b|\beslint\b/.test(part)) add((/(build|lint|typecheck|tsc|eslint)/.exec(part)?.[1] ?? "build").replace("tsc", "typecheck").replace("eslint", "lint"));
		else if (/^git\s+commit\b/.test(part)) add("commit");
		else if (/^git\b/.test(part)) add("git");
		else if (/\b(sed|perl)\s+-\w*i\b/.test(part)) add(`modifico ${base(file ?? "un file")}`);
		else if (/(^|\s)(cat|echo|printf)\b[^>]*>{1,2}\s*\S|\btee\b/.test(unquoted)) add(`scrivo ${base(file ?? "un file")}`);
		else if (/^(cat|head|tail|less|nl|wc|sed -n)\b/.test(part)) {
			// Without a file it is a filter in a pipe ("| tail -20"), not a read.
			if (file) add(`leggo ${base(file)}`);
		} else if (/^(find|ls|tree)\b/.test(part) || (/^(grep|rg)\b/.test(part) && /\s[\w.-]*\/|\s\.\s*$|\s[\w-]+\.\w+/.test(unquoted))) add("cerco");
		else if (/^(npm|pnpm|yarn|bun)\s+(i|install|ci|add)\b/.test(part)) add("installo le dipendenze");
		else if (/^(node|python3?|bash|sh|deno|bun)\s+\S/.test(part)) add(`eseguo ${base(file ?? part.split(/\s+/)[1])}`);
	}
	if (verbs.includes("commit") && verbs.includes("git")) verbs.splice(verbs.indexOf("git"), 1);
	const checks = verbs.filter((verb) => CHECKS.includes(verb));
	const names: Record<string, string> = { git: "controllo git", commit: "faccio il commit", cerco: "cerco nel progetto" };
	const others = verbs.filter((verb) => !CHECKS.includes(verb)).map((verb) => names[verb] ?? verb);
	const phrases = [...others, ...(checks.length ? [`eseguo ${checks.length === 1 && checks[0] === "test" ? "i test" : checks.join(" e ")}`] : [])];
	const text = phrases.length ? phrases.slice(0, 2).join(" e ") : `eseguo ${splitCommand(command)[0]?.split(/\s+/)[0] ?? "un comando"}`;
	return text[0].toUpperCase() + text.slice(1);
}

const FIXED: Record<string, string> = {
	web_search: "Cerco sul web",
	fetch_content: "Leggo una pagina web",
	get_search_content: "Leggo i risultati",
	source_check: "Verifico le fonti",
	team: "Lavoro con il team",
	subagent: "Delego a un sub-agente",
	todo: "Aggiorno i todo",
	goal_done: "Chiudo il goal",
	loop_next: "Programmo il prossimo giro",
	ask_user_question: "Ti faccio una domanda",
	grep: "Cerco nel progetto",
	find: "Cerco file",
	ls: "Elenco i file",
};

/** Phrase for the step row and its argument column. */
export function phrase(tool: string, args: Record<string, unknown> | undefined): { text: string; arg: string } {
	const path = String(args?.path ?? args?.file_path ?? "");
	switch (tool) {
		case "read":
			return { text: path ? `Leggo ${base(path)}` : "Leggo…", arg: path };
		case "edit":
			return { text: path ? `Modifico ${base(path)}` : "Modifico…", arg: path };
		case "write":
			return { text: path ? `Scrivo ${base(path)}` : "Scrivo…", arg: path };
		case "bash": {
			const command = String(args?.command ?? "");
			return { text: command ? bashPhrase(command) : "Eseguo…", arg: command.split("\n")[0] };
		}
		case "load_tools":
			return { text: `Carico ${[...((args?.groups as string[] | undefined) ?? [])].join(", ") || "strumenti"}`, arg: "" };
	}
	const arg = String(args?.query ?? args?.url ?? args?.pattern ?? args?.goal ?? args?.task ?? path ?? "");
	return { text: FIXED[tool] ?? tool.replace(/_+/g, " ").trim(), arg: arg || JSON.stringify(args ?? {}).slice(0, 80) };
}
