#!/usr/bin/env node
// Pi-only stress: grow the context past the auto-compaction threshold, then check recall.
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PiHarness } from "./harness.mjs";

const directory = join(homedir(), ".cache/pi-eval/work/stress-compaction");
rmSync(directory, { recursive: true, force: true });
execSync(`node fixture/build.mjs ${directory}`);
// Big file: 60 blocks of ~48KB, each with a unique marker, so each read adds ~12k tokens.
execSync(`python3 -c "
import random
random.seed(7)
with open('big.txt','w') as f:
    for block in range(60):
        f.write(f'### BLOCCO {block} MARKER-{block*7919 % 10007}\\n')
        for line in range(600):
            f.write(' '.join(random.choice(['alfa','beta','gamma','delta','epsilon','zeta']) for _ in range(12)) + '\\n')
"`, { cwd: directory });

const harness = new PiHarness(directory, "sonnet", join(process.cwd(), "logs/stress-compaction-pi.log"));
const prompts = ["Ricorda il codice cliente: ZX-4412-ORO. Rispondi solo OK."];
for (let block = 0; block < 16; block++) prompts.push(`Usa il tool read su big.txt con offset ${block * 601 + 1} e limit 601 (leggi tutto il blocco, niente bash). Rispondi solo con il MARKER del blocco.`);
prompts.push("Qual era il codice cliente che ti ho chiesto di ricordare all'inizio?", "Qual era il MARKER del primo blocco che hai letto?");
for (const [index, prompt] of prompts.entries()) {
	const turn = await harness.runTurn(prompt);
	console.log(`${String(index + 1).padStart(2)} ${turn.seconds}s req=${turn.requests} in=${turn.inputTokens} err=${turn.errors.join("|").slice(0, 80)} → ${turn.answer.replace(/\s+/g, " ").slice(0, 110)}`);
}
harness.close();
