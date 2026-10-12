---
name: nest-dev
description: Backend NestJS: moduli, provider, validazione (class-validator o Standard Schema), eccezioni, test, migrazione alla 12
extends: implementer
stack: @nestjs/*
verified: 2026-10-10 su NestJS 12.1 (guida di migrazione 11 → 12)
sources: https://docs.nestjs.com/modules, https://docs.nestjs.com/providers, https://docs.nestjs.com/controllers, https://docs.nestjs.com/application/validation, https://docs.nestjs.com/pipes, https://docs.nestjs.com/guards, https://docs.nestjs.com/exception-filters, https://docs.nestjs.com/fundamentals/testing, https://docs.nestjs.com/migration-guide
---
Competenze: NestJS. Prima di tutto leggi la versione di `@nestjs/core` nel package.json e se il progetto è CommonJS o ESM (`"type": "module"`): le regole su test e moduli cambiano.

Struttura (moduli e provider)
- Un modulo per area. Un modulo incapsula i suoi provider: gli altri moduli vedono solo quelli in `exports`, quindi esporta solo ciò che serve fuori.
- Controller sottili, logica nei provider `@Injectable()` ricevuti dal costruttore; niente `new` di servizi a mano. Le classi dei moduli non si iniettano.
- Autorizzazione con i guard; trasformazione e validazione dell'input con le pipe.

Validazione: usa l'approccio già presente
- DTO a classi + `ValidationPipe` (class-validator): i DTO devono essere classi concrete, non interfacce o generici, e non vanno importati con `import type` (sparirebbero a runtime). `whitelist` toglie i campi non dichiarati, `forbidNonWhitelisted` li rifiuta, `transform` converte i tipi. Se il progetto usa `@nestjs/swagger` o `@nestjs/graphql`, prendi `PartialType`/`PickType` da lì e non da `@nestjs/mapped-types`.
- Solo dalla 12: schema Standard Schema (Zod, Valibot, ArkType) con `@Body({ schema })`/`@Param('id', { schema })` e `StandardSchemaValidationPipe`. Con Zod `z.object()` toglie i campi in più, `z.strictObject()` li rifiuta.

Errori
- Lancia le eccezioni di Nest (`NotFoundException`, `BadRequestException`…): ogni eccezione che non deriva da `HttpException` diventa un 500 "Internal server error". Dalla 12 puoi aggiungere `errorCode` per un codice leggibile dal client.

Test
- Unit con `Test.createTestingModule`, sostituendo le dipendenze con `overrideProvider` o `useMocker`. E2E con `createNestApplication()`, `await app.init()`, supertest e `await app.close()` alla fine. Guard, pipe e interceptor globali (`APP_GUARD`…) vanno sovrascritti con i passaggi della guida, non con `overrideProvider` semplice.
- Dalla 12 i pacchetti sono solo ESM: Jest li carica solo su Node 24.9 o successivo (altrimenti `ERR_REQUIRE_ASYNC_MODULE`). I progetti ESM nuovi usano Vitest. Non cambiare runner se il compito non lo chiede.

Altri cambi della 12
- `@Optional()` non si eredita più: una sottoclasse deve dichiarare il proprio costruttore con `@Optional()`, altrimenti `UnknownDependenciesException`.
- Gli hook di ciclo di vita (`onModuleInit`, `onApplicationBootstrap`, chiusura) seguono la gerarchia dei componenti: non dare per scontato l'ordine tra provider collegati.
- Per aggiornare un progetto si usa `nest upgrade` (anche `--dry-run`), che porta tutti i pacchetti `@nestjs/*` alla stessa major.
