Aggiornato: 2026-11-03 · fase 2

# Ricerca
Quattro domande, risposte con fetch in modalità `answer` su pagine primarie. Provider: DuckDuckGo (Exa in rate limit).

## D1. Cosa sfratta e come richiama MemGPT/Letta?
- Due tier, main context e external context (archival, recall). «Memory edits and retrieval are entirely self-directed» ma lo sfratto della coda è del queue manager (https://arxiv.org/pdf/2310.08560, fetch riuscito). Soglie e frazione sono «e.g.».
- Il repo `letta-ai/letta` all'HEAD `8816d3a` contiene 15 file (solo documenti e workflow): il codice dello sfratto non è leggibile lì. `unknown`.

## D2. Il server di Anthropic fa già tutto questo?
- Sì per i risultati dei tool: `clear_tool_uses_20250919` (https://platform.claude.com/docs/en/build-with-claude/context-editing). «Invalidates cached prompt prefixes when content is cleared» → `clear_at_least` «helps determine if context clearing is worth breaking your prompt cache». Cancella dal più vecchio, il client conserva la storia intera.
- Non utilizzabile con il bridge: `claude -p` non espone `context_management` (`claude --help`).
- Cookbook (https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools): clearing con trigger 30k e keep 4 libera ~163k token per evento; non aiuta con ragionamento e messaggi. Misura su documenti da ~41k token (contesto 96,3% letture di file), non su sessioni di codice.

## D3. Masking o riassunto, che cosa è provato?
- SWE-agent su SWE-bench Verified, 5 configurazioni (https://arxiv.org/abs/2508.21433): il masking dimezza il costo rispetto all'agente grezzo (−50,9%, −52,7%, −56,1%, −57,1%, tranne −9,8% con Qwen3-32B thinking) e il solve rate è pari o migliore del riassunto in 4 su 5 casi. Finestra ottima M = 10 (a M = 20 peggiora).
- Limiti dichiarati dagli autori: un solo scaffold; con OpenHands su 50 istanze il masking fa 30,0% contro 42,0% del riassunto. L'ibrido non è testato.
- Il costo è calcolato a prezzo di input, **senza** la cache che invece domina in Pi (cacheRead 0,1×): il risultato non si trasporta.

## D4. Quanto costa modificare un messaggio vecchio?
- Anthropic: la cache copre ciò che precede la modifica, il resto è ri-fatturato (Induction, https://www.induction.ai/blog/cache-invalidation, fetch riuscito; la riga «rimozione di tool result» non è nella pagina estratta: `unknown`).

## Gate
- URL recuperati davvero: 4 pagine primarie + 2 fetch di conferma. Contro-evidenza cercata: sì (caveat OpenHands, risultato Qwen thinking, assenza di ibrido).
- Famiglie di fonti: ricerca accademica, documentazione del fornitore, misura di terzi, nostra simulazione.
- `unknown`: codice di Letta; costo cache di rimozione tool result; massa di fonti sulla promozione per frequenza (nessuna).
