// The extensions bin/pi-full adds to pi, read from its EXTENSIONS array so the eval runs exactly what the user runs.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function piFullExtensionArgs(repo, agentDir) {
	const script = readFileSync(join(repo, "bin/pi-full"), "utf8");
	const block = /EXTENSIONS=\(([\s\S]*?)\n\)/.exec(script)?.[1] ?? "";
	return [...block.matchAll(/"([^"]+)"/g)]
		.map((match) => match[1].replace("$A", agentDir).replace("$REPO", repo))
		.flatMap((path) => ["-e", path]);
}
