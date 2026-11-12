#!/usr/bin/env bash
source "$(dirname "$0")/env.sh"
srv=$(ss -ltnpH "sport = :$SERVER_PORT" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
[ -z "$srv" ] && { echo "nothing listening on $SERVER_PORT"; exit 0; }
parent=$(ps -o ppid= -p $srv | tr -d ' ')
case "$(tr '\0' ' ' < /proc/$parent/cmdline)" in *"$S/data"*) ;; *) echo "parent $parent is not the isolated bb-app; refusing"; exit 1;; esac
group=$(ps -o pgid= -p $parent | tr -d ' ')
kill -TERM -- -$group
for i in $(seq 1 60); do
  if ! pgrep -g $group >/dev/null && ! ss -ltnH "sport = :$SERVER_PORT or sport = :$DAEMON_PORT" | grep -q .; then echo stopped; exit 0; fi
  sleep 0.5
done
echo "still running after 30 s"; exit 1
