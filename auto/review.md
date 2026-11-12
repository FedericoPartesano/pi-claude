# Review del diff 446858c..HEAD

## Corretto
- `cockpit.mjs`, riga di avanzamento: `fit()` applicato a una stringa con codici ANSI contava i codici come colonne (troncava in anticipo) e a larghezze strette poteva spezzare una sequenza di escape. Ora `cutAnsi`; test di regressione in `auto-cockpit-v2.test.ts`.

## Lasciato
- «in attesa» compare sia nella riga 3 sia nei tasti: ridondanza voluta dall'intent (riga tasti contestuale), costo nullo.
- R9 prestazioni +21,8% sulla mediana: già dichiarato negativo in `eval/ui/REPORT.md` con dispersione ±30–40%; rimisurare sul Proxmox non è possibile qui.
- Nessun problema di sicurezza: nessun input esterno eseguito, path del diario derivato dal file di stato annunciato da /auto, nessuna dipendenza nuova.
- Test: 20 verdi sui file cockpit.
