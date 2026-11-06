cd /tmp/uiprof
python3 -I /home/fede/documents/projects/pi-claude/eval/ui/drive.py pf-on2 "Scrivi." 45 -e /home/fede/documents/projects/pi-claude/prototype/replay/index.ts --provider replay --model fixed --no-session > out/pf-on2.json 2>&1
for i in 1 2; do NOPROF=1 python3 -I /home/fede/documents/projects/pi-claude/eval/ui/drive.py fix- "Scrivi." 45 -e /home/fede/documents/projects/pi-claude/prototype/replay/index.ts --provider replay --model fixed --no-session > out/fix-$i.json 2>&1; done
echo ok > out/pf2.done
