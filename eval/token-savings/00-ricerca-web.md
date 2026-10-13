# Ricerca web: architetture per risparmiare token

- JetBrains Research (dic 2025) / arXiv 2508.21433 "Observation masking": nascondere i vecchi risultati dei tool
  dimezza il costo, risolve quanto o più del riassunto con LLM (finestra migliore: ultimi 10 turni; Qwen3-Coder 480B
  +2,6% di successi, -52% costo). Ibrido: altro -7%/-11%. https://blog.jetbrains.com/research/2025/12/efficient-context-management/
- Anthropic context editing (`clear_tool_uses_20250919`, soglia ~100k, tieni 3): -84% token nel test web search da 100 turni;
  ma ogni pulizia invalida la cache, serve `clear_at_least` (es. 20k) perché convenga.
- arXiv 2601.06007 "Don't Break the Cache": la cache dei prompt taglia il costo agenti del 41-80%; conviene non modificare il prefisso.
- Anthropic tool search / programmatic tool calling: definizioni dei tool caricate solo se servono (-85%), risultati intermedi
  filtrati da codice prima di entrare nel contesto. https://www.anthropic.com/engineering/advanced-tool-use
- Routing per sottocompito (LiteLLM: -46% a pari qualità su SWE-bench; Open SWE: -64% mediana): modello piccolo per leggere/cercare,
  grande per modificare.
- Da verificare: indice/grafo del codice (embedding, grafo di simboli) per sostituire ricerche a tentativi.
