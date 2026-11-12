# Forma della vista (fase 3)
Aggiornato: 2026-11-12 · riprende la voce «Forma della vista: k9s, lazygit, btop» di `90-ignoto.md`

## Cosa dicono i riferimenti (letti 2026-11-12)
- **k9s** (`internal/view/app.go`): colonna fissa — indicatore di stato (1 riga), contenuto, breadcrumb, flash. `esc` risale alla vista precedente; `?` mostra i tasti. Lezione: una sola area di contenuto, il contesto in righe sottili, `esc` sempre uguale.
- **lazygit** (`VISION.md`): principi Discoverability, Simplicity, Safety, Speed. Pannelli laterali con schede; il pannello in focus si allarga. Lezione: pochi pannelli fissi, il dettaglio nel pannello in focus, il tasto giusto sempre scritto.
- **btop** (README, both.org): sei regioni, ognuna accesa/spenta con un tasto numerico `1…5`. Lezione: tasti numerici per scegliere cosa vedere, niente menu.

## Problema della forma attuale (`cockpit.mjs`, 2026-11-12)
Tutto sullo stesso schermo: FASI, REQUISITI, PENSIERO, STUDIO E PRASSI, PASSO. A 100×30 il pensiero ha 3–4 righe, i requisiti si scorrono, il passo è tagliato: troppe cose piccole, nessuna leggibile a fondo. Il pensiero live (la richiesta principale) è la sezione più stretta.

## Alternative
**A — Pannelli fissi (stato attuale).** Tutto visibile, niente da premere. Pensiero ≤6 righe; su 80 colonne si impila e il tutto scorre.
**B — Panoramica + schede a tutto schermo (lazygit/btop).** Testata fissa (fase, passo, salute, «fermo da Ns») e riga tasti fissa. Corpo = una scheda scelta con `1…5`:
1. **Panoramica** (default): salute col motivo, barra requisiti, FASI in una riga (`✓def ✓pia ▸cos ○ver ○riv ○con`), ultima riga di pensiero, ultimi 3 tool, «prossimo tasto». Basta a rispondere in ≤5 s.
2. **Pensiero**: schermo intero, testo in diretta del figlio, con scorrimento.
3. **Studio e prassi**: tutto ciò che ha letto (file, fonti), skill seguite, azioni, raggruppate per tipo.
4. **Piano**: FASI per esteso e REQUISITI per intero con esito dell'ultimo check.
5. **Passi**: elenco dei passi con esito e durata; `⏎` apre il dettaglio (tool, check, testo finale); `esc` torna.
**C — Flusso unico a blocchi (k9s drill-down).** Una colonna cronologica: ogni passo è un blocco chiuso di 2 righe (fase, esito, ultimo pensiero); `⏎` lo espande. Un solo asse di lettura, ma fasi e studio non hanno un posto proprio.

## Confronto sugli scenari del brief
| Scenario | A | B | C |
|---|---|---|---|
| Leggibilità ≤5 s a 100×30 | media: tutto piccolo | alta: la Panoramica è pensata per questo | media |
| Profondità ≤2 tasti | sì ma stretta | sì: `1…5` + `⏎` | sì |
| Pensiero, fasi, prassi «comodi e ordinati» (richiesta utente) | no: sezioni da 3–6 righe | sì: ognuno una scheda intera | parziale |
| Leggerezza (CPU) | invariata | invariata: si disegna solo la scheda aperta | invariata |
| Costo di modifica | zero | medio: stesse funzioni di riga, nuovo dispatcher per scheda | alto: nuovo modello |

## Raccomandazione
**B.** Riusa le funzioni già scritte (`phaseLines`, `thoughtLines`, `practiceLines`, `stepLines`, `reqLines`) dando a ciascuna uno schermo intero, e mantiene la Panoramica come vista che risponde a «sta procedendo? perché?». Tasti: `1…5` scheda, `←→` passo (come ora), `Tab` scheda successiva, `esc` torna alla Panoramica poi chiude. `p`, `:`, `s`, `c` restano ovunque.

**Falsificatore:** nelle prime 3 corse vere l'utente resta sempre sulla Panoramica e apre ancora lo stato JSON o il diario, oppure passa da una scheda all'altra più di 2 volte per capire una situazione; in quel caso si torna ad A con più righe per il pensiero.

## Non fatto
Critico indipendente fatto: vedi `30-critico-1.md` (verdetto: modifica B, aggiungere D = A + zoom). Il formato delle schede 3 e 4 non è provato su dati reali (solo diario demo).

## Esito dopo i critici (2026-11-12)
Scelta: **B modificata**, implementata in `prototype/rpc-chat/cockpit.mjs`.
- 4 schede, tasti `1…4` (niente `Tab`, niente scheda Piano: FASI e REQUISITI stanno in Panoramica): Panoramica, Pensiero, Studio e prassi, Passi.
- Motivo della salute su riga propria; testata solo passo/fase/parola.
- Chat a scomparsa (`c` apre, `esc` chiude), righe contate nel budget; `1-4` disattivati in modalità chat/nota.
- Pensiero: storico completo per passo, ↑ risale; scorrimento limitato al contenuto.
- Studio e prassi: tutta la corsa, senza doppioni, con conteggi (`×3`), `•` = passo guardato.
- Alternativa D (A + zoom sul pannello) non confrontata: B con schede fa già da zoom.
- Falsificatore misurabile: alla chiusura il cockpit aggiunge una riga a `<repo>-auto/<slug>.cockpit-stats.jsonl` (`createStats`): `switches`, `over2`, `ms` per scheda, `keys`, `firstKeyMs`, `chat`, `note`. Regola scritta prima della prima corsa: nelle prime 3 corse vere, **B cade** (si torna ad A con più righe al pensiero) se almeno 2 delle 3 corse hanno aperture con `over2: true` in più della metà delle aperture, oppure se l'utente apre ancora il JSON/diario a mano. Il tempo «≤5 s» resta una prova a cronometro dell'utente, non un contatore. Diff del commit: fuori lotto.
- Critico 2 (opus, `claude -p`): difetti 1-7 e 9 corretti; non committato.
