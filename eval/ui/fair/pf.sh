cd /tmp/uiprof
python3 -I /home/fede/documents/projects/pi-claude/eval/ui/drive.py pf-on "Scrivi." 45 -e /home/fede/documents/projects/pi-claude/prototype/replay/index.ts --provider replay --model fixed --no-session > out/pf-on.json 2>&1
PI_UI=off python3 -I /home/fede/documents/projects/pi-claude/eval/ui/drive.py pf-off "Scrivi." 45 -e /home/fede/documents/projects/pi-claude/prototype/replay/index.ts --provider replay --model fixed --no-session > out/pf-off.json 2>&1
echo ok > out/pf.done
