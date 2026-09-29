/**
 * Pairs the tool_use blocks Pi reads from Claude Code's stream with the MCP `tools/call` requests
 * Claude Code sends to run them.
 *
 * The two arrive on different paths and in no guaranteed order. With the "sdk" transport the MCP
 * request is a `control_request` on the same stdout, handled as soon as its line is read, while the
 * `content_block_stop` that registers the tool_use is only queued and processed when the provider
 * pulls the next record. So the MCP request often arrives FIRST. An unmatched request therefore
 * waits (up to `unmatchedWaitMs`) for its tool_use instead of failing at once - failing produced
 * the intermittent "Tool call X was not expected by Pi." errors, with the tool never executed.
 */
import type { McpToolCallResult } from "./mcp-http-server.ts";

interface ExpectedToolCall {
	id: string;
	name: string;
	argumentsKey: string;
	/** Set once Claude Code's MCP request has been matched to this tool_use block. */
	claimed: boolean;
	/** False when Claude Code rejected the input itself and will never call the tool. */
	willBeCalled: boolean;
	result?: McpToolCallResult;
	deliver?: (result: McpToolCallResult) => void;
	fail?: (error: Error) => void;
}

/** An MCP request that arrived before its tool_use block. */
interface WaitingCall {
	name: string;
	argumentsKey: string;
	match: (expected: ExpectedToolCall) => void;
	fail: (error: Error) => void;
}

/** How long an MCP request waits for its tool_use block before being refused. */
export const DEFAULT_UNMATCHED_WAIT_MS = 30_000;

export class ToolCallMatcher {
	private readonly expected = new Map<string, ExpectedToolCall>();
	private readonly waiting: WaitingCall[] = [];
	private readonly options: { unmatchedWaitMs?: number; debugLog?: (line: string) => void };

	constructor(options: { unmatchedWaitMs?: number; debugLog?: (line: string) => void } = {}) {
		this.options = options;
	}

	/**
	 * A tool_use block finished. Normally Claude Code is about to call it through MCP (or already
	 * has: then the waiting request is matched now); with `willBeCalled: false` (unparseable input)
	 * Claude Code answers the model itself, so Pi's result for that call is only acknowledged.
	 */
	expect(id: string, name: string, toolArguments: unknown, { willBeCalled = true } = {}): void {
		const expected: ExpectedToolCall = { id, name, argumentsKey: stableStringify(toolArguments), claimed: false, willBeCalled };
		this.expected.set(id, expected);
		if (!willBeCalled) return;
		const index = this.waiting.findIndex((call) => call.name === name && call.argumentsKey === expected.argumentsKey);
		if (index === -1) return;
		const [call] = this.waiting.splice(index, 1);
		call.match(expected);
	}

	has(id: string): boolean {
		return this.expected.has(id);
	}

	/** Pi has executed the tool: release the pending MCP request (or store the result for it). */
	resolve(id: string, result: McpToolCallResult): boolean {
		const expected = this.expected.get(id);
		if (!expected) return false;
		if (!expected.willBeCalled) {
			this.expected.delete(id);
			return true;
		}
		if (expected.deliver) {
			expected.deliver(result);
			this.expected.delete(id);
		} else {
			expected.result = result;
		}
		return true;
	}

	/** Claude Code's MCP `tools/call`: resolves with Pi's result once Pi has executed the tool. */
	handleCall(name: string, toolArguments: Record<string, unknown>, signal: AbortSignal): Promise<McpToolCallResult> {
		const argumentsKey = stableStringify(toolArguments);
		const expected = this.findUnclaimed(name, argumentsKey);
		if (expected) return this.claim(expected, signal);

		this.options.debugLog?.(`MCP call ${name} before its tool_use, waiting ${argumentsKey}`);
		const waitMs = this.options.unmatchedWaitMs ?? DEFAULT_UNMATCHED_WAIT_MS;
		return new Promise<McpToolCallResult>((resolve, reject) => {
			const remove = (): void => {
				const index = this.waiting.indexOf(call);
				if (index !== -1) this.waiting.splice(index, 1);
				clearTimeout(timer);
				signal.removeEventListener("abort", onAbort);
			};
			const onAbort = (): void => {
				remove();
				reject(new Error("MCP request cancelled"));
			};
			const call: WaitingCall = {
				name,
				argumentsKey,
				match: (found) => {
					remove();
					this.claim(found, signal).then(resolve, reject);
				},
				fail: (error) => {
					remove();
					reject(error);
				},
			};
			const timer = setTimeout(() => {
				remove();
				this.options.debugLog?.(`unmatched MCP call ${name} ${argumentsKey}`);
				resolve({ content: [{ type: "text", text: `Tool call ${name} was not expected by Pi.` }], isError: true });
			}, waitMs);
			signal.addEventListener("abort", onAbort, { once: true });
			this.waiting.push(call);
		});
	}

	/** The Claude process is gone: every pending call fails with `error`. */
	failAll(error: Error): void {
		for (const expected of this.expected.values()) expected.fail?.(error);
		this.expected.clear();
		for (const call of [...this.waiting]) call.fail(error);
	}

	private findUnclaimed(name: string, argumentsKey: string): ExpectedToolCall | undefined {
		return [...this.expected.values()].find(
			(candidate) => candidate.willBeCalled && !candidate.claimed && candidate.name === name && candidate.argumentsKey === argumentsKey,
		);
	}

	private claim(expected: ExpectedToolCall, signal: AbortSignal): Promise<McpToolCallResult> {
		expected.claimed = true;
		if (expected.result) {
			this.expected.delete(expected.id);
			return Promise.resolve(expected.result);
		}
		return new Promise<McpToolCallResult>((resolve, reject) => {
			expected.deliver = resolve;
			expected.fail = reject;
			signal.addEventListener("abort", () => reject(new Error("MCP request cancelled")), { once: true });
		});
	}
}

/** JSON.stringify with sorted object keys, so equal arguments compare equal. */
export function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, entryValue]) => entryValue !== undefined)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
		return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}
