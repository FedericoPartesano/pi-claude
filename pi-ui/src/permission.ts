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
	// From claude-mods' dangerous-cmd-warn: databases, more git, containers, processes, printing secrets.
	[/\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i, "cancella dati in un database"],
	// The table name, plain or quoted ("public"."users", [dbo].[t]), then the end of the statement: no WHERE.
	[/\bDELETE\s+FROM\s+(?:"[^"]+"|\[[^\]]+\]|`[^`]+`|\w+)(?:\.(?:"[^"]+"|\[[^\]]+\]|`[^`]+`|\w+))*\s*(;|"|'|$)/i, "cancella tutte le righe di una tabella (DELETE senza WHERE)"],
	[/\bdb\.(dropDatabase\(\)|\w+\.drop\(\)|\w+\.(deleteMany|remove)\(\s*\{\s*\}\s*\))/, "cancella dati in MongoDB"],
	[/\bgit\s+(checkout\s+--\s+\.(\s|$)|branch\s+-D\b|stash\s+(drop|clear)\b)/, "butta via lavoro git non salvato"],
	[/\bdocker\s+(system\s+prune\b.*\s(-\w*a\w*|--all)\b|volume\s+prune\b)/, "cancella dati di Docker"],
	[/\bkubectl\s+delete\s+(namespace\b|.*\s--all\b)/, "cancella risorse Kubernetes in blocco"],
	[/\bkill\s+-9\s+1\b|\bkillall\s+-9\b/, "termina processi senza farli chiudere"],
	[/(^|[;&|(]\s*)(printenv|env)\s*($|[;&|)])/, "stampa le variabili d'ambiente (possono contenere segreti)"],
	[/(^|[;&|(]\s*)(cat|bat|less|more|head|tail)\s+(\S*\/)?\.env(\.(?!example\b|sample\b|template\b|dist\b|defaults\b)[\w-]+)?(\s|$)/, "mostra un file di segreti (.env)"],
];

/** UPDATE without WHERE (a lookahead-free check, as a regex alone cannot say "no WHERE anywhere after"). */
const updateWithoutWhere = (command: string) => /\bUPDATE\s+[\w."\[\]]+\s+SET\s/i.test(command) && !/\bWHERE\b/i.test(command);

/** Why a command needs confirmation, or undefined when it is ordinary. */
export function dangerReason(command: string): string | undefined {
	if (updateWithoutWhere(command)) return "modifica tutte le righe di una tabella (UPDATE senza WHERE)";
	return DANGEROUS.find(([pattern]) => pattern.test(command))?.[1];
}

/** Key pressed while the status bar asks: s/y yes, n/Esc no, a always (for this exact command, this session). */
export function answerFor(key: string): "yes" | "no" | "always" | undefined {
	if (key === "s" || key === "S" || key === "y" || key === "Y") return "yes";
	if (key === "n" || key === "N" || key === "\x1b") return "no";
	if (key === "a" || key === "A") return "always";
	return undefined;
}
