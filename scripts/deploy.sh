#!/bin/bash
# Deploy godex to a server over ssh, using the settings in deploy.env (see deploy.env.example).
#
#   scripts/deploy.sh             code + restart (tests run first, locally)
#   scripts/deploy.sh --sprites   also sync media/sprites (your images)
#   scripts/deploy.sh --install   first time: system user, data dir, venv, systemd units, nginx snippets
#
# It never edits your main nginx site file: include the rendered snippet from it yourself (see docs/DEPLOY.md).
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f deploy.env ]] || { echo "copy deploy.env.example to deploy.env first"; exit 1; }
# shellcheck disable=SC1091
source deploy.env
INSTALL=0; SPRITES=0
for a in "$@"; do case "$a" in --install) INSTALL=1;; --sprites) SPRITES=1;; *) echo "unknown option $a"; exit 1;; esac; done

echo "== tests"
.venv/bin/python -m pytest -q
node --test tests/js/*.test.mjs >/dev/null && echo "js tests ok"

# DEX_AUTH=site: nginx proves each request came through its login with a secret header (X-Site-Proxy-Key) from a
# root-only snippet; the service gets the same key through systemd LoadCredential. Other modes need neither.
PROXY_KEY_INCLUDE=${PROXY_KEY_INCLUDE:-snippets/$SERVICE-proxy-key.conf}
if [[ $AUTH == site ]]; then
  PROXY_CREDENTIAL="LoadCredential=site-proxy-key:/etc/$SERVICE/site-proxy-key"; PROXY_KEY_SED="s|@PROXY_KEY_INCLUDE@|$PROXY_KEY_INCLUDE|g"
else
  PROXY_CREDENTIAL="# (no site proxy key: DEX_AUTH=$AUTH)"; PROXY_KEY_SED="/@PROXY_KEY_INCLUDE@/d"
fi
render() {  # template -> stdout
  sed -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@APP_USER@|$APP_USER|g" -e "s|@PORT@|$PORT|g" -e "s|@BASE_PATH@|$BASE_PATH|g" \
      -e "s|@AUTH@|$AUTH|g" -e "s|@IDENTITY_INCLUDE@|$IDENTITY_INCLUDE|g" -e "s|@LOG_FORMAT@|$LOG_FORMAT|g" \
      -e "s|@PROXY_CREDENTIAL@|$PROXY_CREDENTIAL|g" -e "$PROXY_KEY_SED" "$1"
}
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
render deploy/systemd/godex.service.in > "$STAGE/$SERVICE.service"
render deploy/systemd/godex-backup.service.in > "$STAGE/$SERVICE-backup.service"
render deploy/systemd/godex-backup.timer.in > "$STAGE/$SERVICE-backup.timer"
render deploy/systemd/godex-catalog.service.in > "$STAGE/$SERVICE-catalog.service"
render deploy/systemd/godex-catalog.timer.in > "$STAGE/$SERVICE-catalog.timer"
render deploy/nginx/dex-locations.conf.in > "$STAGE/locations.conf"
render deploy/nginx/dex-http.conf.in > "$STAGE/http.conf"
cp deploy/nginx/godex-proxy.conf "$STAGE/godex-proxy.conf"

echo "== code -> $DEPLOY_HOST:$APP_DIR"
ssh "$DEPLOY_HOST" "mkdir -p '$APP_DIR'"
rsync -rlt --delete --exclude '.git/' --exclude '.venv/' --exclude 'var/' --exclude 'var-dev/' --exclude 'var-demo/' \
  --exclude '.cache/' --exclude 'media/sprites/' --exclude '__pycache__/' --exclude '.pytest_cache/' --exclude 'deploy.env' \
  ./ "$DEPLOY_HOST:$APP_DIR/"
if [[ $SPRITES == 1 ]]; then
  echo "== sprites"
  ssh "$DEPLOY_HOST" "mkdir -p '$APP_DIR/media/sprites'"
  rsync -rt --delete media/sprites/ "$DEPLOY_HOST:$APP_DIR/media/sprites/"
fi
rsync -rt "$STAGE/" "$DEPLOY_HOST:/tmp/godex-deploy/"

ssh "$DEPLOY_HOST" APP_DIR="$APP_DIR" APP_USER="$APP_USER" SERVICE="$SERVICE" PORT="$PORT" BASE_PATH="$BASE_PATH" \
    NGINX_LOCATIONS="$NGINX_LOCATIONS" NGINX_HTTP="$NGINX_HTTP" INSTALL="$INSTALL" AUTH="$AUTH" \
    PROXY_KEY_INCLUDE="$PROXY_KEY_INCLUDE" bash -s <<'REMOTE'
set -euo pipefail
S=/tmp/godex-deploy
cd "$APP_DIR"
[[ -x .venv/bin/python ]] || python3 -m venv .venv
.venv/bin/pip install -q --disable-pip-version-check -r requirements.txt
mkdir -p media/sprites
if [[ $INSTALL == 1 ]]; then
  id "$APP_USER" >/dev/null 2>&1 || sudo -n useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
  sudo -n install -d -m 0700 -o "$APP_USER" -g "$APP_USER" "$APP_DIR/var"
  sudo -n install -m 0644 "$S/$SERVICE.service" "$S/$SERVICE-backup.service" "$S/$SERVICE-backup.timer" \
      "$S/$SERVICE-catalog.service" "$S/$SERVICE-catalog.timer" /etc/systemd/system/
  sudo -n systemctl daemon-reload
  sudo -n systemctl enable "$SERVICE.service" "$SERVICE-backup.timer" "$SERVICE-catalog.timer"
  sudo -n systemctl start "$SERVICE-backup.timer" "$SERVICE-catalog.timer"
  sudo -n -u "$APP_USER" env DEX_DATA_DIR="$APP_DIR/var" DEX_AUTH="$AUTH" .venv/bin/python -m godex.cli init
fi
if [[ $AUTH == site ]]; then   # key + matching nginx snippet, both root 0600; the key never appears on a command line
  sudo -n install -d -m 0700 -o root -g root "/etc/$SERVICE"
  sudo -n env KEY="/etc/$SERVICE/site-proxy-key" SNIP="/etc/nginx/$PROXY_KEY_INCLUDE" python3 - <<'PY'
import os, secrets
key_path, snip_path = os.environ["KEY"], os.environ["SNIP"]
def write(path, text):
    fd = os.open(path + ".new", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)
    os.replace(path + ".new", path)
try:
    key = open(key_path).read().strip()
except FileNotFoundError:
    key = ""
if len(key) < 32:
    key = secrets.token_urlsafe(48)
    write(key_path, key + "\n")
write(snip_path, 'proxy_set_header X-Site-Proxy-Key "%s";\n' % key)
for path in (key_path, snip_path):
    os.chown(path, 0, 0)
    os.chmod(path, 0o600)
PY
fi
# systemd units: replace when changed (not only on --install), so unit changes reach existing servers
units=0
for u in "$SERVICE.service" "$SERVICE-backup.service" "$SERVICE-backup.timer" "$SERVICE-catalog.service" "$SERVICE-catalog.timer"; do
  if [[ -f "/etc/systemd/system/$u" ]] && ! sudo -n cmp -s "$S/$u" "/etc/systemd/system/$u"; then
    sudo -n cp -p "/etc/systemd/system/$u" "/etc/systemd/system/$u.bak-$(date +%Y%m%d%H%M%S)"
    sudo -n install -m 0644 "$S/$u" /etc/systemd/system/; units=1
  fi
done
[[ $units == 1 ]] && sudo -n systemctl daemon-reload && echo "systemd units updated"
# nginx snippets: only replace when changed, test, roll back on failure
changed=0
for pair in "$S/locations.conf:$NGINX_LOCATIONS" "$S/http.conf:$NGINX_HTTP" "$S/godex-proxy.conf:/etc/nginx/snippets/godex-proxy.conf"; do
  src=${pair%%:*}; dst=${pair#*:}
  if ! sudo -n cmp -s "$src" "$dst" 2>/dev/null; then
    [[ -f "$dst" ]] && sudo -n cp -p "$dst" "$dst.bak-$(date +%Y%m%d%H%M%S)"
    sudo -n install -m 0644 "$src" "$dst"; changed=1
  fi
done
if [[ $changed == 1 ]]; then
  if sudo -n nginx -t 2>/dev/null; then sudo -n systemctl reload nginx; echo "nginx reloaded"
  else echo "nginx -t FAILED: restore the .bak files"; sudo -n nginx -t; exit 1; fi
fi
# New species/forms from data/catalog.json (idempotent; never touches the collection)
sudo -n -u "$APP_USER" env DEX_DATA_DIR="$APP_DIR/var" DEX_AUTH="$AUTH" .venv/bin/python -m godex.cli catalog-load >/dev/null
sudo -n systemctl restart "$SERVICE.service"
for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT$BASE_PATH/api/health" && break; sleep 0.5; done
echo; rm -rf "$S"
REMOTE
echo "== deployed"
