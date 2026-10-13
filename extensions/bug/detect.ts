/** Does a chat message describe a problem of Pi / pi-claude themselves (not of the user's code or another program)? Local rules first, a model only when unsure. */

export type Verdict = "yes" | "maybe" | "no";

/** Things that name Pi itself. */
const PI_NAME = /\b(this extension ctx|ctx is stale|pi-claude|pi-full|pi-ui|pi-memory|pi coding agent|pi\b(?=[^.?!\n]{0,80}\b(si|non|ha|d[àa]|mi|crash|bug|errore|blocc|chius|freez|lento|problema|rotto|funzion)))|\bla modal\b|\bil footer\b|\bil pannello\b|\bla barra\b|\bil prompt (?:di pi|bar)\b|\balt\+[a-z]\b|\/(?:goal|loop|memory|dream|intent|bugreport|resume)\b/i;

/** A complaint: something is wrong. */
const COMPLAINT = /\b(bug|crash|errore|non funziona|non parte|si blocca|bloccat|si chiude|chiuso da solo|si congela|freez|lent(?:o|a|issim)|rott[oa]|spar(?:it|isc)|duplicat|stran|problema|exception|stale|EPIPE|undefined|non risponde|non si apre|si impalla|exit)\w*/i;

/** Clearly about something else: the user's own project code, tools, services. */
const OTHER = /\b(il mio (?:codice|programma|server|sito|test|script)|la mia app|nel mio progetto|docker|nginx|mongodb|npm install|webpack|react|django|compilatore|database)\b/i;

export function looksLikePiBug(text: string): Verdict {
	const t = text.slice(0, 2000);
	if (!COMPLAINT.test(t)) return "no";
	if (PI_NAME.test(t)) return OTHER.test(t) ? "maybe" : "yes";
	return OTHER.test(t) ? "no" : /\b(pi|estensione|modal|footer|pannello|sessione|memoria|chat|terminale)\b/i.test(t) ? "maybe" : "no";
}

export const DETECT_SYSTEM = "Decidi se il messaggio di un utente descrive un problema di Pi (il coding agent in uso) o della sua estensione pi-claude (interfaccia, memoria, goal, intent, loop, modal, footer, voce, crash). Non è un bug di Pi se riguarda il codice dell'utente, un altro programma o un servizio. Rispondi solo con una parola: SI oppure NO.";

export const parseDetect = (answer: string): boolean => /^\s*s[iì](?![\p{L}])/iu.test(answer);
