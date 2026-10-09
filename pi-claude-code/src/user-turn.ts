/**
 * The user messages of one Pi turn (the prompt plus what extensions add, e.g. recalled memories) as ONE Claude Code
 * message. Sent one by one, Claude Code answered each as its own turn: the model replied to the memories alone, and the
 * extra answer was read by the next request, one turn out of step (wrong replies, "tool call not expected by Pi").
 */
export function oneUserTurn<C, B>(messages: { content: C }[], toBlocks: (content: C) => B[]): B[] | undefined {
	if (messages.length === 0) return undefined;
	return messages.flatMap((message) => toBlocks(message.content));
}
