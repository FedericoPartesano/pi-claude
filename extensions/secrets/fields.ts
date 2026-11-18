/** The questions asked when adding a secret, shared by `/secret add` (chat dialogs) and `pi secret add` (shell). */
import type { Secret } from "./store.ts";

export type Kind = Secret["kind"];
export const KINDS: Kind[] = ["var", "login", "sudo"];
export interface Field { key: string; label: string; secret: boolean; optional?: boolean }

export function fieldsFor(kind: Kind): Field[] {
	if (kind === "var") return [{ key: "value", label: "Valore", secret: true }, { key: "url", label: "URL o host a cui è legato (vuoto = nessuno, chiede conferma in rete)", secret: false, optional: true }];
	if (kind === "login") return [{ key: "url", label: "URL del sito (es. https://example.com)", secret: false }, { key: "user", label: "Username", secret: false }, { key: "password", label: "Password", secret: true }];
	return [{ key: "password", label: "Password di sudo", secret: true }];
}

/** Builds the secret from the answers; returns an error text when something is missing or malformed. */
export function build(kind: Kind, a: Record<string, string>): Secret | string {
	const need = (key: string) => (a[key] ?? "").length ? undefined : `manca ${key}`;
	if (kind === "var") {
		const err = need("value");
		if (err) return err;
		const url = (a.url ?? "").trim();
		return url ? { kind, value: a.value, url } : { kind, value: a.value };
	}
	if (kind === "login") {
		const err = need("url") ?? need("user") ?? need("password");
		if (err) return err;
		try { new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(a.url) ? a.url : `https://${a.url}`); } catch { return "URL non valido"; }
		return { kind, url: a.url.trim(), user: a.user, password: a.password };
	}
	return need("password") ?? { kind: "sudo", password: a.password };
}
