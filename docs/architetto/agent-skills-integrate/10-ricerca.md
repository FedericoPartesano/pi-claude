# Ricerca
Aggiornato: 2026-11-09 · fase 2 · metodo: esperimenti locali su Pi con `PI_CODING_AGENT_DIR` isolato (`/tmp/skt`) e lettura del repo di Addy clonato in `/tmp/ads-src/repo` (commit `--depth 1`, MIT). Niente fonti web esterne.

## Q1 — Come Pi carica le skill di un pacchetto
- `package.json` con `"pi": {"skills": ["./skills"]}` → le skill appaiono come `skill:<nome>` con `origin: package` (esperimento A). Vale per un pacchetto in settings come percorso.
- Una skill con `disable-model-invocation: true` compare comunque come comando `skill:hid`: raggiungibile col comando, nascosta al modello (docs Pi `skills.md`). Il costo zero nel prompt è confermato da una misura precedente del progetto (#r112: prompt skill da 30 a 7 dopo il flag); da rimisurare a implementazione fatta.
- Filtro: il prefisso `-` nel `skills` di primo livello di `settings.json` NON ha tolto la skill del pacchetto (esperimento B). La forma a oggetto `{"source": …, "skills": ["-skills/vis"]}` sì (esperimento C), come dicono le docs (`packages.md`, «Select package resources»).
- Collisione di nome: con un pacchetto che porta `tdd` e `~/.agents/skills/tdd` tua, resta una sola `skill:tdd`, quella tua (`origin: top-level`). La copia del pacchetto sparisce senza avviso (esperimento E). Quindi le 5 doppie di Addy vanno rinominate (`ads-…`), altrimenti non esistono.

## Q2 — Che cosa c'è da copiare e che cosa no
- `skills/` 476 KB (25 cartelle, ognuna con `SKILL.md`; alcune con `references/` e `scripts/` propri), `references/` 80 KB (7 checklist condivise), `commands/` 40 KB (9 file `.toml` per Claude Code), più `agents/` (4), `hooks/` (script bash di Claude Code), `scripts/` (CI del repo), `evals/`, `plugin.json`.
- I `SKILL.md` citano `../../references/…` e `../../../references/…`: il layout upstream va conservato (`skills/<nome>/` accanto a `references/`).
- Nessuna delle 25 ha `disable-model-invocation`: lo aggiunge lo script di sincronizzazione.
- Frontmatter con solo `name` e `description`.

## Q3 — Sicurezza
- grep di `curl`, `wget`, `rm -rf`, `sudo`, `eval`, `chmod`, `| sh` su `skills/`, `references/`, `commands/`: nessun comando pericoloso nei `SKILL.md` (un falso positivo, una riga di tabella con «Ship»). Le occorrenze stanno in `hooks/` e nei test dei hook (curl per cache di documentazione, `rm -rf` su cartelle temporanee).
- Conclusione: si copiano `skills/`, `references/`, `commands/` (solo come fonte per i comandi) e `LICENSE`; `hooks/`, `agents/`, `scripts/`, `evals/` no (Claude Code-specifici, con curl).

## Gate
- Affermazioni portanti: 6, verificate con esperimento o lettura diretta: 6
- Contro-evidenza cercata per: filtro `-` (trovato che non funziona al primo livello); costo zero delle nascoste (non rimisurato)
- Famiglie di fonti: 3 (docs Pi, esperimenti locali, repo Addy)
- unknown dichiarati: costo reale in token dei `SKILL.md` nascosti con questo set (da misurare); comportamento su macOS e Windows; compatibilità del layout `pi.skills` con `pi install git:` (il pacchetto è installato da git sul PC dell'utente: provato solo il percorso locale)
