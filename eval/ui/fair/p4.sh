cd /tmp/uiprof
for i in 1 2 3; do
 PROTO_CPU=/tmp/uiprof/out/p4-$i.cpu PROG="node /home/fede/documents/projects/pi-claude/prototype/rpc-chat/chat.mjs" python3 -I /home/fede/documents/projects/pi-claude/eval/ui/drive.py p4-proto-$i "Scrivi." 45 -e /home/fede/documents/projects/pi-claude/prototype/replay/index.ts --provider replay --model fixed > out/p4-proto-$i.json 2>&1
 python3 -I /home/fede/documents/projects/pi-claude/eval/ui/drive.py p4-pi-$i "Scrivi." 45 -e /home/fede/documents/projects/pi-claude/prototype/replay/index.ts --provider replay --model fixed --no-session > out/p4-pi-$i.json 2>&1
 PI_UI=off python3 -I /home/fede/documents/projects/pi-claude/eval/ui/drive.py p4-off-$i "Scrivi." 45 -e /home/fede/documents/projects/pi-claude/prototype/replay/index.ts --provider replay --model fixed --no-session > out/p4-off-$i.json 2>&1
done
echo ok > out/p4.done
