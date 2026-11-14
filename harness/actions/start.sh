#!/usr/bin/env bash
source "$(dirname "$0")/env.sh"
mkdir -p "$S/data" "$S/tmp" "$S/logs"
if ss -ltnH "sport = :$SERVER_PORT" | grep -q .; then echo "isolated bb already listening on $SERVER_PORT"; exit 0; fi
clock=()
[ "${PANEL_CLOCK_OFFSET_MS:-0}" != 0 ] && clock=(PANEL_CLOCK_OFFSET_MS=$PANEL_CLOCK_OFFSET_MS "NODE_OPTIONS=--import=file://$H/stand-ins/clock.mjs")
env -i HOME=$HOME PATH=$NODE_BIN:/usr/bin:/bin TMPDIR=$S/tmp BB_DATA_DIR=$S/data 'SCRIPTED_ECHO_OPTIONS={"uniqueProviderThreadIds":true}' "${clock[@]}" \
  setsid nohup $NODE_BIN/node $L/dist/bb-app.js start --data-dir $S/data --server-port $SERVER_PORT --host-daemon-port $DAEMON_PORT --no-in-app-updates --bundled > $S/logs/bb-app.log 2>&1 < /dev/null &
# Up means the server answers and bb says it is ready (its host daemon started too). The ports sit in Linux's ephemeral
# range, so another process can hold one for a moment; bb then shuts down at start, and exit 3 tells the caller to retry.
for i in $(seq 1 120); do
  if curl -fsS -o /dev/null $ISO_URL/ 2>/dev/null && grep -q "bb is ready" $S/logs/bb-app.log; then echo "isolated bb $BB_VERSION up on $ISO_URL after ${i}s (clock offset ${PANEL_CLOCK_OFFSET_MS:-0} ms)"; exit 0; fi
  if grep -q "failed to start\|Shutting down" $S/logs/bb-app.log; then echo "isolated bb stopped while starting ($(grep -m1 -o '[A-Za-z ]*failed to start' $S/logs/bb-app.log | sed 's/^ *//'); see $S/logs/bb-app.log)"; exit 3; fi
  sleep 1
done
echo "isolated bb did not start; see $S/logs/bb-app.log"; exit 1
