import { createMemo, For } from "solid-js";
import { answerBlocks } from "../render";

/** An answer as memoised blocks: For keys them by their HTML, so unchanged blocks keep their DOM nodes while streaming. */
export function Markdown(props: { text: string }) {
	const blocks = createMemo(() => answerBlocks(props.text).blocks as string[]);
	return (
		<div class="md">
			<For each={blocks()}>{(html) => <div class="block" innerHTML={html} />}</For>
		</div>
	);
}
