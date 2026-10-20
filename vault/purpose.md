# Project Purpose

## Goal

Usare Pi con i modelli Claude tramite l'abbonamento Claude Code, con un costo fisso in token minimo e strumenti (memoria, intent, goal, vault, team) che rendono il lavoro di un agente affidabile e misurabile.

## Key Questions

1. Il bridge verso `claude -p` resta equivalente alle API per affidabilità, con meno token?
2. Quali aiuti (intent, memoria, vault, lean tools) migliorano davvero i risultati, misurati?
3. Quanto costa ogni aiuto in token fissi, e si può portare a zero finché non serve?

## Scope

**In scope:**
- Bridge `pi-claude-code`, interfaccia `pi-ui`, estensioni in `extensions/`, valutazioni in `eval/`.

**Out of scope:**
- Uso delle API Anthropic con OAuth (fatturato come extra usage), spoofing di token o header.

## Thesis

Un harness snello sopra la CLI ufficiale dà risultati pari a Claude Code con molti meno token di input, se ogni aggiunta viene misurata prima di essere tenuta.
