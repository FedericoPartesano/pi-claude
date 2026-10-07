#!/usr/bin/env bash
# Installa pi-claude su questa macchina: Pi, bridge claude-code, hook di sicurezza, estensioni di pi-full.
# Idempotente: si può rilanciare dopo ogni aggiornamento della repo (git pull / git checkout <tag>).
#
# Uso: ./install.sh [--no-extras] [--no-hooks]
#   --no-extras  niente pi-full (web, todo, domande, subagent, team)
#   --no-hooks   niente hook protected-paths (la conferma dei comandi pericolosi è in pi-ui: PI_UI_PERMISSION=0 la spegne)
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
BIN_DIR="$HOME/.local/bin"
EXTRAS=1
HOOKS=1

for arg in "$@"; do
  case "$arg" in
    --no-extras) EXTRAS=0 ;;
    --no-hooks) HOOKS=0 ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

# Esegue `npm ci` solo se node_modules manca o è più vecchio del lockfile.
deps() {
  local dir="$1"
  if [ ! -f "$dir/node_modules/.package-lock.json" ] || [ "$dir/package-lock.json" -nt "$dir/node_modules/.package-lock.json" ]; then
    (cd "$dir" && npm ci --no-audit --no-fund --loglevel=error)
  fi
  ok "dipendenze di $(basename "$dir")"
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

step "Dipendenze dei pacchetti"
deps "$REPO/pi-claude-code"
deps "$REPO/pi-picker"
deps "$REPO/pi-memory"
deps "$REPO/pi-ui"
[ "$EXTRAS" = 1 ] && deps "$REPO/pi-team"

step "Pacchetti Pi"
pi install "$REPO/pi-claude-code" >/dev/null
ok "pi-claude-code"
pi install "$REPO/pi-picker" >/dev/null
ok "pi-picker (Alt+A, /pick)"
pi install "$REPO/pi-ui" >/dev/null
ok "pi-ui (chat Neon Night: barra di stato, prompt, footer)"
if [ "$EXTRAS" = 1 ]; then
  for pkg in "${EXTRA_PACKAGES[@]}"; do
    pi install "$pkg" >/dev/null
    ok "$pkg"
  done
fi

step "Impostazioni ($AGENT/settings.json)"
# Default claude-code/sonnet solo se l'utente non ha già scelto altro; i pacchetti extra si caricano solo in pi-full.
EXTRAS="$EXTRAS" node - "$AGENT/settings.json" "${EXTRA_PACKAGES[@]}" <<'JS'
const fs = require("fs");
const [file, ...extras] = process.argv.slice(2);
const s = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
const before = JSON.stringify(s);
s.defaultProvider ??= "claude-code";
s.defaultModel ??= "sonnet";
s.defaultThinkingLevel ??= "medium";
// pi-ui: Neon Night theme and no resource listing at startup, unless the user chose otherwise.
s.theme ??= "neon-night";
s.quietStartup ??= true;
// Thinking folded to one line ("◇ penso ▸"): Ctrl+T opens it, the status bar shows it live.
s.hideThinkingBlock ??= true;
if (process.env.EXTRAS === "1") {
  s.packages = (s.packages ?? []).map((p) => {
    const source = typeof p === "string" ? p : p.source;
    return extras.includes(source) ? { ...(typeof p === "string" ? { source } : p), extensions: [] } : p;
  });
}
if (JSON.stringify(s) !== before) {
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-install`);
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
}
console.log(`    provider ${s.defaultProvider}/${s.defaultModel}, thinking ${s.defaultThinkingLevel}, tema ${s.theme}`);
JS

# La conferma dei comandi pericolosi ora è in pi-ui (nella barra di stato): il vecchio permission-gate chiederebbe due volte.
if [ -L "$AGENT/extensions/permission-gate.ts" ] && [ "$(readlink "$AGENT/extensions/permission-gate.ts")" = "$PI_PKG/examples/extensions/permission-gate.ts" ]; then
  rm "$AGENT/extensions/permission-gate.ts"
  ok "permission-gate sostituito dalla conferma di pi-ui"
fi

if [ "$HOOKS" = 1 ]; then
  step "Hook di sicurezza"
  link "$REPO/extensions/protected-paths.ts" "$AGENT/extensions/protected-paths.ts"
fi

step "Comandi"
# intent.ts importa moduli vicini (./work-advisor.ts → ../pi-team): Pi non segue i symlink per gli import
# relativi, quindi si registra il percorso reale in settings.json invece di un link in extensions/.
[ -L "$AGENT/extensions/intent.ts" ] && rm "$AGENT/extensions/intent.ts"
node - "$AGENT/settings.json" "$REPO/extensions/intent.ts" <<'JS'
const fs = require("fs");
const [file, extension] = process.argv.slice(2);
const s = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
s.extensions ??= [];
if (!s.extensions.includes(extension)) {
  s.extensions.push(extension);
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
}
JS
ok "intent ($REPO/extensions/intent.ts)"
# loop.ts importa ./intent.ts e ../pi-team: stesso motivo, percorso reale in settings.json.
node - "$AGENT/settings.json" "$REPO/extensions/loop.ts" <<'JS'
const fs = require("fs");
const [file, extension] = process.argv.slice(2);
const s = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
s.extensions ??= [];
if (!s.extensions.includes(extension)) {
  s.extensions.push(extension);
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
}
JS
ok "loop ($REPO/extensions/loop.ts)"
# goal.ts importa ./intent.ts: stesso motivo, percorso reale in settings.json.
[ -L "$AGENT/extensions/goal.ts" ] && rm "$AGENT/extensions/goal.ts"
node - "$AGENT/settings.json" "$REPO/extensions/goal.ts" <<'JS'
const fs = require("fs");
const [file, extension] = process.argv.slice(2);
const s = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
s.extensions ??= [];
if (!s.extensions.includes(extension)) {
  s.extensions.push(extension);
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
}
JS
ok "goal ($REPO/extensions/goal.ts)"
# memory.ts importa ./memory-core.ts e ../pi-memory/src (embedding locali, dipendenze in pi-memory/node_modules):
# stesso motivo, percorso reale in settings.json.
node - "$AGENT/settings.json" "$REPO/extensions/memory.ts" <<'JS'
const fs = require("fs");
const [file, extension] = process.argv.slice(2);
const s = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
s.extensions ??= [];
if (!s.extensions.includes(extension)) {
  s.extensions.push(extension);
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
}
JS
ok "memoria ($REPO/extensions/memory.ts)"

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
