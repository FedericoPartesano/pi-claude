---
type: entity
title: pi-claude-code
tags: [pacchetto, bridge]
related: [bridge-mcp-lockstep, partesano-2026-notes]
created: 2026-10-20
updated: 2026-10-20
---

# pi-claude-code

Provider Pi (`pi.registerProvider`) che pilota il binario ufficiale `claude` con l'abbonamento, al posto delle API Anthropic. È un'estensione, non un fork, così il progetto segue gli update di Pi ([[partesano-2026-notes]]).

- Processo `claude -p` persistente in stream-json, con partial messages.
- Tool di Pi esposti via MCP (trasporto `sdk` di default, `PI_CLAUDE_MCP_TRANSPORT=http` in alternativa): vedi [[bridge-mcp-lockstep]].
- Resume nativo per fork, tree e compaction; thinking tradotto in `--effort`; footer con l'uso dell'abbonamento; salva utilizzo, reset e storia dei campioni in `~/.pi/agent/claude-code-usage.json` (letti da [[pi-ui]] per la stima di esaurimento).
- Typecheck: `cd pi-claude-code && npx tsc -p .`
