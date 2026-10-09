/**
 * Hidden Unicode the model obeys but a human cannot see (from claude-mods' prompt-injection-defense): tag characters
 * (U+E0000–E007F, which can spell a whole instruction invisibly), bidi controls (Trojan Source: text shown in another
 * order than it reads) and zero-width characters. Joiners inside emoji sequences and a leading BOM are legitimate.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface HiddenScan {
	count: number;
	kinds: Partial<Record<"tag" | "bidi" | "zero-width", number>>;
	/** The ASCII text spelled by tag characters, if any. */
	smuggled?: string;
}

const PICTOGRAPH = /\p{Extended_Pictographic}/u;
/** Scripts that need ZWJ/ZWNJ to be written correctly (Persian می‌خواهم, Devanagari conjuncts), and combining marks (virama). */
const JOINING_SCRIPT = /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}\p{Script=Mongolian}\p{M}]/u;
/** Right-to-left letters: where bidi controls are ordinary punctuation of the text. */
const RTL = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const isTag = (char: string | undefined) => {
	const code = char?.codePointAt(0) ?? 0;
	return code >= 0xe0000 && code <= 0xe007f;
};

/** Tag characters spelling a subdivision flag (🏴 + tags + cancel tag: England, Scotland, Wales). */
function inFlagSequence(chars: string[], index: number): boolean {
	let start = index;
	while (isTag(chars[start - 1])) start--;
	if (chars[start - 1] !== "🏴") return false;
	let end = index;
	while (isTag(chars[end]) && chars[end].codePointAt(0) !== 0xe007f) end++;
	return chars[end]?.codePointAt(0) === 0xe007f;
}

/** Kind of a hidden code point at `index` in `chars`, or undefined when it is visible or legitimate there. */
function hiddenKind(chars: string[], index: number, rtlText: boolean): keyof HiddenScan["kinds"] | undefined {
	const code = chars[index].codePointAt(0)!;
	if (code >= 0xe0000 && code <= 0xe007f) return inFlagSequence(chars, index) ? undefined : "tag";
	if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return rtlText ? undefined : "bidi";
	if ((code === 0x200c || code === 0x200d) && (JOINING_SCRIPT.test(chars[index - 1] ?? "") || JOINING_SCRIPT.test(chars[index + 1] ?? ""))) return undefined;
	if (code === 0x200d) {
		// Zero-width joiner between two pictographs: an emoji sequence (👨‍👩‍👧), not a hiding place.
		const before = chars[index - 1] ?? "";
		const after = chars[index + 1] ?? "";
		const pictographic = (char: string) => PICTOGRAPH.test(char) || /[\u{1F3FB}-\u{1F3FF}️]/u.test(char);
		return pictographic(before) && pictographic(after) ? undefined : "zero-width";
	}
	if (code === 0x200b || code === 0x200c || code === 0x2060 || code === 0x180e) return "zero-width";
	if (code === 0xfeff) return index === 0 ? undefined : "zero-width";
	return undefined;
}

export function scanHidden(text: string): HiddenScan {
	const result: HiddenScan = { count: 0, kinds: {} };
	// Fast path: nothing outside the BMP's common ranges and no format characters.
	if (!/[​-‍⁠᠎﻿‪-‮⁦-⁩]|\uDB40[\uDC00-\uDC7F]/.test(text)) return result;
	const chars = [...text];
	const rtlText = RTL.test(text);
	let smuggled = "";
	chars.forEach((_, index) => {
		const kind = hiddenKind(chars, index, rtlText);
		if (!kind) return;
		result.count++;
		result.kinds[kind] = (result.kinds[kind] ?? 0) + 1;
		if (kind === "tag") {
			const ascii = chars[index].codePointAt(0)! - 0xe0000;
			if (ascii >= 0x20 && ascii < 0x7f) smuggled += String.fromCharCode(ascii);
		}
	});
	if (smuggled) result.smuggled = smuggled;
	return result;
}

export function stripHidden(text: string): string {
	if (scanHidden(text).count === 0) return text;
	const chars = [...text];
	const rtlText = RTL.test(text);
	return chars.filter((_, index) => !hiddenKind(chars, index, rtlText)).join("");
}

/** One line for a finding: counts by kind and the smuggled text. */
export function describeHidden(scan: HiddenScan): string {
	const kinds = Object.entries(scan.kinds).map(([kind, count]) => `${count} ${kind}`).join(", ");
	return `${scan.count} caratteri invisibili (${kinds})${scan.smuggled ? `, testo nascosto: «${scan.smuggled.slice(0, 120)}»` : ""}`;
}

const SKILL_DIRS = (home: string, project: string) => [join(home, ".agents", "skills"), join(home, ".pi", "agent", "skills"), join(home, ".claude", "skills"), join(project, ".agents", "skills"), join(project, ".pi", "skills"), join(project, ".claude", "skills")];

/** Files the model treats as authority: instruction files of the project and the user, and installed skills. */
export function instructionFiles(project: string, home: string, limit = 400): string[] {
	const files: string[] = [];
	for (const file of [join(project, "AGENTS.md"), join(project, "CLAUDE.md"), join(project, ".pi", "AGENTS.md"), join(home, ".pi", "agent", "AGENTS.md"), join(home, ".claude", "CLAUDE.md")]) if (existsSync(file)) files.push(file);
	for (const dir of SKILL_DIRS(home, project)) {
		if (!existsSync(dir)) continue;
		for (const name of readdirSync(dir)) {
			const skill = join(dir, name, "SKILL.md");
			try {
				if (statSync(skill).isFile()) files.push(skill);
			} catch {
				// Not a skill folder.
			}
			if (files.length >= limit) return files;
		}
	}
	return files;
}
