import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../skills/", import.meta.url).pathname;
const phases = JSON.parse(readFileSync(join(root, "phases.json"), "utf8"));

test("phases.json points to existing skills", () => {
  for (const [k, v] of Object.entries(phases)) {
    if (k.startsWith("_") || k === "maxInline") continue;
    const list = k === "triggers" ? v.map((t) => t.skill) : [...(v.inline ?? []), ...(v.list ?? [])];
    for (const s of list) assert.ok(existsSync(join(root, s, "SKILL.md")), s);
  }
  for (const t of phases.triggers) new RegExp(t.match, "i");
});
test("every bundled skill is hidden from the model and has unique name", () => {
  const names = new Set();
  for (const g of ["agent-skills", "ecc"]) for (const d of readdirSync(join(root, g, "skills"))) {
    const s = readFileSync(join(root, g, "skills", d, "SKILL.md"), "utf8");
    assert.match(s, /^disable-model-invocation: true$/m, d);
    const n = s.match(/^name: (.+)$/m)[1];
    assert.equal(n, d);
    assert.ok(!names.has(n)); names.add(n);
  }
});
test("shared references resolve", () => {
  for (const d of readdirSync(join(root, "agent-skills", "skills"))) {
    const s = readFileSync(join(root, "agent-skills", "skills", d, "SKILL.md"), "utf8");
    for (const m of s.matchAll(/\]\((\.\.\/\.\.\/references\/[^)#]+)\)/g))
      assert.ok(existsSync(join(root, "agent-skills", "skills", d, m[1])), d + " " + m[1]);
  }
});
