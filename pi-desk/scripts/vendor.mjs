// Heavy renderers loaded only when an answer needs them (Mermaid ~5 MB, KaTeX): copied next to the built page, not bundled.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "renderer", "public", "vendor");
mkdirSync(out, { recursive: true });
cpSync(join(root, "node_modules/mermaid/dist/mermaid.min.js"), join(out, "mermaid.min.js"));
cpSync(join(root, "node_modules/katex/dist/katex.min.js"), join(out, "katex.min.js"));
cpSync(join(root, "node_modules/katex/dist/katex.min.css"), join(out, "katex.min.css"));
cpSync(join(root, "node_modules/katex/dist/fonts"), join(out, "fonts"), { recursive: true });
