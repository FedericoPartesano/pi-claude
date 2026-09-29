# pi-claude

Pacchetti:

- [`pi-claude-code`](pi-claude-code/) — provider Pi che usa la CLI ufficiale Claude Code (abbonamento) al posto dell'API Anthropic.
- [`pi-team`](pi-team/) — team di sub-agenti specializzati guidati da un orchestratore.

## Installazione

Requisiti: Node ≥ 22.19, git, [Claude Code](https://docs.claude.com/claude-code) loggato con l'abbonamento (`claude` → `/login`).

```bash
git clone git@github.com:FedericoPartesano/pi-claude.git ~/pi-claude
cd ~/pi-claude
git checkout pi-claude-code-v0.1.0   # facoltativo: fissa una release
./install.sh                         # --no-extras: senza pi-full · --no-hooks: senza hook di sicurezza
```

Lo script installa Pi 0.87.1 se manca, il bridge `pi-claude-code`, gli hook `permission-gate` e
`protected-paths`, le estensioni di `pi-full` e il comando `~/.local/bin/pi-full`. Imposta
`claude-code/sonnet` come default solo se non hai già scelto un altro modello. Si può rilanciare:
dopo `git pull` o `git checkout <tag>` basta `./install.sh` di nuovo.

- `pi` — Pi minimale (4 tool base + hook di sicurezza)
- `pi-full` — in più web, todo, domande, subagent e `pi-team`

## Rilasci

Ogni pacchetto ha la sua versione (SemVer) e le sue tag: `pi-claude-code-vX.Y.Z`, `pi-team-vX.Y.Z`.
I rilasci sono gestiti da [release-please](https://github.com/googleapis/release-please):
a ogni push su `main` apre (o aggiorna) una PR di rilascio per ogni pacchetto modificato;
il merge della PR crea tag, GitHub Release e voce nel `CHANGELOG.md` del pacchetto.

I commit seguono [Conventional Commits](https://www.conventionalcommits.org/), con il pacchetto come scope:

```
fix(pi-claude-code): corregge il parsing dei tool JSON
feat(pi-team): aggiunge il ruolo documenter
feat(pi-team)!: cambia lo schema del piano      # breaking
```

Finché la versione è `0.x`: `feat` e breaking alzano il minor, `fix` il patch.
