/** One-line team status ("team 2/4 · t2 tester") from the orchestrator's progress lines, for setStatus("team"). */
export function teamStatus(progress: string[], total: number): string {
	const started = new Set<string>();
	let current = "avvio";
	for (const line of progress) {
		const task = /^▶ (\S+) (\S+)/.exec(line);
		if (task) {
			started.add(task[1]);
			current = `${task[1]} ${task[2]}`;
		} else if (line.startsWith("🔍")) current = "revisione";
		else if (line.startsWith("🔧")) current = "correzione";
	}
	const count = current === "revisione" || current === "correzione" ? total : started.size;
	return `team ${count}/${total} · ${current}`;
}
