/**
 * Encrypted secret store: one JSON file, every entry sealed with AES-256-GCM under a key derived from a master
 * passphrase (scrypt). The entry name is bound in as additional authenticated data, so a blob cannot be moved
 * between names. Any failure (wrong passphrase, tampering, corruption) fails closed. Zero dependencies (node:crypto).
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Secret =
	| { kind: "var"; value: string; url?: string }
	| { kind: "login"; url: string; user: string; password: string }
	| { kind: "sudo"; password: string };

interface Sealed { iv: string; tag: string; ct: string }
interface FileShape { v: 1; salt: string; check: Sealed; entries: Record<string, Sealed> }

const CHECK = "\u0000check";
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
export const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** Entry names without unlocking (names are stored in clear, so the model can be told what exists). */
export function peekNames(path: string = defaultPath()): string[] {
	try {
		const data = JSON.parse(readFileSync(path, "utf8")) as FileShape;
		return Object.keys(data.entries ?? {}).sort();
	} catch {
		return [];
	}
}

export const defaultPath = () => process.env.PI_SECRETS_FILE ?? join(homedir(), ".pi", "secrets.enc");

function seal(key: Buffer, name: string, plain: string): Sealed {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	cipher.setAAD(Buffer.from(name));
	const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ct: ct.toString("base64") };
}

function open(key: Buffer, name: string, s: Sealed): string | undefined {
	try {
		const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(s.iv, "base64"));
		decipher.setAAD(Buffer.from(name));
		decipher.setAuthTag(Buffer.from(s.tag, "base64"));
		return Buffer.concat([decipher.update(Buffer.from(s.ct, "base64")), decipher.final()]).toString("utf8");
	} catch {
		return undefined;
	}
}

export class Vault {
	private key?: Buffer;
	private data?: FileShape;
	readonly path: string;
	constructor(path: string = defaultPath()) { this.path = path; }

	get exists() { return existsSync(this.path); }
	get unlocked() { return Boolean(this.key && this.data); }

	/** Creates the file when missing, otherwise verifies the passphrase. Returns false when it is wrong or the file is corrupt. */
	unlock(passphrase: string): boolean {
		if (!passphrase) return false;
		if (!this.exists) {
			const salt = randomBytes(16);
			const key = scryptSync(passphrase, salt, 32, SCRYPT);
			this.key = key;
			this.data = { v: 1, salt: salt.toString("base64"), check: seal(key, CHECK, "ok"), entries: {} };
			this.save();
			return true;
		}
		let data: FileShape;
		try {
			data = JSON.parse(readFileSync(this.path, "utf8"));
			if (data.v !== 1 || !data.salt || !data.check || typeof data.entries !== "object") return false;
		} catch {
			return false;
		}
		const key = scryptSync(passphrase, Buffer.from(data.salt, "base64"), 32, SCRYPT);
		if (open(key, CHECK, data.check) !== "ok") return false;
		this.key = key;
		this.data = data;
		return true;
	}

	lock() { this.key?.fill(0); this.key = undefined; this.data = undefined; }

	names(): string[] { return this.data ? Object.keys(this.data.entries).sort() : []; }

	get(name: string): Secret | undefined {
		const sealed = this.key && this.data?.entries[name];
		if (!sealed || !this.key) return undefined;
		const plain = open(this.key, name, sealed);
		if (plain === undefined) return undefined;
		try { return JSON.parse(plain) as Secret; } catch { return undefined; }
	}

	set(name: string, secret: Secret) {
		if (!this.key || !this.data) throw new Error("archivio bloccato");
		if (!NAME_RE.test(name)) throw new Error("nome non valido (lettere, cifre, _ e -; inizia con una lettera)");
		this.data.entries[name] = seal(this.key, name, JSON.stringify(secret));
		this.save();
	}

	remove(name: string): boolean {
		if (!this.data || !(name in this.data.entries)) return false;
		delete this.data.entries[name];
		this.save();
		return true;
	}

	/** Every secret string a result could leak (decrypted), with the entry it belongs to. */
	values(): { name: string; value: string }[] {
		const out: { name: string; value: string }[] = [];
		for (const name of this.names()) {
			const s = this.get(name);
			if (!s) continue;
			const parts = s.kind === "var" ? [s.value] : s.kind === "login" ? [s.password, s.user] : [s.password];
			for (const value of parts) if (value.length >= 3) out.push({ name, value });
		}
		return out;
	}

	private save() {
		if (!this.data) return;
		mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
		const tmp = `${this.path}.${process.pid}.tmp`;
		writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
		renameSync(tmp, this.path);
		try { chmodSync(this.path, 0o600); } catch { /* Windows */ }
	}
}
