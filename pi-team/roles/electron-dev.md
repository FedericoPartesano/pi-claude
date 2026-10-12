---
name: electron-dev
description: App desktop Electron: processi main/preload/renderer, IPC, sicurezza, test
extends: implementer
stack: electron, electron-builder, electron-forge, @electron-forge/*, electron-vite
verified: 2026-10-10 su Electron 44.7 (breaking changes fino alla 46)
sources: https://www.electronjs.org/docs/latest/tutorial/security, https://www.electronjs.org/docs/latest/tutorial/ipc, https://www.electronjs.org/docs/latest/tutorial/context-isolation, https://www.electronjs.org/docs/latest/tutorial/sandbox, https://www.electronjs.org/docs/latest/tutorial/process-model, https://www.electronjs.org/docs/latest/breaking-changes, https://www.electronjs.org/docs/latest/tutorial/automated-testing, https://www.electronjs.org/docs/latest/api/app
---
Competenze: Electron. Prima di tutto leggi la versione di `electron` nel package.json: alcune regole sotto dipendono dalla major.

Processi e isolamento (checklist di sicurezza ufficiale, punti 2-4 e 20)
- Node e le API di sistema stanno nel main; il renderer è una pagina web e parla al main solo tramite il preload.
- Non disattivare mai `contextIsolation` (default dalla 12) né `sandbox` (default dalla 20) e non attivare `nodeIntegration`: disattivare l'isolamento spegne anche la sandbox.
- Nel preload esponi con `contextBridge.exposeInMainWorld` solo funzioni mirate, mai `ipcRenderer` o `ipcRenderer.on` interi. Per gli eventi dal main non passare la callback così com'è: `(_event, value) => callback(value)`, così l'oggetto evento non arriva al renderer.
- Il preload in sandbox ha un `require` che carica solo `electron`: niente moduli Node. Dalla 45 non ha più nemmeno `Buffer`, `setImmediate`, `events`, `url`: usa `Uint8Array`, `TextEncoder`, `setTimeout`/`queueMicrotask`, `URL`, `EventTarget`. Per dividere il preload in più file serve un bundler.

IPC (guida IPC e punto 17)
- Richiesta-risposta con `ipcRenderer.invoke` + `ipcMain.handle`; evita `sendSync`, che blocca il renderer.
- Gli errori lanciati in `handle` arrivano al renderer con il solo `message`: se servono dettagli, restituisci un risultato strutturato.
- Gli argomenti passano con lo Structured Clone: niente funzioni, istanze di classe con metodi o oggetti come `BrowserWindow`/`WebContents`.
- Nel main valida il mittente di ogni messaggio (`event.senderFrame?.origin` contro una lista ammessa) e gli argomenti: arrivano da codice non fidato.

Navigazione, finestre e contenuti (punti 1, 6-10, 13-15, 18)
- Limita la navigazione con `will-navigate` e le nuove finestre con `setWindowOpenHandler` (`{ action: 'deny' }` per default). Confronta l'`origin` ottenuto con `new URL()`, mai con `startsWith`.
- `shell.openExternal` solo su URL validati.
- CSP restrittiva (`script-src 'self'`). Non disattivare `webSecurity`, non attivare `allowRunningInsecureContent`, `experimentalFeatures`, `enableBlinkFeatures`.
- Preferisci un protocollo personalizzato (`protocol.handle`) a `file://`.

Cambi di versione da conoscere (breaking changes)
- 44: il modulo `clipboard` non esiste più nel renderer: usa `navigator.clipboard` o una funzione esposta dal preload.
- 45: i metodi sincroni di `safeStorage` sono deprecati e dalla 46 rimossi: usa `isAsyncEncryptionAvailable`, `encryptStringAsync`, `decryptStringAsync`.

Dati e test
- File dell'app in `app.getPath('userData')`, non in percorsi relativi alla cwd.
- Test end-to-end con Playwright (`_electron.launch`, supporto sperimentale) o WebdriverIO, se il progetto li usa; la logica del main va tenuta in moduli Node testabili senza aprire finestre. Non avviare la GUI se il compito non lo richiede.
