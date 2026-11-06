cd /tmp/uiprof
for i in 1 2 3; do
 echo "$(cut -d' ' -f1 /proc/loadavg)" > out/p6-load-proto-$i
 PROTO_CPU=/tmp/uiprof/out/p6-$i.cpu PROG="node /home/fede/documents/projects/pi-claude/prototype/rpc-chat/chat.mjs" python3 -I /home/fede/documents/projects/pi-claude/eval/ui/drive.py p6-proto-$i "Scrivi." 45 -e /home/fede/documents/projects/pi-claude/prototype/replay/index.ts --provider replay --model fixed > out/p6-proto-$i.json 2>&1
 echo "$(cut -d' ' -f1 /proc/loadavg)" > out/p6-load-off-$i
 PI_UI=off python3 -I /home/fede/documents/projects/pi-claude/eval/ui/drive.py p6-off-$i "Scrivi." 45 -e /home/fede/documents/projects/pi-claude/prototype/replay/index.ts --provider replay --model fixed --no-session > out/p6-off-$i.json 2>&1
done
echo ok > out/p6.done
