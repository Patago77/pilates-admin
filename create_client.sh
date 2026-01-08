#!/usr/bin/env bash
set -euo pipefail

# Uso:
#   ./create_client.sh <slug> "<Nombre Estudio>" [admin_email]
# Ej:
#   ./create_client.sh pilates_moron "Pilates Morón" admin@pilatesmoron.com

SLUG="${1:-}"
STUDIO_NAME="${2:-}"
ADMIN_EMAIL="${3:-}"

if [[ -z "$SLUG" || -z "$STUDIO_NAME" ]]; then
  echo "Uso: $0 <slug> \"Nombre Estudio\" [admin_email]"
  echo "Ej : $0 pilates_moron \"Pilates Morón\" admin@pilatesmoron.com"
  exit 1
fi

SLUG_CLEAN="$(echo "$SLUG" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_]+/_/g' | sed -E 's/^_+|_+$//g')"
DB_NAME="studio_${SLUG_CLEAN}_db"

# Carga variables desde .env
set -a
source /root/estudio-pilates/.env
set +a

if [[ -z "$ADMIN_EMAIL" ]]; then
  ADMIN_EMAIL="admin@${SLUG_CLEAN}.local"
fi

ADMIN_PASS="$(openssl rand -base64 12 | tr -d '=+/ ' | cut -c1-14)"
ADMIN_PASS_HASH="$(node -e "const bcrypt=require('bcryptjs'); console.log(bcrypt.hashSync(process.argv[1],10));" "$ADMIN_PASS")"

echo "➡️ Creando cliente:"
echo "   SLUG       : $SLUG_CLEAN"
echo "   Estudio    : $STUDIO_NAME"
echo "   DB         : $DB_NAME"
echo "   Admin email: $ADMIN_EMAIL"

# Crear DB del cliente (para futuro multi-DB)
sudo mysql -e "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Insertar/actualizar studio en CORE DB y obtener studio_id
STUDIO_ID="$(sudo mysql -N -e "
USE \`${CORE_DB_NAME}\`;
INSERT INTO studios (nombre, slug, db_name, active)
VALUES ('${STUDIO_NAME}', '${SLUG_CLEAN}', '${DB_NAME}', 1)
ON DUPLICATE KEY UPDATE nombre=VALUES(nombre), db_name=VALUES(db_name), active=1;
SELECT id FROM studios WHERE slug='${SLUG_CLEAN}' LIMIT 1;
")"

# Insertar/actualizar admin
sudo mysql -e "
USE \`${CORE_DB_NAME}\`;
INSERT INTO users (email, password_hash, nombre, role, studio_id, active)
VALUES ('${ADMIN_EMAIL}', '${ADMIN_PASS_HASH}', 'Administrador', 'admin', ${STUDIO_ID}, 1)
ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), role='admin', studio_id=${STUDIO_ID}, active=1;
"

echo ""
echo "✅ CLIENTE CREADO"
echo "Studio ID : $STUDIO_ID"
echo "DB Name   : $DB_NAME"
echo "Admin     : $ADMIN_EMAIL"
echo "Password  : $ADMIN_PASS"
