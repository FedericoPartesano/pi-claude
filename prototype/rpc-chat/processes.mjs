// Background processes for the session panel: servers and watchers that `bash` calls leave running after the tool returns.
// A launch is recognised from the command (`&`, nohup, setsid, disown); the pid is found in /proc (Linux) and the port from the command or
// the output; liveness is a signal-0 check on the pid, or a TCP probe on the port. Zero dependencies; the chat polls only while rows exist.
import { readdirSync, readFileSync } from "node:fs";
import { connect } from "node:net";

/** True when the command leaves something running in the background. */
export const isLaunch = (command) => /(?<![&>|])&(?![&>])|\b(?:nohup|setsid|disown)\b/.test(String(command ?? ""));

/** First port named by the command (--port N, -p N, PORT=N, host:N) or, failing that, by a URL in the output. */
export function portOf(command, output = "") {
	const c = /(?:--port[= ]|\.server\s+|\s-p[= ]?|\bPORT=|(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):)(\d{2,5})\b/.exec(String(command ?? ""));
	const o = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})\b/.exec(String(output));
	const n = Number((c ?? o)?.[1]);
	return n > 0 && n < 65536 ? n : undefined;
}

/** The part of the command that identifies the process: no nohup/setsid/env prefixes, no redirects, nothing after `&` or `;`. */
export function coreOf(command) {
	let s = String(command ?? "").split(/(?<![&>|])&(?![&>])|;|\n|&&|\|\|/)[0];
	s = s.replace(/\d*>>?\s*&?\S+/g, " ").replace(/<\s*\S+/g, " ").replace(/\b(?:nohup|setsid|exec)\b/g, " ").replace(/^\s*(?:\w+=\S*\s+)+/, "").replace(/\s+/g, " ").trim();
	return s;
}

/** Linux: lowest pid whose command line contains the core, skipping `sh -c` wrappers and the given pids. Undefined elsewhere or if none. */
export function findPid(core, skip = [], proc = "/proc") {
	if (!core) return undefined;
	let names;
	try { names = readdirSync(proc); } catch { return undefined; }
	let best;
	for (const name of names) {
		if (!/^\d+$/.test(name)) continue;
		const pid = Number(name);
		if (skip.includes(pid) || (best !== undefined && pid > best)) continue;
		let args;
		try { args = readFileSync(`${proc}/${name}/cmdline`, "utf8").split("\0"); } catch { continue; }
		if (/(?:^|\/)(?:ba|z|da)?sh$/.test(args[0]) && args[1] === "-c") continue;
		if (args.join(" ").replace(/\s+/g, " ").includes(core)) best = pid;
	}
	return best;
}

export const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

export const portOpen = (port, timeout = 400) => new Promise((done) => {
	const s = connect({ port, host: "localhost" });
	const end = (v) => { s.destroy(); done(v); };
	s.setTimeout(timeout, () => end(false)); s.once("connect", () => end(true)); s.once("error", () => end(false));
});

/** New row for a launch: {id, command, core, port, pid, since, state}. state: up | down | unknown (neither pid nor port to check). */
export function newRow(id, command, output, now, skip = []) {
	const core = coreOf(command), pid = findPid(core, skip), port = portOf(command, output);
	return { id, command: String(command).replace(/\s+/g, " ").trim(), core, port, pid, since: now, state: pid || port ? "up" : "unknown" };
}

/** Refreshes every row in place; resolves true when any state changed. A row that was up and is no longer is down. */
export async function refresh(rows, now) {
	let changed = false;
	for (const r of rows) {
		if (r.state === "down" || r.state === "unknown") continue;
		const alive = r.pid ? pidAlive(r.pid) : r.port ? await portOpen(r.port) : true;
		// A server with a pid that is alive but whose port is not (yet) open is still starting: the pid wins.
		if (!alive) { r.state = "down"; r.downAt = now; changed = true; }
	}
	return changed;
}

const dur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, "0")}`; };

/** Drops rows that went down more than `keepMs` ago; keeps at most `max`, running ones first. */
export const visible = (rows, now, keepMs = 120000, max = 6) => rows.filter((r) => r.state !== "down" || now - r.downAt < keepMs).sort((a, b) => (a.state === "down") - (b.state === "down")).slice(0, max);

/** Panel lines: icon, pid/port, state with time, then the command. `fit(text, w)` cuts to the width; `S` is the palette. */
export function processLines(rows, w, now, S, fit) {
	const R = "\x1b[0m", out = [];
	for (const r of rows) {
		const icon = r.state === "up" ? `${S.ok}●` : r.state === "down" ? `${S.err}○` : `${S.warn}?`;
		const what = [r.port ? `:${r.port}` : "", r.pid ? `pid ${r.pid}` : ""].filter(Boolean).join(" · ");
		const state = r.state === "up" ? `attivo da ${dur(now - r.since)}` : r.state === "down" ? `FERMO da ${dur(now - r.downAt)}` : "avviato, stato ignoto";
		out.push(fit(`${icon}${R} ${r.state === "down" ? S.err : S.text}${what || "processo"}${S.dim} · ${state}${R}`, w));
		out.push(fit(`  ${S.dim}${r.command}${R}`, w));
	}
	return out;
}
