// The extensions bin/pi-full adds to pi, read from its EXTENSIONS array so the eval runs exactly what the user runs.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** `exclude`: substrings of extension paths to leave out (round 2 drops pi-web-access: no web for either harness). */
export function piFullExtensionArgs(repo, agentDir, { exclude = [] } = {}) {
	const script = readFileSync(join(repo, "bin/pi-full"), "utf8");
	const block = /EXTENSIONS=\(([\s\S]*?)\n\)/.exec(script)?.[1] ?? "";
	return [...block.matchAll(/"([^"]+)"/g)]
		.map((match) => match[1].replace("$A", agentDir).replace("$REPO", repo))
		.filter((path) => !exclude.some((part) => path.includes(part)))
		.flatMap((path) => ["-e", path]);
}
