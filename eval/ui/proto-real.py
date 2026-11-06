import os,pty,time,select,struct,fcntl,termios,re,sys
R="/home/fede/documents/projects/pi-claude"
prompt=sys.argv[1].encode(); secs=float(sys.argv[2]); extra=sys.argv[3:]
env=dict(os.environ,TERM="xterm-256color",PROTO_DUMP="/tmp/uiprof/real.screen")
pid,fd=pty.fork()
if pid==0:
    os.chdir(R); os.execvpe("node",["node",R+"/prototype/rpc-chat/chat.mjs","--model","haiku"]+extra,env)
fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack("HHHH",30,110,0,0))
def drain(t,until=None):
    e=time.time()+t; b=b""
    while time.time()<e:
        r,_,_=select.select([fd],[],[],.05)
        if r:
            try: b+=os.read(fd,65536)
            except OSError: break
    return b
drain(4); os.write(fd,b"\x1b[200~"+prompt+b"\x1b[201~\r"); drain(secs)
os.write(fd,b"\x03");drain(1);os.write(fd,b"\x03");drain(1.5)
print(open("/tmp/uiprof/real.screen").read())
