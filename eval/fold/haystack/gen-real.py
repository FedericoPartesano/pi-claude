#!/usr/bin/env python3
"""Real-session haystack: turns a past Pi session into a log the bench chat reads in order, nothing re-executed.

usage: python3 -I eval/fold/haystack/gen-real.py <session.jsonl> <out dir> [max chars=2_500_000] [chunk chars=25_000]
Writes <out>/proj/log/NNNN.md (the session rendered as text: user messages, assistant text, tool calls with short
arguments and trimmed results; no thinking, no images), <out>/episodes.tsv (episode index, chunk, first user line) to
pick facts from, and <out>/scenario.head.txt (one read per chunk). The quiz and truth.json are written by hand per
session (see quiz.example.json) and appended by make-real.py, because the questions must be vague and only a person
can check that the answer is stated exactly once in the log. Session content stays under <out>, outside the repo.
"""
import json, os, sys

src, out = sys.argv[1], sys.argv[2]
max_chars = int(sys.argv[3]) if len(sys.argv) > 3 else 2_500_000
chunk_chars = int(sys.argv[4]) if len(sys.argv) > 4 else 25_000
ARG_CHARS, RESULT_CHARS = 400, 3_000


def text_of(content):
    if isinstance(content, str):
        return content
    return "\n".join(c.get("text", "") for c in content or [] if c.get("type") == "text")


def trim(s, n):
    return s if len(s) <= n else s[: n // 2] + f"\n[… {len(s) - n} caratteri omessi …]\n" + s[-n // 2:]


episodes, cur = [], None
for line in open(src):
    e = json.loads(line)
    if e.get("type") != "message":
        continue
    m = e["message"]
    role = m.get("role")
    if role == "user":
        t = text_of(m.get("content")).strip()
        if not t:
            continue
        cur = [f"## Utente\n{t}\n"]
        episodes.append(cur)
    elif cur is None:
        continue
    elif role == "assistant":
        for c in m.get("content") or []:
            if c.get("type") == "text" and c["text"].strip():
                cur.append(f"## Assistente\n{c['text'].strip()}\n")
            elif c.get("type") == "toolCall":
                cur.append(f"### tool {c.get('name')} {trim(json.dumps(c.get('arguments'), ensure_ascii=False), ARG_CHARS)}\n")
    elif role == "toolResult":
        t = text_of(m.get("content")).strip()
        if t:
            cur.append("```\n" + trim(t, RESULT_CHARS) + "\n```\n")

# Pack episodes into chunks; a chunk closes at an episode boundary once it passes chunk_chars, long episodes split.
chunks, buf, index, total = [], "", [], 0
for i, ep in enumerate(episodes):
    if total >= max_chars:
        break
    first = ep[0].splitlines()[1][:120] if len(ep[0].splitlines()) > 1 else ""
    index.append((i, len(chunks) + (1 if buf and len(buf) >= chunk_chars else 0), first))
    for part in ep:
        if len(buf) >= chunk_chars and part.startswith("## Utente"):
            chunks.append(buf); buf = ""
        if len(buf) + len(part) > chunk_chars * 1.6:
            chunks.append(buf); buf = ""
        buf += part + "\n"
        total += len(part)
if buf:
    chunks.append(buf)

log = os.path.join(out, "proj", "log")
os.makedirs(log, exist_ok=True)
for n, c in enumerate(chunks, 1):
    open(os.path.join(log, f"{n:04d}.md"), "w").write(f"# Registro di una sessione di lavoro passata, parte {n} di {len(chunks)}\n\n{c}")
with open(os.path.join(out, "episodes.tsv"), "w") as f:
    for i, ch, first in index:
        f.write(f"{i}\t{ch + 1}\t{first}\n")
R = ("Leggi per intero con il tool read log/{:04d}.md (registro di una sessione di lavoro passata; se troncato continua con "
     "offset fino alla fine). Poi scrivi una sola riga di sintesi, nient'altro.")
with open(os.path.join(out, "scenario.head.txt"), "w") as f:
    f.write("\n".join(R.format(n) for n in range(1, len(chunks) + 1)) + "\n")
print(json.dumps({"episodes": len(index), "chunks": len(chunks), "chars": sum(len(c) for c in chunks)}))
