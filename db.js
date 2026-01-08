const mysql = require('mysql2/promise');
require('dotenv').config();

/**
 * Producción / multi-estudio (1–10 clientes):
 * - CORE_DB_NAME: base central (users + studios)
 * - Cada estudio tiene su propia DB (ej: studio_001_db)
 *
 * En DEV podés usar CORE_DB_NAME=core_db y una studio db (ej: studio_001_db).
 */

const {
  DB_HOST,
  DB_PORT,
  DB_USER,
  DB_PASSWORD,
  CORE_DB_NAME,
} = process.env;

if (!DB_HOST || !DB_USER || !CORE_DB_NAME) {
  console.error("❌ ERROR: Variables DB_HOST / DB_USER / CORE_DB_NAME faltan en .env");
  process.exit(1);
}

const baseConfig = {
  host: DB_HOST,
  port: DB_PORT ? Number(DB_PORT) : 3306,
  user: DB_USER,
  password: DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true, // evita sorpresas con timezone en fechas
};

const pools = new Map();

/** Pool para la base central */
function getCorePool() {
  const key = `core:${CORE_DB_NAME}`;
  if (!pools.has(key)) {
    pools.set(key, mysql.createPool({ ...baseConfig, database: CORE_DB_NAME }));
  }
  return pools.get(key);
}

/** Pool para la base de un estudio (cliente) */
function getStudioPool(dbName) {
  if (!dbName) throw new Error("dbName requerido");
  const key = `studio:${dbName}`;
  if (!pools.has(key)) {
    pools.set(key, mysql.createPool({ ...baseConfig, database: dbName }));
  }
  return pools.get(key);
}

module.exports = { getCorePool, getStudioPool };
