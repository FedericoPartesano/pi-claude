import { createSignal, For, Match, Switch } from "solid-js";
import { Dialog } from "@kobalte/core/dialog";
import type { UiRequest } from "../bridge";

/** Pi's extension dialogs (confirm, select, input), mounted in the chat column: the browser panel is a native view on top. */
export function ExtensionDialog(props: { request?: UiRequest; mount?: HTMLElement; onAnswer: (fields: object) => void }) {
	const [value, setValue] = createSignal("");
	return (
		<Dialog open={Boolean(props.request)} onOpenChange={(open) => !open && props.onAnswer({ cancelled: true })} modal>
			<Dialog.Portal mount={props.mount}>
				<Dialog.Overlay class="dialog-overlay" />
				<div class="dialog-position">
					<Dialog.Content class="dialog" onOpenAutoFocus={() => setValue(props.request?.prefill ?? "")}>
						<Dialog.Title class="dialog-title">{props.request?.title ?? "Pi"}</Dialog.Title>
						<Dialog.Description class="dialog-message">{props.request?.message ?? ""}</Dialog.Description>
						<div class="dialog-actions">
							<Switch>
								<Match when={props.request?.method === "confirm"}>
									<button type="button" onClick={() => props.onAnswer({ confirmed: false })}>No</button>
									<button type="button" class="primary" autofocus onClick={() => props.onAnswer({ confirmed: true })}>Sì</button>
								</Match>
								<Match when={props.request?.method === "select"}>
									<For each={props.request?.options ?? []}>{(option) => <button type="button" onClick={() => props.onAnswer({ value: option })}>{option}</button>}</For>
									<button type="button" onClick={() => props.onAnswer({ cancelled: true })}>Annulla</button>
								</Match>
								<Match when={props.request?.method === "input"}>
									<input value={value()} onInput={(event) => setValue(event.currentTarget.value)} onKeyDown={(event) => event.key === "Enter" && props.onAnswer({ value: value() })} autofocus />
									<button type="button" onClick={() => props.onAnswer({ cancelled: true })}>Annulla</button>
									<button type="button" class="primary" onClick={() => props.onAnswer({ value: value() })}>OK</button>
								</Match>
							</Switch>
						</div>
					</Dialog.Content>
				</div>
			</Dialog.Portal>
		</Dialog>
	);
}
