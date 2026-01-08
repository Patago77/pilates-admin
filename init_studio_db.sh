#!/usr/bin/env bash
set -euo pipefail
SLUG="${1:-}"
if [[ -z "$SLUG" ]]; then
  echo "Uso: $0 <slug>  (ej: $0 demo_cliente)"
  exit 1
fi

SLUG_CLEAN="$(echo "$SLUG" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_]+/_/g' | sed -E 's/^_+|_+$//g')"
DB_NAME="studio_${SLUG_CLEAN}_db"

sudo mysql -e "USE \`${DB_NAME}\`; SOURCE /root/estudio-pilates/docs/sql/studio_schema.sql;"
echo "OK tablas creadas en ${DB_NAME}"
