import os,pty,time,select,struct,fcntl,termios,re
R="/home/fede/documents/projects/pi-claude"
pid,fd=pty.fork()
if pid==0:
    os.chdir(R); os.environ["TERM"]="xterm-256color"
    os.execvp("node",["node",R+"/prototype/rpc-chat/chat.mjs","-e",R+"/prototype/replay/index.ts","--provider","replay","--model","fixed"])
fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack("HHHH",30,100,0,0))
buf=b""
def drain(t):
    global buf
    e=time.time()+t
    while time.time()<e:
        r,_,_=select.select([fd],[],[],.05)
        if r:
            try: buf+=os.read(fd,65536)
            except OSError: return
drain(2); os.write(fd,b"ciao\r"); drain(6)
os.write(fd,b"\x1b[5~\x1b[5~"); drain(.5)
os.write(fd,b"\x1b[<64;5;5M"); drain(.5)
os.write(fd,b"ab\x1b[Dc"); drain(.5)
txt=re.sub(rb"\x1b\[[0-9;?<]*[A-Za-z~]",b"\n",buf).decode(errors="ignore")
print([l for l in txt.split("\n") if "End: bottom" in l][-1:])
print([l for l in txt.split("\n") if l.startswith("› ")][-1:])
os.write(fd,b"\x1b[F"); drain(.4); os.write(fd,b"\x03");drain(.3);os.write(fd,b"\x03");drain(.5)
