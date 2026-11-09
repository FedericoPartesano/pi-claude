---
type: concept
title: ASD-STE100 (Simplified Technical English)
tags: [stile, risposte, valutazione]
related: [costo-fisso-in-token, pi-claude-code]
created: 2026-11-09
updated: 2026-11-09
---

# ASD-STE100 (Simplified Technical English)

Inglese controllato: 53 regole di scrittura + dizionario di circa 900 parole approvate. Issue 9, gennaio 2025. Nato nel 1983 (AECMA) per i manuali di manutenzione degli aerei. Curato da ASD STEMG; gratuito dall'Issue 6 (2013).

## Regole
- Frasi: max 20 parole nelle procedure, 25 nelle descrizioni; una istruzione per frase.
- Paragrafi: un argomento, max 6 frasi.
- Voce attiva.
- Tempi ammessi: infinito, imperativo, presente/passato/futuro semplici; participio passato solo come aggettivo.
- Niente ausiliari per costruzioni complesse.
- Forma in -ing solo come nome o modificatore tecnico.
- Gruppi di nomi: max 3 parole.
- Non omettere articoli, soggetto, verbo.
- Elenchi verticali.
- Istruzioni di sicurezza: iniziano con un comando.

## Dizionario
Una parola, una categoria grammaticale, un significato. Esempi: «test» solo nome; l'aggettivo «close» non è approvato, si usa NEAR.

## Evidenza HN (fonte debole, luglio-agosto 2026)
- Nominare ASD-STE100 nel prompt: circa 72% di conformità; più prompting: circa 90%, poi plateau.
- I modelli iniziano a tagliare contenuto chiave; serve validazione esterna.
- Esiste una skill per agenti che impone STE sui documenti.
- Legame con Karpathy: NON confermato, nessuna fonte primaria trovata.

## Relazione con Pi
- STE migliora la chiarezza, non il numero di token.
- Pi risponde in italiano; non esiste uno STE italiano ufficiale.
- Possibile conflitto con caveman (risparmio token, primo nel mantra, vedi [[costo-fisso-in-token]]): STE mantiene gli articoli.

## Misura in Pi (2026-11-09)
Haiku, 8 domande, un giro. Testo visibile: STE −25% di token, STE+caveman (`COMBO`) −53% (caveman solo −51%); STE+caveman ha meno `-ing` (11 contro 21). STE da solo fa pensare molto il modello (8077 token di pensiero contro 1372): il totale sale. Il primo conteggio che dava «STE non risparmia» sommava il pensiero al testo. Dettagli e limiti: `eval/ste/REPORT.md`.
