/**
 * Pi's AgentSession.prompt() checks isStreaming, then awaits (auth, pre-prompt compaction, before_agent_start, image
 * normalisation) before it marks the run active. Two prompts in that window both see "idle": the second one throws
 * "Agent is already processing a prompt" and the interactive mode shows "Failed to send queued message" (typically a
 * message typed during compaction, flushed at compaction_end while the prompt that triggered it is still starting).
 * The wrapper turns that throw into the queueing the caller asked for, so the message is never lost.
 */
type PromptOptions = { streamingBehavior?: "steer" | "followUp"; images?: unknown[] } | undefined;
type Queueable = {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	prompt: (text: string, options?: PromptOptions) => Promise<void>;
	steer: (text: string, images?: unknown[]) => Promise<void>;
	followUp: (text: string, images?: unknown[]) => Promise<void>;
};

const BUSY = /already processing a prompt/i;

export function patchPromptRace(proto: Queueable): boolean {
	if (!proto || typeof proto.prompt !== "function" || Object.prototype.hasOwnProperty.call(proto, "piUiPromptRace")) return false;
	const original = proto.prompt;
	proto.prompt = async function (this: Queueable, text: string, options?: PromptOptions) {
		try {
			return await original.call(this, text, options);
		} catch (error) {
			const behavior = options?.streamingBehavior;
			if (!behavior || !(error instanceof Error) || !BUSY.test(error.message)) throw error;
			return behavior === "steer" ? this.steer(text, options?.images) : this.followUp(text, options?.images);
		}
	};
	Object.defineProperty(proto, "piUiPromptRace", { value: true });
	return true;
}

/**
 * The AgentSession class Pi actually runs. The `pi` command runs the bundle (dist/bundle/cli.js) while extensions import
 * `@earendil-works/pi-coding-agent` as dist/index.js: two copies of the class, so patching the imported one does
 * nothing. The bundle's index.js, imported next to the running cli.js, is the same module instance Pi loaded.
 */
export async function runtimeAgentSession(argv1: string | undefined, fallback: unknown): Promise<unknown> {
	try {
		if (argv1) {
			const { realpathSync } = await import("node:fs");
			const { dirname, join } = await import("node:path");
			const { pathToFileURL } = await import("node:url");
			const cli = realpathSync(argv1);
			if (/[\\/]bundle[\\/]cli\.js$/.test(cli)) {
				const bundle = (await import(pathToFileURL(join(dirname(cli), "index.js")).href)) as { AgentSession?: unknown };
				if (bundle.AgentSession) return bundle.AgentSession;
			}
		}
	} catch {
		// Not the bundled CLI (tests, SDK use): the imported class is the running one.
	}
	return fallback;
}
