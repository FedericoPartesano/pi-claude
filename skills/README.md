# Skill integrate

Copie di skill di terzi, pensate per l'auto mode (evoluzione di `/goal`, in arrivo). Caricate da `package.json` → `pi.skills`.

- `agent-skills/` — 14 skill di [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (MIT, `LICENSE` incluso) + `references/` condivise (le skill le citano con `../../references/`).
- `ecc/` — `loop-design-check` di [affaan-m/ecc](https://github.com/affaan-m/ecc) (MIT): come definire un goal decidibile e prevenire loop che girano a vuoto, giudici che si auto-approvano, risposte sbagliate portate a termine.
- Tutte con `disable-model-invocation: true`: costo zero nel prompt, richiamabili con `/skill:<nome>`.
- `phases.json` — contratto con l'auto mode: fase → skill da leggere. Modificabile.
- Testo originale in inglese, invariato salvo il flag. Aggiornamento: `node scripts/sync-skills.mjs <clone agent-skills> <clone ecc>`.
- Scartate dopo analisi: `ecc/autonomous-loops` (25 KB, tutta su `claude -p` di Claude Code), `ecc/continuous-agent-loop` (rimanda a skill che non esistono), `terminal-ui` (Ink/Clack: il prototipo non ha dipendenze).
