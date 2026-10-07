# intent.md — best practice dal playbook Anthropic

Fonti (lette il 2026-10-06):
- [The AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook) — Stage 1: Plan
- [Claude Academy — Capture as intent.md](https://academy.claude.com/courses/ai-native-sdlc-playbook/capture-intent)

## Cosa dice il playbook

- **Cos'è**: "a short version-controlled file stating what is wanted, why, and under which constraints".
  Scritto una volta, con le parole di chi ha l'idea (*originator*), anche non tecnico.
- **Template** dell'esempio ufficiale:
  ```
  # Intent: <titolo>
  Author: <nome (ruolo)>. Status: <draft/approved>.
  ## Problem
  ## Proposed outcome
  ## Affected users and systems
  ## Constraints
  ## Open questions
  ```
- **Intervista**: Claude fa le domande di un analista — "scope, users, constraints, and what success looks like" —
  e l'originator racconta cosa oggi non può fare, chi è coinvolto, com'è il "meglio", cosa è fuori scope.
  Si itera "until the idea is concrete", poi Claude formatta col template e l'originator corregge.
- **Cosa non ci va**: soluzioni, scelte di design e tecniche (vanno nello spec/plan). Ci vanno invece i limiti
  di sicurezza/compliance (es. "nessun nuovo dato personale nella sessione del portale") e ciò che è fuori scope.
- **Linguaggio**: "No formal language is required".
- **Approvazione**: il product owner rivede e corregge prima del commit; accettazione/rifiuto = merge o
  chiusura della review. Autore e data li registra git.
- **Dove**: "an `intent/` folder in the product repo"; repo dedicato solo se l'intent attraversa più repo.
- **A valle**: lo stage 2 trasforma l'intent approvato in spec; lo stage 6 (manutenzione) scrive nuovi
  `intent.md` quando un controllo deterministico scatta, "with no person in the invocation path".

## Confronto col nostro design (sotto-progetto 1)

| Scelta | Esito |
|---|---|
| Sezioni Problema / Outcome / Utenti e sistemi / Vincoli / Domande aperte | **Confermata** (stessi campi del template) |
| Stato nel frontmatter | **Confermata**, più ricca: `draft/ready/in-progress/done/rejected` invece di `draft/approved`; `ready` = approvato |
| Intervista una domanda alla volta, niente soluzioni | **Confermata**; aggiunto alle istruzioni: chiedere esplicitamente cosa è fuori scope (va nei Vincoli) |
| Outcome come elenco verificabile | **Estensione nostra** (il playbook dice solo "what better looks like"): serve a `/goal` come criterio di fine |
| Sezione `Verifica` con comandi | **Estensione nostra**, facoltativa; nel playbook le prove stanno nel plan. Accettabile perché opzionale |
| Cartella `intents/` | Il playbook usa `intent/` (singolare). Differenza di nome, non di sostanza: teniamo `intents/` come deciso, il parser non dipende dal nome |
| Campo autore | Nel playbook è nel testo; da noi lo dà git (come dice anche il playbook) → non aggiunto |
| Approvazione del PO | Lavoro individuale: `status: ready` (o conferma di `/goal` su una bozza) fa da gate |

Nessuna contraddizione sostanziale col design approvato.
