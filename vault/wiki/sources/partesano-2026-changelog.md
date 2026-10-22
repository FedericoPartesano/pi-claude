---
type: source
title: CHANGELOG.md — release 0.8.0
tags: [fonte, release]
related: [extension-graph, pi-claude-code, pi-memory]
created: 2026-10-22
updated: 2026-10-22
authors: [Federico Partesano]
year: 2026
url: "CHANGELOG.md"
venue: "repository pi-claude"
---

# CHANGELOG.md — 0.8.0 (2026-10-20)

Generato da release-please; entrano solo `feat` e `fix`.

## Novità
- `/advisor on|off`: badge ADVISOR nel footer, advisor nativo di Claude Code per Haiku.
- `/graph`: grafo del progetto, vedi [[extension-graph]].

## Correzioni
- Abort non è più "model error"; ctx stale nel timer di `session_start` e in `goal` ignorato invece di far crashare.
- `stop_reason` refusal/context-window non è più un "error" muto.
- `intent`: l'intent attivo è l'in-progress modificato per ultimo, non l'ultimo per nome file.
- `pi-full`: `--resume` e `--pick` prendono i pacchetti di Pi da quello installato.

## Prestazioni
- Modello di embedding in un processo figlio chiuso a riposo, caricato al primo richiamo ([[pi-memory]]); reaper delle sessioni `claude -p` inattive ([[pi-claude-code]]).

## Versioni precedenti
- 0.7.0 (2026-10-13): blocco MODELLO (OPUS/SONNET/HAIKU) come primo del footer di pi-ui.
