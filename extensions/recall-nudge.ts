/**
 * recall-nudge — when billion-context has folded part of the conversation and the model answers
 * "I don't know" without having searched, append one hidden message and continue the run once,
 * asking it to call search_context first.
 *
 * Why: on the haystack bench (eval/fold) the model abstained on folded facts without ever calling
 * search_context (H1-bc 11/19, H1-bc-noarch 5/19); where it did search (R1-bc-noarch) it scored 12/14.
 * Zero fixed cost: nothing is added to the prompt; the message exists only after an abstention.
 * Opt out with PI_RECALL_NUDGE=0.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { foldedIds } from "./archivio.ts";

export const NUDGE_TYPE = "recall-nudge";

/** Abstention phrases (Italian and English). Narrower than the bench scorer: no bare "nessun". */
export const ABSTAIN =
	/\bnon (lo |te lo )?so\b|\bnon dett[oa]\b|non (lo |me lo )?ricordo|non (è|e') (mai )?(stat[oa] )?(dett|indicat|menzionat|fornit|specificat|comunicat)|non (me l'hai|mi hai|hai) (mai )?(dett|dat|fornit|indicat|comunicat)|non (risulta|compare)|non ho (questa |quest'|l'|il |un |alcun[ao]? )?(informazion|dat|traccia)|\bmai (dett|indicat|menzionat)|sconosciut|not (known|provided|mentioned|available)|\b(don't|do not) (know|recall|remember)|no record of/i;

const SEARCH_TOOLS = new Set(["search_context", "decompress"]);

const NUDGE =
	"Part of this conversation was compressed. Before saying a detail is unknown, call search_context with its key terms and decompress the block it returns if the summary lacks the exact value; then answer again. Keep saying it is unknown only if the search finds nothing.";

type Block = { type?: string; text?: string; name?: string };
type Msg = { role?: string; customType?: string; content?: string | Block[] };

const text = (m: Msg) => (typeof m.content === "string" ? m.content : (m.content ?? []).map((b) => (b.type === "text" ? b.text ?? "" : "")).join("\n"));

/** True when the run since the last user prompt ends in an abstention with no search and no earlier nudge. */
export function needsNudge(messages: readonly Msg[], folded: boolean): boolean {
	if (!folded) return false;
	let start = messages.length;
	while (start > 0 && messages[start - 1].role !== "user") start--;
	const run = messages.slice(start);
	let last: Msg | undefined;
	for (const m of run) {
		if (m.role === "custom" && m.customType === NUDGE_TYPE) return false;
		if (m.role !== "assistant") continue;
		if (Array.isArray(m.content) && m.content.some((b) => b.type === "toolCall" && SEARCH_TOOLS.has(b.name ?? ""))) return false;
		last = m;
	}
	return last !== undefined && ABSTAIN.test(text(last));
}

type SettleEvent = { entries: unknown[]; outcome: string; context: { contextMessages: Msg[] } };
type Ctx = { sessionManager: { getSessionFile?: () => string | undefined } };

export default function (pi: ExtensionAPI) {
	if (process.env.PI_RECALL_NUDGE === "0") return;
	pi.on("agent_before_settle", (event: SettleEvent, ctx: Ctx) => {
		// context.canContinue is false here by design (the context ends with the answer); the appended message makes it true.
		if (event.outcome !== "completed") return;
		// Cheap check first: the sidecar read is cached by mtime, only reached after an abstention.
		const messages = event.context.contextMessages;
		if (!needsNudge(messages, true)) return;
		if (foldedIds(ctx.sessionManager.getSessionFile?.()).size === 0) return;
		return {
			entries: [...event.entries, { type: "custom_message", customType: NUDGE_TYPE, content: NUDGE, display: false }],
			continue: true,
		};
	});
}
