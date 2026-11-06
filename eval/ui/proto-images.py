import pty,os,time,select,sys,re,fcntl,termios,struct
mode=sys.argv[1]
pid,fd=pty.fork()
if pid==0:
    os.environ["TERM"]="xterm-256color"; os.environ["PROTO_CPU"]="/tmp/uiprof/img-"+mode+".cpu"; os.execvp("node",["node","/home/fede/documents/projects/pi-claude/prototype/rpc-chat/chat.mjs","--model","haiku"])
fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack("HHHH",50,140,0,0))
def rd(t):
    b=b""; end=time.time()+t
    while time.time()<end:
        if select.select([fd],[],[],0.1)[0]:
            try: b+=os.read(fd,1<<20)
            except OSError: break
    return b
rd(1)
os.write(fd,b"\x1b[6;20;10t"+(b"\x1b_Gi=31;OK\x1b\\\x1b[?62;4c" if mode=="kitty" else b"\x1b[?62;4c" if mode=="sixel" else b"\x1b[?62c")); rd(.5)
os.write(fd,(b"/img /tmp/test.png ciao\r" if mode!="none" else b"ciao\r"))
b=rd(12)
os.write(fd,b"abc"); b2=rd(1)   # typing afterwards must not resend the image
tx=len(re.findall(rb"a=t,f=100",b+b2)); pl=re.findall(rb"a=p,i=\d+,p=1,c=(\d+),r=(\d+)",b+b2); sx=re.findall(rb"\x1bPq\"1;1;(\d+);(\d+)",b+b2)
print(mode,"bytes_total",len(b),"typing_bytes",len(b2),"kitty_tx",tx,"placements",pl[:2],len(pl),"sixel",sx[:2],len(sx),"sixel_bytes",sum(len(x) for x in re.findall(rb"\x1bPq.*?\x1b\\\\",b,re.S)))
os.write(fd,b"\x04"); time.sleep(.6)
print(open("/tmp/uiprof/img-"+mode+".cpu").read())
