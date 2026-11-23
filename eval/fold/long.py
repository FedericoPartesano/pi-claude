#!/usr/bin/env python3
"""Long-chat bench: one `pi --mode rpc` process (as in the TUI) fed the prompts of a scenario file in order.

usage: python3 -I eval/fold/long.py <label> <scenario> [pi args...]
Scenario: one prompt per line; `{R}` becomes the repo path; a line `RESTART` closes Pi and starts a new process with
`--continue` on the same session (the "come back later" case); `#` lines are comments.
Output in $OUT/<label> (default /tmp/bc-bench): events.jsonl (every record with `_t`, ms since start), spawns.log
(through the `claude` shim in this folder), stderr.log, turns.tsv (turn, seconds, prompt head).
"""
import json, os, subprocess, sys, time

here = os.path.dirname(os.path.abspath(__file__))
repo = os.path.dirname(os.path.dirname(here))
label, scenario, extra = sys.argv[1], sys.argv[2], sys.argv[3:]
out = os.path.join(os.environ.get("OUT", "/tmp/bc-bench"), label)
os.makedirs(os.path.join(out, "sess"), exist_ok=True)
for name in ("events.jsonl", "spawns.log", "stderr.log", "turns.tsv"):
    open(os.path.join(out, name), "w").close()
env = dict(os.environ, PATH=here + ":" + os.environ["PATH"], SHIM_LOG=os.path.join(out, "spawns.log"))
t0 = time.time()
events = open(os.path.join(out, "events.jsonl"), "a")
stderr = open(os.path.join(out, "stderr.log"), "a")
turns = open(os.path.join(out, "turns.tsv"), "a")


def start(cont):
    args = ["pi", "--mode", "rpc", "--model", "haiku", "--session-dir", os.path.join(out, "sess"), *extra]
    if cont:
        args.append("--continue")
    return subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr, env=env,
                            cwd=os.environ.get("RUN_CWD", "/tmp/bc-try"))


def send(proc, record):
    proc.stdin.write(json.dumps(record).encode() + b"\n")
    proc.stdin.flush()


def run(proc, n, prompt):
    send(proc, {"id": f"p{n}", "type": "prompt", "message": prompt})
    began = time.time()
    while True:
        line = proc.stdout.readline()
        if not line:
            raise SystemExit(f"pi exited during turn {n}")
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        rec["_t"] = int((time.time() - t0) * 1000)
        events.write(json.dumps(rec, ensure_ascii=False) + "\n")
        kind = rec.get("type")
        if kind == "extension_ui_request" and rec.get("method") in ("select", "confirm", "input", "editor"):
            send(proc, {"type": "extension_ui_response", "id": rec["id"], "cancelled": True})
        elif kind == "response" and rec.get("id") == f"p{n}" and (not rec.get("success") or rec.get("data", {}).get("disposition") == "handled"):
            break
        elif kind == "agent_settled":
            break
    turns.write(f"{n}\t{time.time() - began:.1f}\t{prompt[:60]}\n")
    turns.flush()
    events.flush()


def stop(proc):
    proc.stdin.close()
    try:
        proc.wait(timeout=120)
    except subprocess.TimeoutExpired:
        proc.kill()


proc, n = start(False), 0
for raw in open(scenario, encoding="utf-8"):
    line = raw.rstrip("\n").replace("{R}", repo)
    if not line.strip() or line.startswith("#"):
        continue
    if line == "RESTART":
        stop(proc)
        proc = start(True)
        continue
    n += 1
    run(proc, n, line)
stop(proc)
print(f"exit 0 turns {n} seconds {time.time() - t0:.0f}")
