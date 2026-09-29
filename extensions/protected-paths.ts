/**
 * Protected Paths (bash-aware)
 *
 * Blocks write/edit on protected paths, like Pi's example extension, and also bash commands that
 * would modify them (sed -i, redirections, tee, cp/mv/rm, truncate, ...). Reads stay allowed.
 *
 * Heuristic, not a security boundary: a determined command can still get around it (scripts,
 * variables, other interpreters). Use a container for real isolation.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROTECTED_PATHS = [".env", ".git/", "node_modules/"];

// Commands or operators that write to the files they name.
const WRITING_COMMANDS = [
	/\bsed\b[^|;&]*\s-[a-zA-Z]*i/, // sed -i / sed -Ei
	/\bperl\b[^|;&]*\s-[a-zA-Z]*i/,
	/\b(tee|truncate|cp|mv|rm|rmdir|dd|install|ln|chmod|chown)\b/,
	/>{1,2}/, // shell redirection
	/\bpython3?\b.*\bopen\s*\(/,
	/\bnode\b.*\bwriteFile/,
];

export function mentionsProtectedPath(text: string): string | undefined {
	return PROTECTED_PATHS.find((protectedPath) => {
		// ".env" must match the file (".env", "./.env", "dir/.env.local"), not e.g. "process.env".
		if (protectedPath === ".env") return /(^|[\s'"=/])\.env(\.[\w.-]+)?(?=$|[\s'";|&)])/.test(text);
		return text.includes(protectedPath);
	});
}

/** Returns the protected path a bash command would modify, if any. */
export function protectedPathModifiedBy(command: string): string | undefined {
	const hit = mentionsProtectedPath(command);
	// Stream duplications like 2>&1 are not writes to a file.
	const withoutDuplications = command.replace(/\d*>&\d+/g, "");
	return hit && WRITING_COMMANDS.some((pattern) => pattern.test(withoutDuplications)) ? hit : undefined;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		let reason: string | undefined;
		if (event.toolName === "write" || event.toolName === "edit") {
			const path = String((event.input as { path?: string }).path ?? "");
			const hit = mentionsProtectedPath(path);
			if (hit) reason = `Path "${path}" is protected (${hit})`;
		} else if (event.toolName === "bash") {
			const command = String((event.input as { command?: string }).command ?? "");
			const hit = protectedPathModifiedBy(command);
			if (hit) {
				reason = `Command would modify a protected path (${hit}): ${command.slice(0, 120)}`;
			}
		}
		if (!reason) return undefined;
		if (ctx.hasUI) ctx.ui.notify(`Blocked: ${reason}`, "warning");
		return { block: true, reason };
	});
}
