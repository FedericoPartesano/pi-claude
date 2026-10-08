# pi-ui: /custom-reload restarts Pi completely and reopens the same conversation.
# Pi writes the session and folder to reopen in $PI_UI_RESTART_FILE and quits; this loop starts it again.
# Loaded from ~/.bashrc by install.sh:  source <repo>/pi-ui/shell/pi-custom-reload.sh
pi() {
	# No automatic `npm view` update checks at startup (a monorepo made them cost ~20 s of CPU); PI_OFFLINE=0 keeps them.
	local PI_OFFLINE="${PI_OFFLINE:-1}"
	[ "$PI_OFFLINE" = 0 ] && unset PI_OFFLINE || export PI_OFFLINE
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
