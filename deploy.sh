#!/usr/bin/env bash
# Cay Work — pubblicazione automatica su GitHub Pages.
# Uso:  bash deploy.sh "messaggio del commit"
# Stampa una versione nuova in index.html + version.json, poi commit e push su main.
set -e
cd "$(dirname "$0")"
MSG="${1:-aggiornamento app}"
V="$(date -u +%Y.%m.%d-%H%M%S)"

printf '{"version":"%s"}\n' "$V" > version.json
perl -0pi -e "s/const APP_VERSION='[^']*';/const APP_VERSION='$V';/" index.html

git add -A
git commit -m "$MSG (v$V)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
echo "✅ Pubblicato v$V — online tra circa 1 minuto su https://yfy8b8j9jj-lgtm.github.io/cay-work/"
