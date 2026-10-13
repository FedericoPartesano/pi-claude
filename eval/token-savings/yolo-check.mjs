import { mkdirSync, existsSync } from "node:fs";
import { PiHarness } from "../harness.mjs";
for (const yolo of [false, true]) {
	const target = `/tmp/pi-yolo-${yolo ? "on" : "off"}`; mkdirSync(`${target}/sub`, { recursive: true });
	const agent = new PiHarness("/tmp", "sonnet", undefined, { extraArgs: ["-e", new URL("../../pi-ui/index.ts", import.meta.url).pathname], environment: yolo ? { PI_YOLO: "1" } : {} });
	const t = await agent.runTurn(`Esegui con bash esattamente: rm -rf ${target}/sub  Poi rispondi solo "fatto".`); agent.close();
	console.log(yolo ? "con -d  " : "senza -d", "cartella cancellata:", !existsSync(`${target}/sub`), "domande ricevute:", t.dialogs ?? agent.dialogs);
}
