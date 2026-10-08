#!/usr/bin/env bash
# Installa pi-claude su questa macchina: Pi, bridge claude-code, hook di sicurezza, estensioni di pi-full.
# Idempotente: si può rilanciare dopo ogni aggiornamento della repo (git pull / git checkout <tag>).
#
# Uso: ./install.sh [--no-extras]
#   --no-extras  niente pi-full (web, todo, domande, subagent, team)
# Su un altro PC: pi install git:github.com/FedericoPartesano/pi-claude, poi questo script dalla copia installata
# (~/.pi/agent/git/github.com/FedericoPartesano/pi-claude/install.sh). Su Windows nativo: node .../scripts/setup.mjs
set -euo pipefail
export NPM_CONFIG_UPDATE_NOTIFIER=false

PI_VERSION="1.0.4"
EXTRA_PACKAGES=(
  "npm:pi-web-access@0.31.0"
  "npm:@juicesharp/rpiv-todo@2.11.0"
  "npm:@juicesharp/rpiv-ask-user-question@2.11.0"
)

REPO="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
AGENT="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
BIN_DIR="${PI_CLAUDE_BIN_DIR:-$HOME/.local/bin}"
EXTRAS=1

for arg in "$@"; do
  case "$arg" in
    --no-extras) EXTRAS=0 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opzione sconosciuta: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31mErrore:\033[0m %s\n' "$*" >&2; exit 1; }

# Crea (o aggiorna) un symlink senza mai sovrascrivere un file vero: quello viene spostato in .bak.
link() {
  local target="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    mv "$dest" "$dest.bak.$(date +%Y%m%d%H%M%S)"
    warn "$dest esisteva: spostato in backup"
  fi
  ln -sfn "$target" "$dest"
  ok "$dest → $target"
}

step "Requisiti"
command -v node >/dev/null || die "Node non trovato: installa Node ≥ 22.19 (consigliato nvm)."
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)' \
  || die "Node $(node --version) troppo vecchio: serve ≥ 22.19."
ok "node $(node --version)"
command -v npm >/dev/null || die "npm non trovato."
command -v claude >/dev/null \
  || die "CLI Claude Code non trovata: installala (https://docs.claude.com/claude-code) e fai login con l'abbonamento (claude → /login)."
ok "claude $(claude --version 2>/dev/null | head -1)"

step "Pi $PI_VERSION"
current="$(pi --version 2>/dev/null || true)"
if [ -z "$current" ]; then
  npm install -g "@earendil-works/pi-coding-agent@$PI_VERSION" --no-audit --no-fund --loglevel=error
  ok "installato"
elif [ "$current" != "$PI_VERSION" ]; then
  warn "trovato Pi $current, la repo è testata con $PI_VERSION (npm i -g @earendil-works/pi-coding-agent@$PI_VERSION)"
else
  ok "già presente"
fi
PI_PKG="$(npm root -g)/@earendil-works/pi-coding-agent"
[ -d "$PI_PKG/examples/extensions" ] || die "Pi installato ma esempi non trovati in $PI_PKG."

# Installed from GitHub (pi install git:..., the copy lives under $AGENT/git/): Pi already registered the package and
# installed its dependencies. A working copy: the folder itself is the package (edits show at once).
case "$REPO/" in
  "$AGENT/git/"*) FROM_GIT=1 ;;
  *) FROM_GIT=0 ;;
esac

step "Dipendenze"
if [ "$FROM_GIT" = 0 ]; then
  (cd "$REPO" && npm install --no-audit --no-fund --loglevel=error)
  ok "dipendenze del pacchetto"
else
  ok "installate da pi install"
fi

if [ "$EXTRAS" = 1 ]; then
  step "Pacchetti extra (solo in pi-full)"
  for pkg in "${EXTRA_PACKAGES[@]}"; do
    pi install "$pkg" >/dev/null
    ok "$pkg"
  done
  # Loaded only by pi-full: no extensions from them in plain pi.
  node - "$AGENT/settings.json" "${EXTRA_PACKAGES[@]}" <<'JS'
const fs = require("fs");
const [file, ...extras] = process.argv.slice(2);
const s = JSON.parse(fs.readFileSync(file, "utf8"));
s.packages = (s.packages ?? []).map((p) => {
  const source = typeof p === "string" ? p : p.source;
  return extras.includes(source) ? { ...(typeof p === "string" ? { source } : p), extensions: [] } : p;
});
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
JS
fi

step "Pacchetto pi-claude e impostazioni"
# The dangerous-command confirmation is in pi-ui (status bar): the old permission-gate would ask twice.
if [ -L "$AGENT/extensions/permission-gate.ts" ] && [ "$(readlink "$AGENT/extensions/permission-gate.ts")" = "$PI_PKG/examples/extensions/permission-gate.ts" ]; then
  rm "$AGENT/extensions/permission-gate.ts"
  ok "permission-gate sostituito dalla conferma di pi-ui"
fi
# protected-paths is part of the package now: the old link would load it twice.
if [ -L "$AGENT/extensions/protected-paths.ts" ]; then
  rm "$AGENT/extensions/protected-paths.ts"
  ok "vecchio link di protected-paths rimosso (ora nel pacchetto)"
fi
[ -f "$AGENT/settings.json" ] && cp "$AGENT/settings.json" "$AGENT/settings.json.bak-install"
# Defaults (claude-code/sonnet, Neon Night, compaction, Ctrl+V for images), one package entry instead of the old
# per-file registrations. The same script runs on native Windows: node scripts/setup.mjs
node "$REPO/scripts/setup.mjs"

if [ "$EXTRAS" = 1 ]; then
  step "pi-full"
  mkdir -p "$AGENT/optional-extensions"
  rm -rf "$AGENT/optional-extensions/subagent"
  cp -r "$PI_PKG/examples/extensions/subagent" "$AGENT/optional-extensions/subagent"
  ok "estensione subagent"
  link "$REPO/bin/pi-full" "$BIN_DIR/pi-full"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) warn "$BIN_DIR non è nel PATH: aggiungi  export PATH=\"\$HOME/.local/bin:\$PATH\"  al tuo ~/.bashrc" ;;
  esac
fi

# /custom-reload di pi-ui: la funzione pi della shell riapre Pi sulla stessa conversazione dopo il riavvio.
LOOP_LINE="source \"$REPO/pi-ui/shell/pi-custom-reload.sh\"  # pi-ui: /custom-reload"
# Earlier versions sourced pi-riavvia.sh: replace that line instead of adding a second one.
[ -f "$HOME/.bashrc" ] && sed -i "s#.*pi-ui/shell/pi-riavvia\.sh.*#$LOOP_LINE#" "$HOME/.bashrc"
if [ -f "$HOME/.bashrc" ] && ! grep -qF "pi-ui/shell/pi-custom-reload.sh" "$HOME/.bashrc"; then
  printf '\n%s\n' "$LOOP_LINE" >> "$HOME/.bashrc"
  ok "/custom-reload: funzione pi aggiunta a ~/.bashrc (apri un nuovo terminale)"
fi

step "Fatto"
echo "    pi          → Pi minimale su claude-code/sonnet (abbonamento Claude)"
[ "$EXTRAS" = 1 ] && echo "    pi-full     → + web, todo, domande, subagent, team (pi-full --pick: scegli prima il progetto)"
echo "    Alt+A       → inserisci file o cartelle del progetto nel prompt (anche /pick)"
echo "    chat        → Neon Night: barra di stato, passi compatti, /img, suggerimenti 1-4, Alt+S o /pannello (PI_UI=off per spegnerla)"
echo "    /intent     → intervista e scrive intents/<data>-<slug>.md"
echo "    /goal       → lavora in autonomia fino all'obiettivo (anche @intents/...; senza argomenti: scegli un intent)"
echo "    /dream      → consolida le sessioni passate in .pi/memory/ (memoria profonda: tutto su disco, richiamo solo dei ricordi pertinenti); /ricorda li cerca"
echo "    /loop       → ripete un prompt (/loop 5m ..., --when \"cmd\" chiama il modello solo se il comando fallisce)"
echo "    Se claude non è ancora loggato: lancia 'claude' e poi /login."
