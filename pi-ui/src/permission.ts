/**
 * Confirmation before dangerous bash commands (replaces Pi's permission-gate example). In pi-ui's TUI the question is
 * asked in the status bar (TOCCA A TE: s sì · n no · a sempre); elsewhere with a dialog; without UI it blocks.
 */
const DANGEROUS: [RegExp, string][] = [
	[/\brm\s+(-\w*[rf]\w*|--recursive|--force)\b/i, "cancella file ricorsivamente o forzatamente"],
	[/\bsudo\b/, "esegue come amministratore"],
	[/\b(chmod|chown)\b.*\b777\b/, "dà permessi a tutti"],
	[/\bgit\s+push\b.*(\s--force\b|\s-f\b|\s--force-with-lease\b)/, "riscrive la storia remota"],
	[/\bgit\s+(reset\s+--hard|clean\s+-\w*f)/, "butta via modifiche locali"],
	[/\bmkfs(\.\w+)?\b|\bdd\s+if=.*\bof=\/dev\//, "scrive su un disco"],
	[/\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/, "esegue uno script scaricato"],
];

/** Why a command needs confirmation, or undefined when it is ordinary. */
export function dangerReason(command: string): string | undefined {
	return DANGEROUS.find(([pattern]) => pattern.test(command))?.[1];
}

/** Key pressed while the status bar asks: s/y yes, n/Esc no, a always (for this exact command, this session). */
export function answerFor(key: string): "yes" | "no" | "always" | undefined {
	if (key === "s" || key === "S" || key === "y" || key === "Y") return "yes";
	if (key === "n" || key === "N" || key === "\x1b") return "no";
	if (key === "a" || key === "A") return "always";
	return undefined;
}
