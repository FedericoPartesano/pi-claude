// What one page costs the model: pi-browser's compact snapshot vs the full accessibility tree with an id per node (the
// shape Chrome DevTools MCP / Playwright MCP return) vs raw HTML. Tokens ≈ chars / 4. Real headless Chrome.
//   node eval/browser/page-size.mjs [url …]
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
const repo = new URL("../..", import.meta.url).pathname;
process.env.PI_BROWSER_HEADLESS = "1";
process.env.PI_BROWSER_PROFILE = mkdtempSync(join(tmpdir(), "pb-size-"));
const { BrowserSession } = await import(join(repo, "extensions/browser/session.ts"));
const { compactSnapshot, RefTable } = await import(join(repo, "extensions/browser/snapshot.ts"));
const urls = process.argv.slice(2).length ? process.argv.slice(2) : ["https://news.ycombinator.com", "https://en.wikipedia.org/wiki/Personalized_PageRank", "https://github.com/vercel-labs/agent-browser", "https://httpbin.org/forms/post"];
const session = new BrowserSession();
const tok = (text) => Math.round(text.length / 4);
try {
	console.log("pagina | compatta (pi-browser, con tetto) | compatta senza tetto | albero completo con id | HTML");
	for (const url of urls) {
		const compact = await session.open(url);
		const page = session.page;
		const { nodes } = await page.send("Accessibility.getFullAXTree");
		const byId = new Map(nodes.map((node) => [node.nodeId, node]));
		const childOf = new Set(nodes.flatMap((node) => node.childIds ?? []));
		let full = "";
		const walk = (node, depth) => {
			if (!node) return;
			const role = node.role?.value ?? "";
			const name = node.name?.value ?? "";
			if (!node.ignored) full += `${"  ".repeat(depth)}uid=${node.nodeId} ${role}${name ? ` "${name}"` : ""}\n`;
			for (const child of node.childIds ?? []) walk(byId.get(child), node.ignored ? depth : depth + 1);
		};
		for (const node of nodes.filter((node) => !childOf.has(node.nodeId))) walk(node, 0);
		const html = await session.evaluate("document.documentElement.outerHTML.length");
		const uncapped = compactSnapshot(nodes, new RefTable(), { maxChars: 1e9 });
		console.log(`${url} | ${tok(compact)} | ${tok(uncapped)} | ${tok(full)} | ${Math.round(Number(html) / 4)}`);
	}
} finally {
	session.close();
}
process.exit(0);
