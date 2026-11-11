// Copies the selected third-party skills into skills/ and marks every one
// disable-model-invocation (zero prompt cost; reachable via /skill:<name> or skills/phases.json).
// Usage: node scripts/sync-skills.mjs <agent-skills-clone> <ecc-clone>
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const [ads, ecc] = process.argv.slice(2);
if (!ads || !ecc) { console.error("usage: sync-skills.mjs <agent-skills> <ecc>"); process.exit(2); }

const ADS = ["using-agent-skills", "idea-refine", "spec-driven-development", "planning-and-task-breakdown",
  "incremental-implementation", "test-driven-development", "debugging-and-error-recovery", "code-review-and-quality",
  "doubt-driven-development", "context-engineering", "security-and-hardening", "git-workflow-and-versioning",
  "code-simplification", "constraint-driven-development",
  // Conditional (auto/triggers.ts): read only when the run needs them.
  "frontend-ui-engineering", "api-and-interface-design", "performance-optimization", "documentation-and-adrs",
  "source-driven-development", "browser-testing-with-devtools", "observability-and-instrumentation",
  "ci-cd-and-automation", "deprecation-and-migration", "shipping-and-launch"];
const ECC = ["loop-design-check"];

function hide(file) {
  const s = readFileSync(file, "utf8");
  const m = s.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error("no frontmatter: " + file);
  if (/^disable-model-invocation:/m.test(m[1])) return;
  writeFileSync(file, s.replace(m[0], `---\n${m[1]}\ndisable-model-invocation: true\n---\n`));
}

function copy(srcRoot, names, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const n of names) {
    const src = join(srcRoot, "skills", n);
    if (!existsSync(join(src, "SKILL.md"))) throw new Error("missing skill: " + n);
    cpSync(src, join(dest, n), { recursive: true });
    hide(join(dest, n, "SKILL.md"));
  }
}

copy(ads, ADS, join(root, "agent-skills", "skills"));
cpSync(join(ads, "references"), join(root, "agent-skills", "references"), { recursive: true });
cpSync(join(ads, "LICENSE"), join(root, "agent-skills", "LICENSE"));
copy(ecc, ECC, join(root, "ecc", "skills"));
cpSync(join(ecc, "LICENSE"), join(root, "ecc", "LICENSE"));
console.log("ok", ADS.length + ECC.length, "skills");
