/**
 * Picker sources: what the picker lists at each location. A source with `parent` is navigable (Tab/→ enters an
 * item's `enter` location, ←/Backspace goes up); `search` gives the pool the query is matched against.
 */
import { execFileSync } from "node:child_process";
import { closeSync, type Dirent, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix } from "node:path";

export interface PickerItem {
	/** Returned when the item is picked. */
	value: string;
	label: string;
	description?: string;
	/** Location to open with Tab/→ (folders). */
	enter?: string;
	/** Dot-files and dot-folders: shown only after Alt+H. */
	hidden?: boolean;
}

type Items = PickerItem[] | Promise<PickerItem[]>;

export interface PickerSource {
	/** Initial location. */
	start: string;
	/** Items shown at a location while the query is empty. */
	list(location: string): Items;
	/** Items the query is matched against (default: the listed ones). */
	search?(location: string): Items;
	/** Location above this one, undefined at the top. Enables navigation. */
	parent?(location: string): string | undefined;
	/** Header text for a location. */
	describe?(location: string): string;
	/** Preview text for the highlighted item. */
	preview?(item: PickerItem): string | undefined | Promise<string | undefined>;
}

const DEFAULT_LIMIT = 20_000;
const SKIPPED_FOLDERS = new Set(["node_modules", ".git"]);
const isHidden = (path: string) => path.split("/").some((segment) => segment.startsWith("."));
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Shortens paths under the home folder to ~/... */
export function tildify(path: string): string {
	const home = homedir();
	return path === home ? "~" : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

// ---- Project files ------------------------------------------------------------------------------------------

/** Files of a project, relative to `cwd`: git's view (tracked + untracked, minus ignored) or a plain walk. */
export function listProjectPaths(cwd: string, limit = DEFAULT_LIMIT): string[] {
	try {
		const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
			cwd,
			encoding: "utf8",
			maxBuffer: 256 * 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		});
		return [...new Set(output.split("\0").filter(Boolean))].slice(0, limit);
	} catch {
		return walk(cwd, limit);
	}
}

function walk(root: string, limit: number): string[] {
	const files: string[] = [];
	const queue = [""];
	while (queue.length > 0 && files.length < limit) {
		const relative = queue.shift()!;
		let entries;
		try {
			entries = readdirSync(join(root, relative), { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries.sort((a, b) => byName(a.name, b.name))) {
			const path = relative ? `${relative}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (!SKIPPED_FOLDERS.has(entry.name)) queue.push(path);
			} else if (files.length < limit) files.push(path);
		}
	}
	return files;
}

/** Folders and files one level below `location` ("" = project root), folders first. */
export function childrenAt(paths: string[], location: string): PickerItem[] {
	const prefix = location ? `${location}/` : "";
	const folders = new Set<string>();
	const files: string[] = [];
	for (const path of paths) {
		if (!path.startsWith(prefix)) continue;
		const rest = path.slice(prefix.length);
		const slash = rest.indexOf("/");
		if (slash === -1) files.push(rest);
		else folders.add(rest.slice(0, slash));
	}
	return [
		...[...folders].sort(byName).map((name) => ({ value: `${prefix}${name}/`, label: `${name}/`, enter: `${prefix}${name}`, hidden: name.startsWith(".") })),
		...files.sort(byName).map((name) => ({ value: `${prefix}${name}`, label: name, hidden: name.startsWith(".") })),
	];
}

/** Every folder and file below `location`, labelled with its project path, for searching. */
export function underLocation(paths: string[], location: string): PickerItem[] {
	const prefix = location ? `${location}/` : "";
	const folders = new Set<string>();
	const files: string[] = [];
	for (const path of paths) {
		if (!path.startsWith(prefix)) continue;
		files.push(path);
		for (let slash = path.indexOf("/", prefix.length); slash !== -1; slash = path.indexOf("/", slash + 1)) folders.add(path.slice(0, slash));
	}
	return [
		...[...folders].sort(byName).map((folder) => ({ value: `${folder}/`, label: `${folder}/`, enter: folder, hidden: isHidden(folder) })),
		...files.sort(byName).map((path) => ({ value: path, label: path, hidden: isHidden(path) })),
	];
}

/** First lines of a file or the entries of a folder, as preview text. */
export function previewPath(path: string, maxLines = 60): string | undefined {
	try {
		if (statSync(path).isDirectory()) {
			const entries = readdirSync(path, { withFileTypes: true }).sort((a, b) => byName(a.name, b.name));
			return entries.slice(0, maxLines).map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name)).join("\n") || "(cartella vuota)";
		}
		const head = readHead(path, 16 * 1024);
		if (head.includes("\0")) return "(file binario)";
		return head.split("\n").slice(0, maxLines).join("\n");
	} catch {
		return undefined;
	}
}

/** Files and folders of the project in `cwd`, navigable by folder and searchable as a whole. */
export function filesSource(cwd: string, limit = DEFAULT_LIMIT): PickerSource {
	let paths: string[] | undefined;
	const all = () => (paths ??= listProjectPaths(cwd, limit));
	return {
		start: "",
		list: (location) => childrenAt(all(), location),
		search: (location) => underLocation(all(), location),
		parent: (location) => (location === "" ? undefined : posix.dirname(location) === "." ? "" : posix.dirname(location)),
		describe: (location) => `${tildify(cwd)}/${location ? `${location}/` : ""}`,
		preview: (item) => previewPath(join(cwd, item.value)),
	};
}

// ---- Folders --------------------------------------------------------------------------------------------------

function folderItems(location: string): PickerItem[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(location, { withFileTypes: true });
	} catch {
		entries = [];
	}
	const folders = entries
		.filter((entry) => entry.isDirectory() || (entry.isSymbolicLink() && isFolder(join(location, entry.name))))
		.map((entry) => entry.name)
		.sort(byName);
	return [
		{ value: location, label: "./ (questa cartella)", hidden: false },
		...folders.map((name) => ({ value: join(location, name), label: `${name}/`, enter: join(location, name), hidden: name.startsWith(".") })),
	];
}

function isFolder(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** Folders of the filesystem, from `start`; the first item picks the current folder itself. */
export function dirsSource(start: string): PickerSource {
	return {
		start,
		list: folderItems,
		parent: (location) => (location === "/" ? undefined : dirname(location)),
		describe: (location) => `${tildify(location)}/`,
		preview: (item) => previewPath(item.value),
	};
}

// ---- Recent projects ----------------------------------------------------------------------------------------

export interface RecentProject {
	path: string;
	/** Last session activity, epoch ms. */
	lastUsed: number;
}

function readHead(path: string, bytes: number): string {
	const fd = openSync(path, "r");
	try {
		const buffer = Buffer.alloc(bytes);
		return buffer.toString("utf8", 0, readSync(fd, buffer, 0, bytes, 0));
	} finally {
		closeSync(fd);
	}
}

/** Session cwd from the first record of a Pi session file. */
function sessionCwd(file: string): string | undefined {
	try {
		const record = JSON.parse(readHead(file, 64 * 1024).split("\n")[0]);
		return record?.type === "session" && typeof record.cwd === "string" ? record.cwd : undefined;
	} catch {
		return undefined;
	}
}

/** Projects Pi was used in, from its session files (one folder per cwd), most recent first. */
export function readRecentProjects(sessionsDir: string): RecentProject[] {
	const projects = new Map<string, number>();
	let folders: string[];
	try {
		folders = readdirSync(sessionsDir);
	} catch {
		return [];
	}
	for (const folder of folders) {
		let files: { path: string; mtime: number }[];
		try {
			files = readdirSync(join(sessionsDir, folder))
				.filter((name) => name.endsWith(".jsonl"))
				.map((name) => ({ path: join(sessionsDir, folder, name), mtime: statSync(join(sessionsDir, folder, name)).mtimeMs }))
				.sort((a, b) => b.mtime - a.mtime);
		} catch {
			continue;
		}
		const cwd = files.map((file) => sessionCwd(file.path)).find(Boolean);
		if (!cwd || !isFolder(cwd)) continue;
		projects.set(cwd, Math.max(projects.get(cwd) ?? 0, files[0].mtime));
	}
	return [...projects].map(([path, lastUsed]) => ({ path, lastUsed })).sort((a, b) => b.lastUsed - a.lastUsed);
}

export function sessionsDir(): string {
	return join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "sessions");
}

function ago(epochMs: number, now = Date.now()): string {
	const minutes = Math.round((now - epochMs) / 60_000);
	if (minutes < 60) return `${Math.max(minutes, 1)} min fa`;
	if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h fa`;
	return `${Math.round(minutes / (24 * 60))} g fa`;
}

/** Recent projects first ("" location), then the filesystem from `home` to pick any other folder. */
export function projectsSource(sessions = sessionsDir(), home = homedir()): PickerSource {
	const folders = dirsSource(home);
	return {
		start: "",
		list: (location) =>
			location === ""
				? [
						...readRecentProjects(sessions).map((project) => ({ value: project.path, label: tildify(project.path), description: ago(project.lastUsed), enter: project.path })),
						{ value: home, label: `Sfoglia ${tildify(home)}/`, description: "scegli un'altra cartella", enter: home },
					]
				: folders.list(location),
		parent: (location) => (location === "" ? undefined : location === "/" ? "" : dirname(location)),
		describe: (location) => (location === "" ? "Progetti recenti" : folders.describe!(location)),
		preview: (item) => previewPath(item.value, 30),
	};
}

// ---- Plain lists --------------------------------------------------------------------------------------------

/** A fixed list given by the caller (intents, options, ...). */
export function listSource(items: PickerItem[], preview?: (item: PickerItem) => string | undefined): PickerSource {
	return { start: "", list: () => items, preview };
}

