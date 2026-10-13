/** Version of this package (pi-claude): package.json plus the git commit when the folder is a checkout. Read once. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached: { own: string; commit?: string } | undefined;

export function ownVersion(): { own: string; commit?: string } {
	if (cached) return cached;
	const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
	let own = "?";
	let commit: string | undefined;
	try {
		own = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "?";
	} catch {
		// not a package folder
	}
	try {
		commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
	} catch {
		// no git: version only
	}
	return (cached = { own, commit });
}
