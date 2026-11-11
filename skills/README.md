# Skill integrate

Copie di skill di terzi, pensate per l'auto mode (`/auto`). Caricate da `package.json` → `pi.skills`.

- `agent-skills/` — 24 skill di [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (MIT, `LICENSE` incluso) + `references/` condivise (le skill le citano con `../../references/`).
- `ecc/` — `loop-design-check` di [affaan-m/ecc](https://github.com/affaan-m/ecc) (MIT): come definire un goal decidibile e prevenire loop che girano a vuoto, giudici che si auto-approvano, risposte sbagliate portate a termine.
- Tutte con `disable-model-invocation: true`: costo zero nel prompt, richiamabili con `/skill:<nome>`.
- `phases.json` — contratto con l'auto mode, applicato da `extensions/auto/skills.ts`. Il supervisore sceglie le skill in codice, senza spendere prompt:
  - per tipo di passo (`define`, `docs`, `plan`, `build`, `retry`, `review`, `ship`): `inline` va intera nel system prompt del figlio, `list` come percorso più il «quando usarla» preso dalla descrizione;
  - `retry`: build dopo un check rosso, con `debugging-and-error-recovery` intera;
  - `triggers`: regex sul contesto del passo (goal, requisito, file cambiati, `progetto/design.md` se il design si applica) che rendono consigliata una skill (sicurezza, UI, API, prestazioni, osservabilità, CI, migrazioni, browser, documentazione ufficiale, ADR);
  - al massimo `maxInline` (2) skill intere per passo, le altre segnate «consigliata»;
  - le letture di `SKILL.md` di ogni passo finiscono nello stato e nell'esito dell'intent («Skill: date … · lette …»).
- `using-agent-skills` non è nel contratto: serve a scegliere le skill, e in `/auto` lo fa il codice.
- Testo originale in inglese, invariato salvo il flag. Aggiornamento: `node scripts/sync-skills.mjs <clone agent-skills> <clone ecc>`.
- Scartate dopo analisi: `ecc/autonomous-loops` (25 KB, tutta su `claude -p` di Claude Code), `ecc/continuous-agent-loop` (rimanda a skill che non esistono), `terminal-ui` (Ink/Clack: il prototipo non ha dipendenze).
