---
name: express-dev
description: Backend Express 4 e 5: route, middleware, errori asincroni, sicurezza, migrazione alla 5
extends: implementer
stack: express, express-validator, body-parser
verified: 2026-10-10 su Express 5.3 (con le differenze dalla 4)
sources: https://expressjs.com/en/guide/migrating-5.html, https://expressjs.com/en/guide/error-handling.html, https://expressjs.com/en/guide/routing.html, https://expressjs.com/en/guide/using-middleware.html, https://expressjs.com/en/advanced/best-practice-security.html, https://expressjs.com/en/advanced/best-practice-performance.html
---
Competenze: Express. Prima di tutto leggi la versione di `express` nel package.json: la 4 e la 5 si comportano in modo diverso su errori, percorsi e body.

Errori (guida error handling)
- Express 5: se un handler o middleware `async` lancia o una promise viene rifiutata, l'errore arriva da solo al gestore degli errori: non servono wrapper né `.catch(next)`.
- Express 4: gli errori asincroni vanno passati a mano con `next(err)` (o con il wrapper già presente nel progetto), altrimenti la richiesta resta appesa.
- In tutte le versioni, gli errori delle API a callback (es. `node:fs`) vanno passati a `next(err)`.
- Gestore degli errori con 4 argomenti `(err, req, res, next)`, registrato dopo le route; se `res.headersSent` è vero, delega con `return next(err)`. Lo stack trace va al client solo fuori da `NODE_ENV=production`.

Express 5: differenze dalla 4 (guida di migrazione)
- Percorsi: il carattere jolly ha un nome (`/*splat`, oppure `/{*splat}` per includere `/`) e il suo parametro è un array; i parametri opzionali si scrivono con le graffe (`/:file{.:ext}`), non con `?`; niente sintassi regex nelle stringhe (usa un array di percorsi); `()[]?+!` vanno preceduti da `\`.
- `req.body` è `undefined` se nessun parser l'ha letto (nella 4 era `{}`); `express.urlencoded()` ha `extended: false` di default.
- Rimossi: `res.send(status)` → `res.sendStatus()`; `res.json(obj, status)` e `res.send(body, status)` → `res.status(s).json(obj)`; `req.param()`; `app.del()` → `app.delete()`; `res.redirect('back')`.
- Gli errori di `app.listen` (es. `EADDRINUSE`) arrivano come argomento della callback invece di essere lanciati.

Sicurezza (best practice ufficiali)
- Non fidarti dell'input. Prima di `res.redirect`/`res.location` con un URL dell'utente, controlla l'host con `new URL()` (open redirect).
- Helmet per gli header di sicurezza; `app.disable('x-powered-by')`.
- Cookie con `secure`, `httpOnly`, `domain`, `path`, `expires`; non usare il nome di default del cookie di sessione.
- Proteggi il login dal brute force contando i tentativi falliti per utente e IP (es. `rate-limiter-flexible`).

Prestazioni
- Niente funzioni sincrone (`fs.readFileSync`…) negli handler; compressione gzip se il progetto non la delega a un proxy.

Test
- Pratica comune, non dalla documentazione Express: crea l'`app` in un modulo e chiama `listen` in un altro, così i test con supertest importano l'app senza aprire porte.
