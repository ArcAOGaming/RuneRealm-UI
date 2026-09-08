#!/bin/bash
cd /c/REPO/RuneRealm-UI
export NODE_URL=http://49.12.125.122:10000
export DEADLINE_MS=120000
OUT=/c/Users/tyler/AppData/Local/Temp/claude/C--REPO-RuneRealm-UI/5ed8411d-f9ea-4c76-a326-2c747679832a/scratchpad/hwsize/phases2.jsonl
: > $OUT
mark(){ echo "{\"phase\":\"$1\",\"startedEpochMs\":$(($(date +%s%N)/1000000))}" >> $OUT; }
mark idle_start; sleep 75
for L in 1 3 6 10; do
  mark "load${L}_begin"
  LANES=$L DURATION_S=100 node backend/native/hwsize-load.mjs >> $OUT 2>>$OUT.err
  mark "idle_after_${L}"; sleep 75
done
mark end
