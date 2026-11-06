import pty,os,time,select,sys,re,fcntl,termios,struct
pid,fd=pty.fork()
if pid==0:
    os.environ["TERM"]="xterm-256color"; os.execvp("node",["node","/home/fede/documents/projects/pi-claude/prototype/rpc-chat/chat.mjs","--model","haiku"])
fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack("HHHH",60,140,0,0))
def rd(t):
    b=b""; end=time.time()+t
    while time.time()<end:
        if select.select([fd],[],[],0.1)[0]:
            try: b+=os.read(fd,1<<20)
            except OSError: break
    return b
rd(1.5)
os.write(fd,b"Usa UN SOLO tool edit su /tmp/dt/b.txt: sostituisci le righe da 'riga 1' a 'riga 20' (testo esatto, 20 righe consecutive) con 20 righe 'nuova N'. Poi rispondi solo ok.\r")
raw=rd(40); os.write(fd,b"\x04")
t=raw.decode("utf8","replace")
print("green rows:",t.count("\x1b[48;2;16;40;29m"),"red rows:",t.count("\x1b[48;2;42;17;25m"),"truncated:", re.findall(r"… \+\d+ righe",t), "tool:", re.findall(r"(write|edit) /tmp/dt/b.txt",t)[:2])
