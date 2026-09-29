# pi-claude

Pacchetti:

- [`pi-claude-code`](pi-claude-code/) — provider Pi che usa la CLI ufficiale Claude Code (abbonamento) al posto dell'API Anthropic.
- [`pi-team`](pi-team/) — team di sub-agenti specializzati guidati da un orchestratore.

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
