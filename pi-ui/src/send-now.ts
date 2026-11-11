/**
 * Send now (like Claude Code's ctrl+enter): the messages waiting in Pi's queue, and optionally the text typed in the
 * editor, reach the model at the next model call instead of after the run. Pi delivers "steer" messages after the
 * current tool calls and "followUp" ones only when the run ends, so send-now re-queues every follow-up as a steer;
 * with the claude-code bridge a steer is written to the persistent `claude -p` before the next tool results.
 * Running bash commands move to the background; with nothing to move the run is interrupted (see sendNow).
 * When Pi is idle the queue runs by itself, so there is nothing to do.
 */
type Session = {
	isStreaming?: boolean;
	prompt: (text: string, options?: unknown) => Promise<void>;
	clearQueue: () => { steering: string[]; followUp: string[] };
	steer: (text: string, images?: unknown[]) => Promise<void>;
	abort: () => Promise<void>;
};

let current: Session | undefined;

/** Remembers the AgentSession that last received input: the shortcut handler only has the extension context. */
export function trackSession(proto: { prompt: Session["prompt"] }): boolean {
	if (!proto || typeof proto.prompt !== "function" || Object.prototype.hasOwnProperty.call(proto, "piUiSendNow")) return false;
	const original = proto.prompt;
	proto.prompt = function (this: Session, text: string, options?: unknown) {
		current = this;
		return original.call(this, text, options);
	};
	Object.defineProperty(proto, "piUiSendNow", { value: true });
	return true;
}

export const trackedSession = () => current;

/**
 * Like Claude Code's send-now: takes Pi's queue (plus `typed`) and
 * - when bash commands are running, moves them to the background (`detach`) and re-queues everything as steering:
 *   the tool calls return at once and the model reads the messages in the same turn;
 * - otherwise (the model is writing, or a tool that cannot move runs), aborts the run and sends everything as the next prompt.
 */
export async function sendNow(
	session: Session | undefined,
	typed = "",
	detach: () => number = () => 0,
): Promise<{ sent: number; moved?: number; interrupted?: boolean; reason?: "no-session" | "idle" | "empty" }> {
	if (!session) return { sent: 0, reason: "no-session" };
	if (!session.isStreaming) return { sent: 0, reason: "idle" };
	const { steering, followUp } = session.clearQueue();
	const texts = [...steering, ...followUp, ...(typed.trim() ? [typed.trim()] : [])];
	if (!texts.length) return { sent: 0, reason: "empty" };
	const moved = detach();
	if (moved > 0) {
		let sent = 0;
		for (const text of texts) {
			try {
				await session.steer(text);
				sent++;
			} catch {
				// an extension command cannot be queued: skip it rather than lose the others
			}
		}
		return { sent, moved };
	}
	await session.abort();
	// prompt() resolves when the new run ends: do not wait for it
	void session.prompt(texts.join("\n\n")).catch(() => {});
	return { sent: texts.length, interrupted: true };
}
