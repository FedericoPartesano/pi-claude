---
type: concept
title: Bridge MCP in lockstep
tags: [architettura, bridge]
related: [pi-claude-code, partesano-2026-notes]
created: 2026-10-20
updated: 2026-10-20
---

# Bridge MCP in lockstep

Problema: `claude -p` ha il suo agent loop ed esegue i tool; Pi vuole eseguirli lui, con i suoi hook. Soluzione di [[pi-claude-code]] ([[partesano-2026-notes]]):

1. `claude -p` parte con `--tools ""` e un server MCP interno che espone i tool correnti di Pi.
2. `streamSimple` converte gli `stream_event` in eventi Pi; con un `tool_use` emette la toolcall e chiude il messaggio.
3. Claude Code chiama il tool MCP: l'handler resta in attesa senza eseguire.
4. Pi esegue il tool e richiama `streamSimple` col risultato, che sblocca la chiamata MCP pendente.

Se il contesto diverge (`/tree`, `/fork`, compaction, cambio di tool) il bridge riparte con `--resume` + `--fork-session` o ricostruisce il transcript.
