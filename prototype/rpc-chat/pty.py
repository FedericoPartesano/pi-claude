#!/usr/bin/env python3 -I
"""Drive chat.mjs in a pty and print the final screen text.
Usage: pty.py [--fake script.jsonl] [--cols 100] [--rows 30] [--wait 2] [--exit N --err TEXT] STEP... -- [chat args]
STEP: text to type, or `key:down|up|enter|esc|tab|ctrl-c|ctrl-d`, or `sleep:SECONDS`. Env PROTO_DUMP is set to a temp file."""
import os, pty, select, struct, fcntl, termios, sys, time, tempfile, re
here = os.path.dirname(os.path.abspath(__file__))
a = sys.argv[1:]; opt = {"cols": "100", "rows": "30", "wait": "2"}; steps = []; chat = []
while a:
    x = a.pop(0)
    if x == "--": chat = a; break
    if x.startswith("--") and x[2:] in ("fake", "cols", "rows", "wait", "exit", "err"): opt[x[2:]] = a.pop(0)
    else: steps.append(x)
KEYS = {"down": b"\x1b[B", "up": b"\x1b[A", "enter": b"\r", "esc": b"\x1b", "tab": b"\t", "ctrl-c": b"\x03", "ctrl-d": b"\x04"}
dump = tempfile.mktemp(suffix=".txt")
env = dict(os.environ, TERM="xterm-256color", PROTO_DUMP=dump)
if "fake" in opt or "exit" in opt:
    env["PATH"] = os.path.join(here, "fake") + os.pathsep + env["PATH"]
    if "fake" in opt: env["FAKEPI_SCRIPT"] = opt["fake"]
    if "exit" in opt: env["FAKEPI_EXIT"] = opt["exit"]
    if "err" in opt: env["FAKEPI_ERR"] = opt["err"]
pid, fd = pty.fork()
if pid == 0:
    os.execvpe("node", ["node", os.path.join(here, "chat.mjs"), *chat], env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", int(opt["rows"]), int(opt["cols"]), 0, 0))
raw = b""; dead = False
def rd(t):
    global raw, dead
    end = time.time() + t
    while time.time() < end and not dead:
        r, _, _ = select.select([fd], [], [], .1)
        if r:
            try: raw += os.read(fd, 1 << 16)
            except OSError: dead = True
rd(float(opt["wait"]))
for s in steps:
    if s.startswith("sleep:"): rd(float(s[6:])); continue
    try: os.write(fd, KEYS[s[4:]] if s.startswith("key:") else s.encode())
    except OSError: break
    rd(.6)
rd(.5)
if not dead:
    try: os.write(fd, b"\x03"); os.write(fd, b"\x03")
    except OSError: pass
    rd(.8)
try: print(open(dump).read()); os.unlink(dump)
except OSError: print(re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07", "", raw.decode("utf8", "ignore"))[-3000:])
