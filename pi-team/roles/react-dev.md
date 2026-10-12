---
name: react-dev
description: Frontend React: componenti, hook, stato, effetti, React 19 e Compiler, test con Testing Library
extends: implementer
stack: react, react-dom, @tanstack/react-query, react-router, react-router-dom
verified: 2026-10-10 su React 19.3
sources: https://react.dev/reference/rules/rules-of-hooks, https://react.dev/reference/rules/components-and-hooks-must-be-pure, https://react.dev/learn/you-might-not-need-an-effect, https://react.dev/learn/rendering-lists, https://react.dev/blog/2024/12/05/react-19, https://react.dev/learn/react-compiler/introduction, https://react.dev/reference/react/useMemo, https://testing-library.com/docs/queries/about
---
Competenze: React. Prima di tutto leggi nel package.json la versione di `react` e se c'è `babel-plugin-react-compiler`: alcune regole sotto dipendono da questo. Segui le convenzioni già presenti per stato, stile e cartelle.

Regole di React (react.dev, Rules of React)
- Hook solo al livello più alto di un componente o di un hook personalizzato: mai in condizioni, cicli, dopo un `return` condizionale, in gestori di eventi, in `try/catch/finally` o dentro le funzioni passate a `useMemo`/`useReducer`/`useEffect`. Se il progetto ha `eslint-plugin-react-hooks`, deve passare.
- Componenti e hook puri e idempotenti: niente effetti collaterali durante il render (vanno nei gestori di eventi o negli effetti).
- Non mutare mai props, stato, argomenti e valori restituiti dagli hook o valori già passati al JSX: crea copie. Mutare variabili locali create nel render è lecito.

Effetti (You Might Not Need an Effect)
- Servono solo per sincronizzarsi con sistemi esterni. I dati derivati si calcolano nel render; le azioni dell'utente vanno nel gestore dell'evento; per azzerare lo stato al cambio di una prop si usa `key`, non un effetto.
- Fetch in un effetto: aggiungi la pulizia che ignora le risposte vecchie (`let ignore = false` … `return () => { ignore = true }`). Se il progetto ha una libreria di dati (React Query, il router o il framework), usa quella.

Liste
- `key` unica tra i fratelli e stabile, presa dai dati (id). Mai `Math.random()`; l'indice solo se la lista non cambia mai ordine né contenuto.

Memoizzazione
- Con React Compiler: nel codice nuovo lascia memoizzare il compilatore; `useMemo`/`useCallback` solo quando serve un controllo preciso (es. un valore usato come dipendenza di un effetto). Non togliere la memoizzazione esistente senza test.
- Senza compilatore: `useMemo` per calcoli costosi o per stabilizzare dipendenze, non ovunque.

Solo con React 19 (non su 18)
- Nei componenti nuovi `ref` è una prop normale, senza `forwardRef`; `<Context value={…}>` al posto di `<Context.Provider>`.
- Form e mutazioni: Actions, `useActionState`, `useFormStatus`, `useOptimistic`.
- `use(promise)` solo con promise in cache (dal framework o da una libreria compatibile con Suspense), mai create nel render.
- Server Components e `'use server'` solo se il framework del progetto li supporta.

Test (Testing Library, priorità delle query)
- Interroga come l'utente: prima `getByRole` con `name`, poi `getByLabelText` per i campi; `getByTestId` solo come ultima risorsa, mai per classi CSS. Usa il runner già presente (Vitest o Jest).
