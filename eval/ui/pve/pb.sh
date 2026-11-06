export PI_VAULT_OFF=1 STARTUP=12 PATH=/usr/local/bin:$PATH REPLAY_CPS=300 REPLAY_CHUNK=5 NOPROF=1 PI_YOLO=0
R=/home/fede/documents/projects/pi-claude; cd $R; mkdir -p /tmp/res
A="-e $R/prototype/replay/index.ts --provider replay --model fixed"
for i in 1 2 3 4 5; do
 for m in proto pi off; do
  echo "$(cut -d' ' -f1 /proc/loadavg)" > /tmp/res/load-$m-$i
  case $m in
   proto) PROTO_CPU=/tmp/res/$m-$i.cpu PROG="node $R/prototype/rpc-chat/chat.mjs" python3 -I eval/ui/drive.py pb-$m-$i "Scrivi." 45 $A > /tmp/res/$m-$i.json 2>&1;;
   pi) python3 -I eval/ui/drive.py pb-$m-$i "Scrivi." 45 $A --no-session > /tmp/res/$m-$i.json 2>&1;;
   off) PI_UI=off python3 -I eval/ui/drive.py pb-$m-$i "Scrivi." 45 $A --no-session > /tmp/res/$m-$i.json 2>&1;;
  esac
 done
done
echo ok > /tmp/res/done
