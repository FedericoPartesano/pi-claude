// The bridge to the Electron main process (preload.cjs → window.desk).
export type Img = { data: string; mimeType: string };
export type TranscriptItem = { role: "user" | "assistant" | "tool" | "error"; text: string; id?: string; images?: Img[] };
export type Session = { path: string; cwd: string; project: string; title: string; modified: number; created?: string; running?: { pid: number; own: boolean } };
export type UiRequest = { type: "extension_ui_request"; id: string; method: string; title?: string; message?: string; options?: string[]; prefill?: string; statusKey?: string; statusText?: string };

export interface Desk {
	prompt(text: string, images?: { type: "image"; data: string; mimeType: string }[]): Promise<{ disposition?: string }>;
	abort(): Promise<void>;
	answer(id: string, fields: object): void;
	restart(): Promise<void>;
	browser(action: "go" | "back" | "forward" | "reload", value?: string): void;
	browserRect(rect: { x: number; y: number; width: number; height: number }): void;
	sessions(): Promise<Session[]>;
	openSession(path: string): Promise<TranscriptItem[]>;
	closeSession(): void;
	resumeSession(path: string, cwd: string): Promise<TranscriptItem[]>;
	newSession(): Promise<void>;
	linkSession(pid: number, path: string): Promise<unknown>;
	sendToSession(pid: number, text: string): Promise<{ queued?: boolean }>;
	on(channel: string, listener: (payload: any) => void): void;
}

export const desk = (window as unknown as { desk: Desk }).desk;

/** Electron prefixes errors from the main process: keep the sentence the user can act on. */
export const clean = (message: unknown) => String(message ?? "").replace(/^Error invoking remote method '[^']+': /, "").replace(/^Error: /, "");
