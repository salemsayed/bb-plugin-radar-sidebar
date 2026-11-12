H=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
S=${PANEL_ISO:-$HOME/.cache/bb-tmp/radar-actions-iso}
BB_VERSION=${PANEL_BB_VERSION:-$(command -v bb >/dev/null && bb --version 2>/dev/null || ls "$HOME/.bb-machines/salem.getbb.app/app-versions" | sort | tail -1)}
L=$HOME/.bb-machines/salem.getbb.app/app-versions/$BB_VERSION/node_modules/bb-app
NODE_BIN=${PANEL_NODE_BIN:-$(dirname "$(command -v node)")}
SERVER_PORT=${PANEL_SERVER_PORT:-49566}
DAEMON_PORT=${PANEL_DAEMON_PORT:-49568}
ISO_URL=http://127.0.0.1:$SERVER_PORT
isobb() { env -i HOME=$HOME PATH=$NODE_BIN:/usr/bin:/bin TMPDIR=$S/tmp BB_DATA_DIR=$S/data BB_SERVER_URL=$ISO_URL BB_HOST_DAEMON_PORT=$DAEMON_PORT ${ISO_THREAD:+BB_THREAD_ID=$ISO_THREAD} $NODE_BIN/node $L/host-daemon/dist/bb "$@"; }
