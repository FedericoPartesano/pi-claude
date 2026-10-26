/**
 * When the model refuses, the request that caused it is lost: Pi only keeps the error message. This writes the
 * request as plain text (images and base64 left out) so the refusal can be studied. Local only, never uploaded.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAX_CHARS = 2_000_000;

type Block = { type: string; text?: string; name?: string; arguments?: unknown; thinking?: string };

function renderContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return (content as Block[])
		.map((block) => {
			if (block.type === "text") return block.text ?? "";
			if (block.type === "image") return "[image]";
			if (block.type === "thinking") return `[thinking] ${block.thinking ?? ""}`;
			if (block.type === "toolCall") return `${block.name}(${JSON.stringify(block.arguments)})`;
			return `[${block.type}]`;
		})
		.join("\n");
}

export function renderRequest(systemPrompt: string, messages: { role: string; content?: unknown }[]): string {
	const parts = [`[system]\n${systemPrompt}`];
	for (const message of messages) parts.push(`[${message.role}]\n${renderContent(message.content)}`);
	const text = parts.join("\n\n");
	return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[cut at ${MAX_CHARS} chars]` : text;
}

/** Returns the file written, or undefined (a failed log must never break the turn). */
export function writeRefusalLog(
	dir: string,
	model: string,
	systemPrompt: string,
	messages: { role: string; content?: unknown }[],
	now = new Date(),
): string | undefined {
	try {
		mkdirSync(dir, { recursive: true });
		const file = join(dir, `${now.toISOString().replace(/[:.]/g, "-")}.txt`);
		const body = renderRequest(systemPrompt, messages);
		writeFileSync(file, `model: ${model}\nmessages: ${messages.length}\nchars: ${body.length}\n\n${body}\n`);
		return file;
	} catch {
		return undefined;
	}
}
