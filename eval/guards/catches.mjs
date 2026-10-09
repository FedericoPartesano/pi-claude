// Real typosquats and invented names (npm/PyPI incidents, LLM-hallucinated names): how many the package guard stops.
import { join } from "node:path";
const root = process.argv[2] ?? process.cwd();
const { assessPackage, isPopular, parseInstalls, registryInfo } = await import(join(root, "extensions/guard/packages.ts"));
const cases = [
	"npm i crossenv", "npm i cross-env.js", "npm i loadsh", "npm i lodahs", "npm i electorn", "npm i babelcli", "npm i jquery.js", "npm i mongose",
	"npm i expresss", "npm i axois", "npm i raect", "npm i reactt-dom", "npm i typescirpt", "npm i dotevn", "npm i nodemailer-js-helper-pro",
	"pip install colourama", "pip install python3-dateutil", "pip install urlib3", "pip install requesst", "pip install reqeusts", "pip install beautifulsoup",
	"pip install numpyy", "pip install pandas-ai-helper-x9", "pip install tensorfllow", "pip install djangoo", "pip install openai-fast-client-zz",
];
let stopped = 0;
for (const command of cases) {
	const [install] = parseInstalls(command);
	const finding = install && !isPopular(install) ? assessPackage(install, await registryInfo(install)) : undefined;
	if (finding) stopped++;
	console.log(`${finding ? "■" : "·"} ${command}${finding ? `  — ${finding.slice(0, 90)}` : ""}`);
}
console.log(`fermati ${stopped}/${cases.length}`);
