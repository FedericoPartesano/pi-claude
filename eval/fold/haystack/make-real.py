#!/usr/bin/env python3
"""Append the hand-written quiz to a real-session haystack. usage: python3 -I make-real.py <out dir of gen-real.py>
Reads <out>/quiz.json ({"abstain": regex or null, "quizzes": [[{"name", "ask", "re", "kind", "old"?}, ...], [...]]},
re "ABSTAIN" for questions never answered in the log) and writes <out>/scenario.txt and <out>/truth.json for score.mjs.
"""
import json, os, sys

out = sys.argv[1]
quiz = json.load(open(os.path.join(out, "quiz.json")))
ABSTAIN = (r"non dett|non (lo )?so|non (è|e') (mai )?(stat[oa] )?(dett|indicat|menzionat|fornit|specificat|comunicat)|"
           r"non (risulta|compare)|nessun|mai (dett|indicat|menzionat)|sconosciut|n/d|not (known|provided|mentioned)")


def ask(qs):
    asks = " ".join(f"{i + 1}) {q['ask']}" for i, q in enumerate(qs))
    return ("Domande sul registro che hai letto. Senza rileggere file (vietati read, bash, grep e search sui file; i tool di "
            "contesto sono ammessi), rispondi in un blocco \"RISPOSTE:\" con valori esatti, una riga per numero; se un valore "
            f"non compare nel registro scrivi \"non detto\": {asks}")


head = open(os.path.join(out, "scenario.head.txt")).read().rstrip("\n")
q1, q2 = quiz["quizzes"]
with open(os.path.join(out, "scenario.txt"), "w") as f:
    f.write("# Real-session haystack (gen-real.py + make-real.py); paths relative to RUN_CWD.\n")
    f.write(head + "\n" + ask(q1) + "\nRESTART\n" + ask(q2) + "\n")
truth = {"abstain": quiz.get("abstain") or ABSTAIN, "assistantTurn": -1,
         "quizzes": [[{k: q[k] for k in ("name", "re", "kind", "old") if k in q} for q in qs] for qs in (q1, q2)]}
json.dump(truth, open(os.path.join(out, "truth.json"), "w"), indent=1, ensure_ascii=False)
print(len(head.splitlines()) + 2, "turns,", sum(len(q) for q in (q1, q2)), "questions")
