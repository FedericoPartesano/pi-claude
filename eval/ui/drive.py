import os, pty, sys, time, select, struct, fcntl, termios, signal, json
mode = sys.argv[1]  # label
prompt = sys.argv[2]
secs = float(sys.argv[3])
env = dict(os.environ, TERM="xterm-256color")
NOPROF = os.environ.get("NOPROF") == "1"   # no profiler: CPU is read from /proc (whole process tree)
if os.environ.get("PROG"):   # custom client (e.g. prototype/rpc-chat/chat.mjs)
    prog = os.environ["PROG"].split()
    prof = [] if NOPROF else ["--cpu-prof", f"--cpu-prof-dir=/tmp/uiprof/out/{mode}", "--cpu-prof-interval", "1000"]
    cmd = [prog[0]] + prof + prog[1:] + sys.argv[4:]
else:
    if not NOPROF:
        env["NODE_OPTIONS"] = f"--cpu-prof --cpu-prof-dir=/tmp/uiprof/out/{mode} --cpu-prof-interval 1000"
    cmd = ["pi"] + (["--model", "haiku"] if os.environ.get("MODEL", "1") == "1" else []) + sys.argv[4:]
os.makedirs(f"/tmp/uiprof/out/{mode}", exist_ok=True)
pid, fd = pty.fork()
if pid == 0:
    os.chdir("/home/fede/documents/projects/pi-claude")
    os.execvpe(cmd[0], cmd, env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 160, 0, 0))
def tree(p):
    out = [p]
    try:
        for t in os.listdir(f"/proc/{p}/task"):
            for c in open(f"/proc/{p}/task/{t}/children").read().split(): out += tree(int(c))
    except Exception: pass
    return out
def cpu_ms():
    tot = 0
    for p in tree(pid):
        try:
            f = open(f"/proc/{p}/stat").read().rsplit(") ", 1)[1].split()
            tot += int(f[11]) + int(f[12])
        except Exception: pass
    return tot * 10
total = 0; t0 = time.time(); log = []
def drain(dur):
    global total
    end = time.time() + dur
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try: d = os.read(fd, 65536)
            except OSError: return False
            total += len(d); log.append((time.time() - t0, len(d)))
    return True
drain(float(os.environ.get("STARTUP", 8)))   # startup (STARTUP env for slow machines)
# typing latency: send chars one by one, time until any output
lat = []
for ch in "ciao come stai ":
    s = time.time(); os.write(fd, ch.encode())
    got = None
    while time.time() - s < 2:
        r, _, _ = select.select([fd], [], [], 0.01)
        if r:
            d = os.read(fd, 65536); total += len(d)
            if ch.encode() in d or ch == " ": got = time.time() - s; break
    lat.append(got); drain(0.15)
os.write(fd, b"\x15")         # ctrl+u clear line
drain(0.5)
os.write(fd, prompt.encode() + b"\r")
mark = total; ts = time.time(); cpu0 = cpu_ms()
drain(secs)
cpu_stream = cpu_ms() - cpu0
stream_bytes = total - mark
# typing latency during streaming
lat2 = []
for ch in "ΩΣπ¤§µßø":   # rare chars: not produced by the stream, so output containing them is the echo
    s = time.time(); os.write(fd, ch.encode()); got = None
    while time.time() - s < 3:
        r, _, _ = select.select([fd], [], [], 0.01)
        if r:
            d = os.read(fd, 65536); total += len(d)
            if ch.encode() in d: got = time.time() - s; break
    lat2.append(got); drain(0.2)
os.write(fd, b"\x03"); drain(1); os.write(fd, b"\x03"); drain(1); os.write(fd, b"\x04"); drain(3)
try: os.kill(pid, signal.SIGTERM)
except Exception: pass
f = lambda l: [None if x is None else round(x*1000) for x in l]
print(json.dumps({"mode": mode, "idle_typing_ms": f(lat), "stream_typing_ms": f(lat2), "stream_bytes": stream_bytes, "cpu_stream_ms": cpu_stream, "stream_secs": secs, "kb_per_s": round(stream_bytes/1024/secs, 1)}))
