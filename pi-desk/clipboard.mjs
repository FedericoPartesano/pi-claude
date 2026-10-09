/**
 * An image on the clipboard, for pasting into the chat. Electron's clipboard covers Linux, macOS and Windows; under WSL
 * the Windows clipboard reaches Linux apps as text only (WSLg), so the picture is read from Windows with PowerShell.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

export const POWERSHELL = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";

// One PNG as base64 on stdout, nothing when the clipboard holds no image. -STA: the clipboard API needs it.
export const READ_IMAGE = [
	"Add-Type -AssemblyName System.Windows.Forms, System.Drawing",
	"$img = [System.Windows.Forms.Clipboard]::GetImage()",
	"if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($ms.ToArray()) }",
].join("; ");

/** run(command, args) → stdout; injectable for tests. */
export function windowsClipboardImage(run = runFile, powershell = POWERSHELL) {
	if (!existsSync(powershell)) return Promise.resolve(undefined);
	return run(powershell, ["-NoProfile", "-NonInteractive", "-STA", "-Command", READ_IMAGE]).then(
		(out) => {
			const data = out.replace(/\s+/g, "");
			return /^[A-Za-z0-9+/]+=*$/.test(data) && data.length > 100 ? { data, mimeType: "image/png" } : undefined;
		},
		() => undefined,
	);
}

function runFile(command, args) {
	return new Promise((resolve, reject) => execFile(command, args, { timeout: 5000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout))));
}

/** The clipboard image: Electron's own first, then (WSL) Windows'. */
export async function clipboardImage(electronClipboard, wsl) {
	const image = electronClipboard?.readImage?.();
	if (image && !image.isEmpty()) return { data: image.toPNG().toString("base64"), mimeType: "image/png" };
	return wsl ? windowsClipboardImage() : undefined;
}
