#!/bin/bash
# keepalive.sh : garde l'instance Oracle active en pingant toutes les 10 minutes.
set -e

while true; do
  if curl -fsS https://ifconfig.me > /dev/null; then
    sleep 600
  else
    sleep 60
  fi
done

