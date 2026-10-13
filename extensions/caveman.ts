/**
 * Caveman (adattamento delle regole della skill di JuliusBrussee/caveman, Apache-2.0): risposte brevi in chat, stessa
 * sostanza. Aggiunto al prompt di sistema una volta per sessione (testo fisso: la cache lo tiene). Spento con PI_CAVEMAN=0.
 * Non tocca codice, comandi, commit, file scritti né le domande all'utente.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const MARKER = "Stile delle risposte (caveman)";
/** Regole morbide (prima versione): `PI_CAVEMAN=lite`. Servono anche come termine di confronto nelle prove. */
export const RULES_LITE = `${MARKER}
Rispondi asciutto: la sostanza tecnica resta tutta, cade solo il superfluo. Vale per ogni risposta della sessione.
1. Prima la risposta, poi il motivo, poi il passo successivo. Nessun saluto, nessuna premessa ("Certo!", "Ora faccio…"), nessun riepilogo finale né offerta di aiuto.
2. Frasi corte, una idea per frase, voce attiva. Parole semplici. Niente "in sostanza", "praticamente", "fondamentalmente".
3. Mai tagliare negazioni o limiti (non, mai, solo, tranne). Numeri, unità, percorsi, nomi, comandi ed errori restano esatti, citati alla lettera (solo la riga decisiva dell'errore).
4. Codice mostrato in chat: solo le righe cambiate più 1-2 di contesto, salvo file nuovo o quasi tutto cambiato.
5. Tra una chiamata di tool e l'altra niente testo di routine: una riga prima di un lavoro a più passi, una riga a fine fase, una col risultato.
6. Lingua dell'utente: comprimi lo stile, non la lingua.
7. Scrivi per esteso, con frasi complete, quando riguarda: avvisi di sicurezza, azioni irreversibili, passi dove l'ordine conta, utente confuso o che ripete la domanda, domande o scelte che poni all'utente, e tutto ciò che resta fuori dalla chat (codice, commenti, commit, documenti, issue, memoria).
8. Se la brevità e la chiarezza confliggono, vince la chiarezza. Se un'analisi richiede più parole per essere corretta o completa, usale: non perdere profondità né affidabilità per risparmiare token.`;

/** Regole predefinite: più dure sul testo, uguali sui fatti. */
export const RULES = `${MARKER}
Rispondi con il minimo di parole che porta tutti i fatti. Vale per ogni risposta della sessione, per tutta la sua durata.
1. Prima la risposta, poi il motivo, poi il passo successivo. Mai saluti, premesse, ripetizione della domanda, riepilogo finale, "in breve", offerte di aiuto.
2. Ogni fatto una volta sola. Una frase che non porta un fatto nuovo cade. Non rispiegare ciò che l'utente sa o che hai già detto in questa sessione: rimanda ("vedi sopra").
3. Stile telegrafico: frammenti al posto di frasi complete, niente articoli e connettivi superflui, niente aggettivi di enfasi, niente "praticamente/in sostanza/fondamentalmente". Esempio: "Parser.parse: ciclo sui token, un metodo del Renderer per tipo." invece di tre frasi.
4. Forma: prosa corta o elenco piatto. Niente intestazioni, elenchi annidati, tabelle, grassetti decorativi, emoji, se bastano poche righe. Spiegazione di codice: al massimo ~12 righe, salvo richiesta esplicita di più.
5. Mai tagliare negazioni o limiti (non, mai, solo, tranne). Numeri, unità, percorsi, nomi di funzioni e file, comandi ed errori restano esatti, alla lettera (dell'errore solo la riga decisiva).
6. Codice in chat: solo le righe cambiate più 1-2 di contesto, salvo file nuovo o quasi tutto cambiato.
7. Tra una chiamata di tool e l'altra niente testo di routine: una riga prima di un lavoro a più passi, una riga a fine fase, una col risultato.
8. Lingua dell'utente: comprimi lo stile, non la lingua.
9. Scrivi per esteso, con frasi complete, quando riguarda: avvisi di sicurezza, azioni irreversibili, passi dove l'ordine conta, utente confuso o che ripete la domanda, domande o scelte che poni all'utente, e tutto ciò che resta fuori dalla chat (codice, commenti, commit, documenti, issue, memoria).
10. La completezza si misura in fatti, non in frasi: ogni fatto utile resta, ogni parola che non porta un fatto cade. Se la brevità rende il testo ambiguo, vince la chiarezza.`;

/** Istruzioni per i riassunti di compattazione: il contesto resta piccolo, i fatti restano tutti. */
export const COMPACTION_RULES = `Scrivi il riassunto in stile telegrafico: frammenti, niente articoli né connettivi superflui, nessuna ripetizione, ogni fatto una volta sola. \
Conserva alla lettera percorsi, nomi di funzioni e file, comandi, numeri, errori, decisioni, vincoli e preferenze dell'utente, e ogni negazione o limite. \
Taglia solo ciò che non porta un fatto utile per continuare il lavoro.`;

export type Level = "off" | "lite" | "full";
const LEVELS: Level[] = ["off", "lite", "full"];
const saved = () => join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "caveman-level");

/** Livello all'avvio: PI_CAVEMAN (0, lite, 1/full) se c'è; altrimenti l'ultima scelta fatta con /caveman; altrimenti full. */
export function startLevel(): Level {
	const env = process.env.PI_CAVEMAN;
	if (env !== undefined && env !== "") return env === "0" ? "off" : env === "lite" ? "lite" : "full";
	try {
		const value = readFileSync(saved(), "utf8").trim() as Level;
		if (LEVELS.includes(value)) return value;
	} catch {}
	return "full";
}

/** Il livello si cambia con /caveman lite|full|off (vale subito e resta per le prossime sessioni). PI_CAVEMAN_COMPACT=0 lascia i riassunti di Pi com'erano. */
const COMPACT_TIMEOUT_MS = Number(process.env.PI_CAVEMAN_COMPACT_TIMEOUT_MS) || 120_000;

export default function (pi: ExtensionAPI) {
	let level = startLevel();
	// Il footer di pi-ui mostra questo testo come badge: "lite", "full" o "off".
	const show = (ctx: { hasUI: boolean; ui: { setStatus(key: string, text: string | undefined): void } }) => {
		if (ctx.hasUI) ctx.ui.setStatus("caveman", level);
	};
	pi.on("session_start", (_event, ctx) => show(ctx));
	pi.registerCommand("caveman", {
		description: "Stile delle risposte asciutto: /caveman lite · full · off (senza argomenti mostra il livello)",
		handler: async (args, ctx) => {
			const wanted = args.trim().toLowerCase();
			if (!wanted) return ctx.ui.notify(`Caveman: ${level}. Cambia con /caveman lite, full oppure off.`, "info");
			if (!LEVELS.includes(wanted as Level)) return ctx.ui.notify("Livelli: lite, full, off.", "warning");
			level = wanted as Level;
			try { writeFileSync(saved(), level); } catch {}
			show(ctx);
			ctx.ui.notify(`Caveman: ${level}. Vale dalla prossima risposta.`, "info");
		},
	});
	pi.on("before_agent_start", (event) => {
		// Il livello può cambiare a sessione aperta: via il blocco vecchio (sta in fondo al prompt), dentro quello giusto.
		const at = event.systemPrompt.indexOf(`\n\n${MARKER}`);
		const base = at >= 0 ? event.systemPrompt.slice(0, at) : event.systemPrompt;
		const next = level === "off" ? base : `${base}\n\n${level === "lite" ? RULES_LITE : RULES}`;
		return next === event.systemPrompt ? undefined : { systemPrompt: next };
	});
	if (process.env.PI_CAVEMAN_COMPACT === "0") return;
	// I riassunti di compattazione li scrive un'altra chiamata, con un prompt suo: senza questo le regole di sopra non li toccano.
	// Se qualcosa va storto si lascia fare a Pi (ritorno undefined).
	pi.on("session_before_compact", async (event, ctx) => {
		if (level === "off") return undefined;
		try {
			const model = ctx.model;
			if (!model) return undefined;
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) return undefined;
			const instructions = [event.customInstructions, COMPACTION_RULES].filter(Boolean).join("\n\n");
			const { compact } = await import("@earendil-works/pi-coding-agent");
			// A hung call must not freeze Pi on "Auto-compacting": past the limit our attempt is dropped and Pi compacts as usual.
			const limit = new AbortController();
			const timer = setTimeout(() => limit.abort(), COMPACT_TIMEOUT_MS);
			const stop = () => limit.abort();
			event.signal?.addEventListener("abort", stop, { once: true });
			try {
				const compaction = await compact(event.preparation, model, auth.apiKey, auth.headers, instructions, limit.signal, undefined, undefined, auth.env);
				return limit.signal.aborted ? undefined : { compaction };
			} finally {
				clearTimeout(timer);
				event.signal?.removeEventListener("abort", stop);
			}
		} catch {
			return undefined;
		}
	});
}
