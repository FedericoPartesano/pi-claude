/** Turn state behind the status bar: a pure reducer over Pi events, so the bar is testable without Pi. */
export type Mode = "ready" | "working" | "waiting" | "stopped" | "done";

export interface TurnStatus {
	mode: Mode;
	/** What is happening now, in words ("eseguo i test"). */
	activity: string;
	step: number;
	startedAt: number;
	endedAt: number;
	tokensIn: number;
	tokensOut: number;
	/** The last step failed: if the turn ends there, it stopped on that error. */
	lastFailed: boolean;
	question?: string;
	answers?: string;
	/** Done, but the last check failed (the model answered anyway, e.g. a test that was already broken). */
	warning?: string;
	/** Numbered suggestions available after the turn (keys 1-N). */
	suggestions?: number;
	/** Reasoning or running a tool: the bar animates them differently. */
	phase?: "thinking" | "tool";
	/** Latest sentence of the model's thinking while it reasons. */
	thought?: string;
}

export type StatusEvent =
	| { type: "agent_start"; at: number }
	| { type: "tool_start"; activity: string }
	| { type: "tool_end"; failed: boolean }
	| { type: "usage"; input: number; output: number }
	| { type: "waiting"; question: string; answers: string }
	| { type: "resumed" }
	| { type: "suggestions"; count: number }
	| { type: "thinking"; text: string }
	| { type: "settled"; at: number; outcome: "completed" | "aborted" | "error" };

export const initialStatus = (): TurnStatus => ({ mode: "ready", activity: "", step: 0, startedAt: 0, endedAt: 0, tokensIn: 0, tokensOut: 0, lastFailed: false });

export function nextStatus(status: TurnStatus, event: StatusEvent): TurnStatus {
	switch (event.type) {
		case "agent_start":
			return { ...initialStatus(), mode: "working", activity: "penso…", startedAt: event.at, phase: "thinking" };
		case "tool_start":
			return { ...status, activity: event.activity, step: status.step + 1, lastFailed: false, phase: "tool", thought: undefined };
		case "thinking":
			return { ...status, phase: "thinking", thought: event.text };
		case "tool_end":
			return { ...status, lastFailed: event.failed };
		case "usage":
			return { ...status, tokensIn: status.tokensIn + event.input, tokensOut: status.tokensOut + event.output };
		case "waiting":
			return { ...status, mode: "waiting", question: event.question, answers: event.answers };
		case "suggestions":
			return { ...status, suggestions: event.count || undefined };
		case "resumed":
			return { ...status, mode: "working", question: undefined, answers: undefined };
		case "settled": {
			if (event.outcome === "aborted") return { ...status, mode: "stopped", activity: "interrotto", endedAt: event.at };
			if (event.outcome === "error") return { ...status, mode: "stopped", activity: "errore del modello", endedAt: event.at };
			if (status.lastFailed) return { ...status, mode: "done", warning: `ultimo passo non riuscito: ${status.activity}`, endedAt: event.at };
			return { ...status, mode: "done", endedAt: event.at };
		}
	}
}

export function elapsedSeconds(status: TurnStatus, now: number): number {
	if (!status.startedAt) return 0;
	return Math.max(0, Math.round(((status.endedAt || now) - status.startedAt) / 1000));
}
