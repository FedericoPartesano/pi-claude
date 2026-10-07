/** Tells the user a long turn is over: terminal bell and a Windows notification (from WSL) when available. */
import type { Mode } from "./status.ts";

export const NOTIFY_AFTER_SECONDS = 30;

export const shouldNotify = (seconds: number, mode: Mode) => seconds >= NOTIFY_AFTER_SECONDS && (mode === "done" || mode === "stopped");

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;

/** PowerShell script for a toast with Windows' own API (no modules to install). */
export function toastScript(title: string, body: string): string {
	return [
		"[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
		"$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
		`$xml.GetElementsByTagName('text').Item(0).AppendChild($xml.CreateTextNode(${quote(title)})) > $null`,
		`$xml.GetElementsByTagName('text').Item(1).AppendChild($xml.CreateTextNode(${quote(body)})) > $null`,
		"$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
		"[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))",
	].join("; ");
}
