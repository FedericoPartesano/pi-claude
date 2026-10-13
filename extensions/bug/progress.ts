/**
 * The "sending" state of a bug upload: a static icon in the status line while it runs, then one toast, success or error.
 * The status line is always cleared, also when the upload throws.
 */
const ICON = "⏳";

export interface ProgressUi {
	setStatus(key: string, text: string | undefined): void;
	notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface Outcome {
	ok: boolean;
	message: string;
}

export async function sendWithProgress(ui: ProgressUi, send: () => Promise<Outcome>, texts: { sending: string; done: (message: string) => string; failed: (message: string) => string }): Promise<Outcome> {
	// One static icon, drawn once: no timer, no redraws.
	try {
		ui.setStatus("bug-upload", `${ICON} ${texts.sending}`);
	} catch {
		// stale ui after a reload: nothing to draw
	}
	let outcome: Outcome;
	try {
		outcome = await send();
	} catch (error) {
		outcome = { ok: false, message: (error as Error).message };
	} finally {
		try {
			ui.setStatus("bug-upload", undefined);
		} catch {
			// stale ui
		}
	}
	try {
		if (outcome.ok) ui.notify(`✓ ${texts.done(outcome.message)}`, "info");
		else ui.notify(`✗ ${texts.failed(outcome.message)}`, "error");
	} catch {
		// stale ui
	}
	return outcome;
}
