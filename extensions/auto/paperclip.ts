/**
 * /auto as a Paperclip agent (adapter `process`): one heartbeat = one pass of the protocol
 * (docs/guides/agent-developer/heartbeat-protocol.md): identity → inbox → pick → atomic checkout → context →
 * work → status with a comment. The work is the auto loop on a worktree (auto/headless.ts), so the guards
 * (denylist, sandbox, frozen checks, never push or merge) are the ones of /auto. Pure code, every effect injected.
 *
 * Statuses: checks all green → `in_review` (a human merges: auto never does); stopped for time/budget/steps →
 * left `in_progress` with the resume note; stalled or broken → `blocked` with the reason. Never `done`, never a
 * retry of a 409. Env (injected by the adapter): PAPERCLIP_API_URL, PAPERCLIP_API_KEY, PAPERCLIP_AGENT_ID,
 * PAPERCLIP_COMPANY_ID, PAPERCLIP_RUN_ID, PAPERCLIP_TASK_ID (optional), PAPERCLIP_APPROVAL_ID (optional).
 */
import type { StopReason } from "./state.ts";

export interface PaperclipEnv {
	apiUrl: string;
	apiKey: string;
	agentId: string;
	companyId?: string;
	runId: string;
	taskId?: string;
	approvalId?: string;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): PaperclipEnv | string {
	const need = ["PAPERCLIP_API_URL", "PAPERCLIP_API_KEY", "PAPERCLIP_AGENT_ID"].filter((name) => !env[name]);
	if (need.length) return `manca ${need.join(", ")}`;
	return {
		apiUrl: env.PAPERCLIP_API_URL!.replace(/\/+$/, ""),
		apiKey: env.PAPERCLIP_API_KEY!,
		agentId: env.PAPERCLIP_AGENT_ID!,
		companyId: env.PAPERCLIP_COMPANY_ID,
		runId: env.PAPERCLIP_RUN_ID ?? "",
		taskId: env.PAPERCLIP_TASK_ID,
		approvalId: env.PAPERCLIP_APPROVAL_ID,
	};
}

export interface Issue {
	id: string;
	identifier?: string;
	title: string;
	description?: string;
	status: string;
	priority?: string;
}

export interface Work {
	reason: StopReason | "?";
	detail: string;
	branch: string;
	worktree: string;
	steps: number;
	tokens: number;
}

export interface HeartbeatDeps {
	fetch: typeof fetch;
	/** Runs the auto loop for the issue (headless.ts); `slug` is stable per issue, so a later heartbeat resumes. */
	work(goal: string, slug: string, signal?: AbortSignal): Promise<Work>;
	log?(line: string): void;
	signal?: AbortSignal;
}

export type Outcome = "nessun-lavoro" | "occupato" | "in_review" | "in_progress" | "blocked" | "errore";

const WORK_STATUSES = "todo,in_progress,in_review,blocked";
const RESUMABLE = new Set<string>(["budget", "tempo", "passi", "fermato"]);
const ORDER = ["in_progress", "todo"]; // in_review only when woken by its task id; blocked is skipped

export const slugFor = (issue: Pick<Issue, "id" | "identifier">) => `pc-${(issue.identifier ?? issue.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;

/** Which issue to work on: the task the wake is about if it is ours, else the inbox by status then priority order. */
export function pick(inbox: Issue[], taskId?: string): Issue | undefined {
	const named = taskId ? inbox.find((issue) => issue.id === taskId) : undefined;
	if (named && named.status !== "blocked") return named;
	for (const status of ORDER) {
		const found = inbox.find((issue) => issue.status === status);
		if (found) return found;
	}
	return undefined;
}

/** Goal text for auto: the issue and the latest comments (they may hold the reviewer's feedback). */
export function goalFrom(issue: Issue, comments: { body?: string; authorName?: string }[]): string {
	const thread = comments
		.slice(-5)
		.map((comment) => `- ${comment.authorName ?? "?"}: ${(comment.body ?? "").trim().slice(0, 600)}`)
		.join("\n");
	return [issue.title, (issue.description ?? "").trim(), thread ? `Commenti recenti:\n${thread}` : ""].filter(Boolean).join("\n\n").slice(0, 4000);
}

export function verdict(work: Work): { status: "in_review" | "in_progress" | "blocked"; comment: string } {
	const facts = `Branch \`${work.branch}\` in \`${work.worktree}\` · ${work.steps} passi · ${work.tokens} token.`;
	if (work.reason === "completato") return { status: "in_review", comment: `Tutti i check congelati sono verdi. ${facts}\nProssimo passo: rivedere il branch e integrarlo (auto non fa merge né push).` };
	if (RESUMABLE.has(work.reason)) return { status: "in_progress", comment: `Fermo per ${work.reason}: ${work.detail}. ${facts}\nProssimo passo: alla prossima heartbeat riprende da dove si è fermato (stato riletto dai check).` };
	return { status: "blocked", comment: `Bloccato (${work.reason}): ${work.detail}. ${facts}\nServe una persona: chiarire il requisito o correggere a mano, poi riassegnare per riprendere.` };
}

export async function heartbeat(env: PaperclipEnv, deps: HeartbeatDeps): Promise<{ outcome: Outcome; detail: string }> {
	const log = (line: string) => deps.log?.(line);
	const call = async (method: string, path: string, body?: unknown) => {
		const response = await deps.fetch(`${env.apiUrl}${path}`, {
			method,
			headers: { Authorization: `Bearer ${env.apiKey}`, "Content-Type": "application/json", ...(env.runId ? { "X-Paperclip-Run-Id": env.runId } : {}) },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: deps.signal,
		});
		const text = await response.text();
		let json: any;
		try {
			json = text ? JSON.parse(text) : undefined;
		} catch {
			json = undefined;
		}
		return { status: response.status, ok: response.ok, json, text };
	};
	try {
		const me = await call("GET", "/api/agents/me");
		if (!me.ok) return { outcome: "errore", detail: `identità non letta (${me.status})` };
		const companyId = env.companyId ?? me.json?.companyId;
		if (env.approvalId) log(`approvazione ${env.approvalId}: la gestisce chi ha richiesto, auto non decide`);
		const inbox = await call("GET", `/api/companies/${companyId}/issues?assigneeAgentId=${env.agentId}&status=${WORK_STATUSES}`);
		if (!inbox.ok) return { outcome: "errore", detail: `inbox non letta (${inbox.status})` };
		const issues: Issue[] = Array.isArray(inbox.json) ? inbox.json : (inbox.json?.issues ?? inbox.json?.items ?? []);
		const issue = pick(issues, env.taskId);
		if (!issue) return { outcome: "nessun-lavoro", detail: "inbox vuota" };

		// Atomic checkout: a 409 means the task is someone else's: stop, never retry.
		const checkout = await call("POST", `/api/issues/${issue.id}/checkout`, { agentId: env.agentId, expectedStatuses: ["todo", "backlog", "blocked", "in_review", "in_progress"] });
		if (checkout.status === 409) return { outcome: "occupato", detail: `${issue.identifier ?? issue.id} è di un altro agente (409)` };
		if (!checkout.ok) return { outcome: "errore", detail: `checkout fallito (${checkout.status})` };

		const [full, thread] = await Promise.all([call("GET", `/api/issues/${issue.id}`), call("GET", `/api/issues/${issue.id}/comments`)]);
		const detail: Issue = full.ok && full.json?.id ? full.json : issue;
		const comments = Array.isArray(thread.json) ? thread.json : (thread.json?.comments ?? []);
		let work: Work;
		try {
			work = await deps.work(goalFrom(detail, comments), slugFor(issue), deps.signal);
		} catch (error) {
			const message = (error as Error).message;
			await call("PATCH", `/api/issues/${issue.id}`, { status: "blocked", comment: `auto non è partito: ${message}\nProssimo passo: sistemare l'ambiente e riassegnare.` });
			return { outcome: "blocked", detail: message };
		}
		const result = verdict(work);
		// Paperclip refuses an agent's move to in_review unless the next action has an owner. Assigning a human
		// would cancel this very run ("cancelled before issue reassignment"), so ask for a confirmation instead.
		if (result.status === "in_review") {
			await call("POST", `/api/issues/${issue.id}/interactions`, {
				kind: "request_confirmation",
				continuationPolicy: "none",
				idempotencyKey: `pi-auto-review-${issue.id}-${work.branch}-${work.steps}`,
				title: "Revisione del lavoro di auto",
				payload: { version: 1, prompt: `Check verdi sul branch ${work.branch}. Accetti il lavoro? Il merge resta tuo.`, acceptLabel: "Accetto", rejectLabel: "Da rifare", detailsMarkdown: result.comment },
			});
		}
		let patched = await call("PATCH", `/api/issues/${issue.id}`, { status: result.status, comment: result.comment });
		if (!patched.ok && patched.status === 422 && result.status === "in_review") {
			// Still refused: park it as blocked with the result in the comment, so the heartbeat does not loop on finished work.
			const note = `${result.comment}\nPaperclip non ha accettato in_review (${patched.status}): serve una revisione umana.`;
			patched = await call("PATCH", `/api/issues/${issue.id}`, { status: "blocked", comment: note });
			if (patched.ok) return { outcome: "blocked", detail: `${issue.identifier ?? issue.id}: ${work.reason} — in_review rifiutato, messo in blocked` };
		}
		if (!patched.ok) return { outcome: "errore", detail: `stato non aggiornato (${patched.status})` };
		return { outcome: result.status, detail: `${issue.identifier ?? issue.id}: ${work.reason} — ${work.detail}` };
	} catch (error) {
		return { outcome: "errore", detail: (error as Error).message };
	}
}
