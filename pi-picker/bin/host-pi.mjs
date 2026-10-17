/**
 * Loaded with `node --import` before the standalone pickers (pick-session.ts, pick-project.ts).
 *
 * The pickers import @earendil-works/* packages. Inside Pi they come from Pi itself; standalone they used to come from
 * pi-picker/node_modules (devDependencies), which is not installed by install.sh and can vanish — then
 * `pi-full --resume` and `pi-full --pick` died with ERR_MODULE_NOT_FOUND before showing anything.
 *
 * This hook keeps the normal resolution and, only when an @earendil-works/* package is not found, resolves it again
 * from the Pi that is installed (PI_HOST_DIR, else the global npm folder next to this Node). So the pickers use the
 * same Pi version that will open the session.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

function hostPackageJson() {
	const candidates = [
		process.env.PI_HOST_DIR,
		join(dirname(process.execPath), "..", "lib", "node_modules", "@earendil-works", "pi-coding-agent"),
	];
	for (const dir of candidates) {
		if (dir && existsSync(join(dir, "package.json"))) return pathToFileURL(join(dir, "package.json")).href;
	}
	return undefined;
}

const hostParent = hostPackageJson();

registerHooks({
	resolve(specifier, context, nextResolve) {
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			if (!hostParent || !specifier.startsWith("@earendil-works/") || error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
			return nextResolve(specifier, { ...context, parentURL: hostParent });
		}
	},
});
