#!/usr/bin/env python3
"""Haystack bench generator: a synthetic TypeScript project with planted values, the chat that reads it, and the truth.

usage: python3 -I eval/fold/haystack/gen.py <out dir> [files=60, at least 30] [seed=7]
Writes <out>/proj (the project, src/<area>/<name>.ts), <out>/scenario.txt (one prompt per line, for eval/fold/long.py
with RUN_CWD=<copy of proj>) and <out>/truth.json (the questions of each quiz with the expected answer).

Design after LongMemEval (Wu et al., ICLR 2025) and needle-in-a-haystack: values said by the user, a value proposed by
the assistant, knowledge updates (only the latest value is right), constants inside files read long before (asked by
name or only described in words, with look-alike decoys in other files), a bash result, and abstention questions whose
answer was never given. The two quizzes ask disjoint questions, the second one after Pi restarts with --continue, so
no answer can be copied from the previous quiz.
"""
import json, os, random, sys

out = sys.argv[1]
n_files = max(int(sys.argv[2]) if len(sys.argv) > 2 else 60, 30)
rng = random.Random(int(sys.argv[3]) if len(sys.argv) > 3 else 7)

AREAS = ["carrier", "invoice", "pallet", "route", "depot", "customs", "tracking", "label", "manifest", "fleet",
         "driver", "warehouse", "inventory", "returns", "pricing", "quote", "dispatch", "dock", "yard", "billing"]
KINDS = ["client", "service", "store", "policy", "scheduler", "validator", "mapper", "cache", "queue", "report"]
WORDS = ["batch", "retry", "window", "limit", "buffer", "weight", "volume", "slot", "lane", "zone", "shift", "token",
         "cursor", "page", "chunk", "margin", "rate", "score", "budget", "quota", "grace", "backoff", "jitter", "ttl",
         "depth", "width", "height", "count", "span", "offset", "stride", "fanout", "parallel", "lease", "epoch"]
UNITS = ["MS", "SEC", "MIN", "HOURS", "DAYS", "KG", "CM", "PCT", "COUNT", "MAX", "MIN_VALUE", "SIZE"]
VERBS = ["load", "save", "map", "check", "build", "merge", "split", "route", "price", "score", "sync", "flush",
         "plan", "assign", "release", "reserve", "match", "resolve", "collect", "dispatch"]
NOUNS = ["Shipment", "Parcel", "Pallet", "Route", "Stop", "Driver", "Vehicle", "Invoice", "Quote", "Slot", "Dock",
         "Manifest", "Label", "Return", "Depot", "Lane", "Order", "Carrier", "Customer", "Zone"]

# Planted constants: (area, kind, name, literal, question, answer regex, asked by name?)
NEEDLES = [
    ("customs", "policy", "CUSTOMS_HOLD_HOURS", "37", "CUSTOMS_HOLD_HOURS", r"\b37\b", True),
    ("label", "service", "LABEL_DPI", "406", "LABEL_DPI", r"\b406\b", True),
    ("carrier", "client", "REQUEST_DEADLINE_MS", "13_750",
     "il tempo massimo di attesa di una richiesta nel client dei corrieri", r"13[_.,]?750", False),
    ("dock", "scheduler", "SLOT_LENGTH_MIN", "25",
     "la durata di uno slot nel pianificatore delle banchine", r"\b25\b", False),
    ("fleet", "report", "FLEET_IDLE_ALERT_MIN", "23", "FLEET_IDLE_ALERT_MIN", r"\b23\b", True),
    ("manifest", "store", "MANIFEST_SIGNING_KEY_ID", '"mk-7f3a-baltic"', "MANIFEST_SIGNING_KEY_ID", r"mk-7f3a-baltic", True),
    ("pricing", "policy", "FUEL_SURCHARGE_PCT", "7.25",
     "la percentuale di sovrapprezzo carburante nel listino prezzi", r"7[.,]25", False),
    ("returns", "service", "RETURN_WINDOW_DAYS", "41",
     "quanti giorni hanno i clienti per fare un reso", r"\b41\b", False),
]
# Decoys: same unit, other files, other values, so a vague question cannot be answered by any timeout or any window.
DECOYS = ["REQUEST_TIMEOUT_MS", "SLOT_GRACE_MIN", "FUEL_INDEX_BASE", "RETURN_LABEL_DAYS", "DOCK_TURN_MIN",
          "CARRIER_RETRY_MS", "PRICE_ROUNDING_PCT", "REFUND_DELAY_DAYS"]
needle_names = {n[2] for n in NEEDLES}


def const_name(used):
    while True:
        name = f"{rng.choice(WORDS).upper()}_{rng.choice(WORDS).upper()}_{rng.choice(UNITS)}"
        if name not in used and name not in needle_names:
            used.add(name)
            return name


def literal(name):
    if name.endswith("_PCT"):
        return f"{rng.randint(1, 30)}.{rng.choice(['0', '5', '25', '75'])}"
    if rng.random() < 0.15:
        return json.dumps(f"{rng.choice(WORDS)}-{rng.randint(100, 999)}")
    v = rng.randint(2, 90_000)
    return f"{v:_}" if v >= 10_000 else str(v)


def decoy_literal(name):
    # Same scale as the planted value it imitates, so only the right file gives the right number.
    if name.endswith("_PCT"):
        return f"{rng.randint(2, 15)}.{rng.choice(['5', '75'])}"
    if name.endswith("_MS"):
        return f"{rng.randint(2_000, 30_000):_}"
    return str(rng.randint(5, 95))


def function(consts, types):
    verb, noun = rng.choice(VERBS), rng.choice(NOUNS)
    name = f"{verb}{noun}{rng.choice(['', 'Batch', 'Lane', 'Window', 'Draft', 'Plan'])}"
    t = rng.choice(types)
    c1, c2 = rng.sample(consts, 2)
    lines = [f"/** {verb.capitalize()} the {noun.lower()} records of one {rng.choice(WORDS)} using {c1}. */",
             f"export function {name}(items: readonly {t}[], options: {{ limit?: number; dryRun?: boolean }} = {{}}): {t}[] {{",
             f"\tconst limit = options.limit ?? {c1};",
             f"\tconst out: {t}[] = [];",
             "\tfor (const item of items) {"]
    for _ in range(rng.randint(3, 7)):
        f = rng.choice(["id", "weight", "zone", "createdAt", "status", "lane", "priority"])
        lines.append(rng.choice([
            f"\t\tif (item.{f} === undefined) continue;",
            f"\t\tif (out.length >= limit) break;",
            f"\t\tconst {rng.choice(WORDS)}{rng.randint(1, 9)} = Number(item.{f}) % {c2};",
            f"\t\tif (options.dryRun && item.status === \"{rng.choice(['held', 'open', 'closed', 'late'])}\") continue;",
            f"\t\t// {rng.choice(NOUNS)} {rng.choice(WORDS)} rule: keep the {rng.choice(WORDS)} below {c2}.",
        ]))
    lines += ["\t\tout.push({ ...item, status: item.status ?? \"open\" });", "\t}",
              f"\treturn out.sort((a, b) => String(a.{rng.choice(['id', 'zone', 'lane'])}).localeCompare(String(b.id)));", "}", ""]
    return lines


def module(area, kind, needle, decoy):
    used, lines = set(), []
    title = f"{area}-{kind}"
    lines += ["/**", f" * {title}: {rng.choice(VERBS)}s {area} {rng.choice(NOUNS).lower()}s for the Orbita logistics backend.",
              f" * Owned by the {area} team; see docs/{area}.md for the {rng.choice(WORDS)} rules.", " */",
              f'import {{ {rng.choice(VERBS)}{rng.choice(NOUNS)} }} from "../{rng.choice(AREAS)}/{rng.choice(AREAS)}-{rng.choice(KINDS)}.ts";',
              f'import type {{ {rng.choice(NOUNS)} }} from "../types.ts";', ""]
    consts = []
    count = 14
    slot = rng.randrange(count)
    for i in range(count):
        if needle and i == slot:
            name, value = needle[2], needle[3]
        elif decoy and i == (slot + 3) % count:
            name, value = decoy, decoy_literal(decoy)
        else:
            name = const_name(used)
            value = literal(name)
        consts.append(name)
        lines.append(f"/** {rng.choice(NOUNS)} {rng.choice(WORDS)} {rng.choice(['limit', 'default', 'threshold', 'setting'])}. */")
        lines.append(f"export const {name} = {value};")
    lines.append("")
    types = []
    for _ in range(3):
        t = f"{area.capitalize()}{rng.choice(NOUNS)}{rng.choice(['Row', 'View', 'Input', 'Event'])}"
        types.append(t)
        lines.append(f"export interface {t} {{")
        for f in ["id: string", "weight?: number", "zone?: string", "createdAt?: string", "status?: string", "lane?: number", "priority?: number"]:
            lines.append(f"\t{f};")
        lines += ["}", ""]
    numeric = [c for c in consts]
    while sum(len(l) + 1 for l in lines) < 24_000:
        lines += function(numeric, types)
    return "\n".join(lines) + "\n"


proj = os.path.join(out, "proj")
pairs = [(a, k) for a in AREAS for k in KINDS]
rng.shuffle(pairs)
needle_pairs = [(n[0], n[1]) for n in NEEDLES]
others = [p for p in pairs if p not in needle_pairs][: n_files - len(NEEDLES)]
# Needles are read early (positions 2..22 of the reading order): by the quiz they are far in the past.
order = list(others)
for pos, pair in zip([1, 3, 5, 8, 11, 14, 17, 21], needle_pairs):
    order.insert(pos, pair)
decoy_files = rng.sample([p for p in order if p not in needle_pairs], len(DECOYS))
files = []
for area, kind in order:
    needle = next((n for n in NEEDLES if (n[0], n[1]) == (area, kind)), None)
    decoy = DECOYS[decoy_files.index((area, kind))] if (area, kind) in decoy_files else None
    rel = f"src/{area}/{area}-{kind}.ts"
    os.makedirs(os.path.join(proj, "src", area), exist_ok=True)
    text = module(area, kind, needle, decoy)
    open(os.path.join(proj, rel), "w").write(text)
    files.append((rel, text))
total_lines = sum(t.count("\n") for _, t in files)

R = "Leggi per intero con il tool read {} (se troncato continua con offset fino alla fine). Poi scrivi una sola riga di sintesi, nient'altro."
user = [
    (0, "Inizio un lavoro lungo sul backend Orbita. Annota per dopo: il cliente è Ferrovie Nordiche Srl, il ticket è ORB-5170, la referente è Marta Lindqvist. Rispondi solo: ok."),
    (4, "Altra nota: il budget approvato è 18.400 euro e il server di staging ascolta sulla porta 8817. Rispondi solo: ok."),
    (9, "Decisione presa con Marta: niente Redis, le code le facciamo con Postgres LISTEN/NOTIFY. La scadenza è martedì 15 dicembre. Rispondi solo: ok."),
    (13, "Proponi un nome in codice di una sola parola per questo progetto: scegline uno, rispondi solo con il nome."),
    (19, "Esegui con bash: wc -l src/*/*.ts | tail -1 e rispondi solo con il numero."),
    (int(n_files * 0.7), "Aggiornamento: la porta di staging è cambiata, ora è 9124. E la scadenza è slittata a giovedì 7 gennaio. Rispondi solo: ok."),
]
prompts = []
for i, (rel, _) in enumerate(files):
    for at, text in user:
        if at == i:
            prompts.append(text)
    prompts.append(R.format(rel))

ABSTAIN = r"non dett|non (lo )?so|non (è|e') (mai )?(stat[oa] )?(dett|indicat|menzionat|fornit|specificat|comunicat)|non (me l'hai|mi hai|hai) (mai )?(dett|dat|fornit|indicat|comunicat)|non (risulta|compare|ho (questa|quest)|ho (l'|il |un )?(informazion|dat))|nessun|mai (dett|indicat|menzionat)|sconosciut|n/d|not (known|provided|mentioned)"
q1 = [
    ("ticket", "il ticket", r"ORB-?5170", "user"),
    ("referente", "la referente del cliente", r"Marta Lindqvist", "user"),
    ("porta staging", "la porta attuale del server di staging", r"\b9124\b", "update"),
    ("CUSTOMS_HOLD_HOURS", "CUSTOMS_HOLD_HOURS", r"\b37\b", "file-name"),
    ("LABEL_DPI", "LABEL_DPI", r"\b406\b", "file-name"),
    ("deadline corrieri", NEEDLES[2][4], NEEDLES[2][5], "file-vague"),
    ("slot banchine", NEEDLES[3][4], NEEDLES[3][5], "file-vague"),
    ("righe wc", "il totale delle righe contato con bash", rf"\b{total_lines:,}\b".replace(",", "[.,]?"), "tool"),
    ("nome in codice", "il nome in codice che hai proposto", "ASSISTANT:13", "assistant"),
    ("telefono Marta", "il numero di telefono di Marta", "ABSTAIN", "abstain"),
]
q2 = [
    ("cliente", "il cliente", r"Ferrovie Nordiche", "user"),
    ("budget", "il budget approvato", r"18[.,]?400", "user"),
    ("code", "cosa abbiamo deciso per le code", r"LISTEN|NOTIFY|Postgres", "user"),
    ("scadenza", "la scadenza attuale", r"7 gennaio", "update"),
    ("FLEET_IDLE_ALERT_MIN", "FLEET_IDLE_ALERT_MIN", r"\b23\b", "file-name"),
    ("MANIFEST_SIGNING_KEY_ID", "MANIFEST_SIGNING_KEY_ID", r"mk-7f3a-baltic", "file-name"),
    ("sovrapprezzo carburante", NEEDLES[6][4], NEEDLES[6][5], "file-vague"),
    ("giorni reso", NEEDLES[7][4], NEEDLES[7][5], "file-vague"),
    ("versione Postgres", "la versione di Postgres che abbiamo concordato", "ABSTAIN", "abstain"),
]


# Superseded values: an answer that gives only these is stale, not just wrong.
OLD = {"porta staging": r"\b8817\b", "scadenza": r"15 dicembre"}


def quiz(qs):
    asks = " ".join(f"{i + 1}) {q[1]}" for i, q in enumerate(qs))
    return ("Senza rileggere file (vietati read, bash, grep e search sui file; i tool di contesto sono ammessi), rispondi in un "
            f"blocco \"RISPOSTE:\" con valori esatti, una riga per numero; se un valore non ti è mai stato dato scrivi \"non detto\": {asks}")


prompts += [quiz(q1), "RESTART", quiz(q2)]
with open(os.path.join(out, "scenario.txt"), "w") as f:
    f.write("# Haystack chat generated by eval/fold/haystack/gen.py; paths are relative to RUN_CWD.\n")
    f.write("\n".join(prompts) + "\n")
assistant_turn = next(i for i, p in enumerate([p for p in prompts if p != "RESTART"]) if p.startswith("Proponi un nome")) + 1
truth = {"files": len(files), "chars": sum(len(t) for _, t in files), "lines": total_lines, "abstain": ABSTAIN,
         "assistantTurn": assistant_turn,
         "quizzes": [[{"name": q[0], "re": q[2], "kind": q[3], **({"old": OLD[q[0]]} if q[0] in OLD else {})} for q in qs]
                     for qs in (q1, q2)]}
json.dump(truth, open(os.path.join(out, "truth.json"), "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: truth[k] for k in ("files", "chars", "lines", "assistantTurn")}), len([p for p in prompts if p != "RESTART"]), "turns")
