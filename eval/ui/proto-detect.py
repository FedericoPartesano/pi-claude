import pty,os,time,select,sys,re
import fcntl,termios,struct
pid,fd=pty.fork()
if pid==0:
    os.environ["TERM"]="xterm-256color"; os.execvp("node",["node","/home/fede/documents/projects/pi-claude/prototype/rpc-chat/chat.mjs","--model","haiku"])
reply=sys.argv[1].encode().decode('unicode_escape').encode()
fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack("HHHH",40,140,0,0))
def rd(t):
    b=b""; end=time.time()+t
    while time.time()<end:
        if select.select([fd],[],[],0.1)[0]:
            try: b+=os.read(fd,65536)
            except OSError: break
    return b
b=rd(1.5); print("query kitty:", b"\x1b_Gi=31" in b, "DA1:", b"\x1b[c" in b)
os.write(fd,reply); b=rd(1.5)
print([m for m in re.findall(rb"immagini: (\w+)",b)])
os.write(fd,b"\x04")
