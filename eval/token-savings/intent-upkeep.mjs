// Il modello tiene aggiornato l'intent? Intent con 2 outcome banali: dopo il lavoro il file deve avere le spunte con prova.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiHarness } from "../harness.mjs";
const dir = join(tmpdir(), "pi-upkeep", String(process.pid));
rmSync(dir, { recursive: true, force: true }); mkdirSync(join(dir, "intents"), { recursive: true });
const file = join(dir, "intents", "2026-10-13-saluti.md");
writeFileSync(file, "---\nstatus: in-progress\ncreated: 2026-10-13\nsource: user\n---\n# Saluti\n\n## Outcome atteso\n- [ ] 1. Esiste ciao.txt con dentro la parola ciao.\n- [ ] 2. Esiste hello.txt con dentro la parola hello.\n");
const agent = new PiHarness(dir, "sonnet", undefined, { environment: { PI_INTENT_UPKEEP: process.env.PI_INTENT_UPKEEP ?? "1" } });
await agent.runTurn("Fai quello che chiede l'intent in corso.");
agent.close();
console.log(readFileSync(file, "utf8"));
console.log("ciao.txt:", readFileSync(join(dir, "ciao.txt"), "utf8").trim(), "| hello.txt:", readFileSync(join(dir, "hello.txt"), "utf8").trim());
