# pi-ui: /custom-reload restarts Pi completely and reopens the same conversation.
# Pi writes the session and folder to reopen in $PI_UI_RESTART_FILE and quits; this loop starts it again.
# Loaded from ~/.bashrc by install.sh:  source <repo>/pi-ui/shell/pi-custom-reload.sh
# PI_CLAUDE_REPO: the pi-claude folder (derived from this file when sourced from bash or zsh).
PI_CLAUDE_REPO="$(cd "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")/../.." 2>/dev/null && pwd)"
pi() {
	# -d: modalità senza permessi (PI_YOLO=1): Pi non chiede conferma per i comandi pericolosi. Vale per questo avvio e per i riavvii.
	local args=() arg yolo="${PI_YOLO:-}"
	for arg in "$@"; do [ "$arg" = "-d" ] && yolo=1 || args+=("$arg"); done
	set -- "${args[@]}"
	local PI_YOLO="$yolo"; [ -n "$PI_YOLO" ] && export PI_YOLO
	# No automatic `npm view` update checks at startup (a monorepo made them cost ~20 s of CPU); PI_OFFLINE=0 keeps them.
	local PI_OFFLINE="${PI_OFFLINE:-1}"
	[ "$PI_OFFLINE" = 0 ] && unset PI_OFFLINE || export PI_OFFLINE
	# New chat frontend (prototype/rpc-chat) by default; `pi --classic` or PI_UI_CLASSIC=1 gives the classic TUI below.
	if ! node "$PI_CLAUDE_REPO/bin/pi.mjs" --is-classic "$@"; then
		node "$PI_CLAUDE_REPO/bin/pi.mjs" "$@"
		return $?
	fi
	local args2=() a
	for a in "$@"; do [ "$a" = "--classic" ] || args2+=("$a"); done
	set -- "${args2[@]}"
	local file="${PI_UI_RESTART_FILE:-$HOME/.pi/agent/pi-ui-restart}"
	rm -f "$file"
	PI_UI_LOOP=1 command pi "$@"
	local code=$?
	while [ -f "$file" ]; do
		local session cwd
		session="$(sed -n 's/^session=//p' "$file")"
		cwd="$(sed -n 's/^cwd=//p' "$file")"
		rm -f "$file"
		[ -n "$cwd" ] && cd "$cwd" 2>/dev/null
		if [ -n "$session" ]; then PI_UI_LOOP=1 command pi --session "$session"; else PI_UI_LOOP=1 command pi; fi
		code=$?
	done
	return $code
}
