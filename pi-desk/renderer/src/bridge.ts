// The bridge to the Electron main process (preload.cjs → window.desk).
export type Img = { data: string; mimeType: string };
export type TranscriptItem = { role: "user" | "assistant" | "tool" | "error"; text: string; id?: string; images?: Img[] };
export type Session = { path: string; cwd: string; project: string; title: string; modified: number; created?: string; running?: { pid: number; own: boolean } };
export type UiRequest = { type: "extension_ui_request"; id: string; method: string; title?: string; message?: string; options?: string[]; prefill?: string; statusKey?: string; statusText?: string };

export type DocFile = { path?: string; name?: string; kind?: string; size?: number; text?: string; rows?: string[][]; url?: string; truncated?: boolean; error?: string };

/** A terminal Pi's status line (pi-ui), read through desk-link. */
export type RemoteStatus = { mode: "idle" | "working" | "waiting" | "done" | "stopped"; activity?: string; step?: number; startedAt?: number; endedAt?: number; tokensIn?: number; tokensOut?: number; question?: string; phase?: string; thought?: string; warning?: string };

/** Header and sidebar facts (main process: git, usage file, Pi's get_state / get_session_stats). */
export type Info = { project: string; branch?: string; changes?: number; usage?: { fiveHour?: number; sevenDay?: number; overage?: boolean; updatedAt?: string }; model?: string; thinking?: string; sessionName?: string; sessionFile?: string; context?: number; user?: string };

export interface Desk {
	info(): Promise<Info>;
	projectFiles(): Promise<string[]>;
	fork(text: string, occurrence: number): Promise<{ text?: string; cancelled?: boolean; items: TranscriptItem[] }>;
	openExternal(target: string): Promise<unknown>;
	prompt(text: string, images?: { type: "image"; data: string; mimeType: string }[]): Promise<{ disposition?: string }>;
	abort(): Promise<void>;
	answer(id: string, fields: object): void;
	restart(): Promise<void>;
	browser(action: "go" | "back" | "forward" | "reload" | "devtools", value?: string): void;
	file(path: string): Promise<DocFile>;
	pick(): Promise<{ role: string; name: string; selector: string; url: string; html: string; image?: string } | null>;
	browserRect(rect: { x: number; y: number; width: number; height: number }): void;
	clipboardImage(): Promise<Img | undefined>;
	sessions(): Promise<Session[]>;
	openSession(path: string): Promise<TranscriptItem[]>;
	closeSession(): void;
	resumeSession(path: string, cwd: string): Promise<TranscriptItem[]>;
	newSession(): Promise<void>;
	linkSession(pid: number, path: string): Promise<unknown>;
	sendToSession(pid: number, text: string): Promise<{ queued?: boolean }>;
	sessionStatus(pid: number): Promise<{ status: RemoteStatus | null; busy: boolean }>;
	answerSession(pid: number, value: "yes" | "no" | "always"): Promise<unknown>;
	on(channel: string, listener: (payload: any) => void): void;
}

export const desk = (window as unknown as { desk: Desk }).desk;

/** Electron prefixes errors from the main process: keep the sentence the user can act on. */
export const clean = (message: unknown) => String(message ?? "").replace(/^Error invoking remote method '[^']+': /, "").replace(/^Error: /, "");
