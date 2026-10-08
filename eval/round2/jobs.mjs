// Jobs of a round-2 run and the prompt every harness gets.

/** Task by task: attempt 1 of every harness, then attempt 2…; completed keys are skipped (resume). */
export function jobsFor(tasks, harnesses, repeat, done) {
	const jobs = [];
	for (const task of tasks)
		for (let attempt = 1; attempt <= repeat; attempt++)
			for (const harness of harnesses) {
				const key = `${task.id}|${harness}|${attempt}`;
				if (!done.has(key)) jobs.push({ key, task, harness, attempt });
			}
	return jobs;
}

export const promptFor = (task) =>
	`Nel repository corrente c'è questo problema segnalato da un utente:\n\n# ${task.issue.title}\n\n${task.issue.body}\n\nCorreggilo. Puoi lanciare i test del progetto. Non serve fare commit.`;
