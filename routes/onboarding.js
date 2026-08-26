const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const authenticateToken = require('../authMiddleware');
const { requireAdmin } = require('../authMiddleware');
const { getCorePool } = require('../db');
const { enviarCredencialesEstudio } = require('../emailService');

const router = express.Router();

// ── Helpers de la Fase B (alta real de un estudio) ──

// Slug seguro: solo a-z0-9_, nunca el texto crudo del formulario.
function slugify(nombre) {
  return nombre
    .toLowerCase()
    .normalize('NFD') // separa letra + acento (ej: "é" -> "e" + acento combinante)
    .replace(/[^a-z0-9]+/g, '_') // el acento combinante no es a-z0-9, cae acá también
    .replace(/^_+|_+$/g, '');
}

function generarPassword() {
  return crypto.randomBytes(12).toString('base64').replace(/[=+/]/g, '').slice(0, 14);
}

// Conexión puntual (no pool) para crear la base y cargar el schema.
// Se usa 'multipleStatements' acá y solo acá, sobre archivos propios del repo
// (nunca sobre texto que venga de un usuario) — por eso no se habilita en db.js.
async function conectarComoRoot(database) {
  const config = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  };
  if (database) config.database = database;
  return mysql.createConnection(config);
}

async function marcarError(core, id, mensaje) {
  await core.query(
    `UPDATE solicitudes_estudio SET estado='error', notas_admin=?, resuelto_en=NOW() WHERE id=?`,
    [mensaje, id]
  );
}

// Pocas solicitudes por IP — esto es un formulario público, no un login.
const solicitudLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Probá de nuevo más tarde.' }
});

// ============================================================
// POST /api/onboarding/solicitar — formulario público
// Solo registra el pedido. No crea ningún estudio ni base.
// ============================================================
router.post('/onboarding/solicitar',
  solicitudLimiter,
  [
    body('nombre_estudio').trim().notEmpty().withMessage('El nombre del estudio es obligatorio.')
      .isLength({ max: 120 }).withMessage('Nombre demasiado largo.'),
    body('email_contacto').trim().isEmail().withMessage('Email inválido.').normalizeEmail(),
    body('telefono').optional({ checkFalsy: true }).trim().isLength({ max: 40 }).withMessage('Teléfono inválido.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { nombre_estudio, email_contacto, telefono } = req.body;

    try {
      const core = getCorePool();
      await core.query(
        `INSERT INTO solicitudes_estudio (nombre_estudio, email_contacto, telefono)
         VALUES (?, ?, ?)`,
        [nombre_estudio, email_contacto, telefono || null]
      );
      res.json({ ok: true, mensaje: 'Solicitud recibida. Te vamos a contactar pronto.' });
    } catch (err) {
      console.error('❌ Error en solicitar-estudio:', err.message);
      res.status(500).json({ error: 'Error al registrar la solicitud. Intentá de nuevo.' });
    }
  }
);

// ============================================================
// GET /api/onboarding/solicitudes — panel admin, solo lectura
// ============================================================
router.get('/onboarding/solicitudes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const core = getCorePool();
    const [rows] = await core.query(
      `SELECT id, nombre_estudio, email_contacto, telefono, estado, notas_admin, created_at
       FROM solicitudes_estudio ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Error listando solicitudes:', err.message);
    res.status(500).json({ error: 'Error al listar solicitudes.' });
  }
});

// ============================================================
// POST /api/onboarding/solicitudes/:id/aprobar — admin
// Acá sí se crea el estudio de verdad: base nueva, schema completo
// (alumnas/pagos/gastos + agenda/portal), fila en studios/users, mail.
// ============================================================
router.post('/onboarding/solicitudes/:id/aprobar', authenticateToken, requireAdmin, async (req, res) => {
  const core = getCorePool();
  const { id } = req.params;

  let solicitud;
  try {
    const [rows] = await core.query('SELECT * FROM solicitudes_estudio WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Solicitud no encontrada.' });
    solicitud = rows[0];
    if (solicitud.estado !== 'pendiente') {
      return res.status(409).json({ error: `La solicitud ya está en estado '${solicitud.estado}', no se puede aprobar de nuevo.` });
    }
  } catch (err) {
    console.error('❌ Error buscando solicitud:', err.message);
    return res.status(500).json({ error: 'Error al buscar la solicitud.' });
  }

  const slug = slugify(solicitud.nombre_estudio);
  if (!slug) {
    return res.status(400).json({ error: 'No se pudo generar un identificador válido a partir del nombre del estudio.' });
  }
  const dbName = `studio_${slug}_db`;

  // Chequeo de colisión — nunca crear si ya existe algo con ese nombre,
  // ni siquiera si "solo" quedó huérfano y sin registrar (por eso el SHOW DATABASES aparte).
  try {
    const [existentes] = await core.query('SELECT id FROM studios WHERE slug = ? OR db_name = ?', [slug, dbName]);
    if (existentes.length) {
      await marcarError(core, id, `Slug/db_name '${slug}' ya está en uso por otro estudio registrado.`);
      return res.status(409).json({ error: 'Ya existe un estudio con un nombre muy similar. Cambiá el nombre e intentá de nuevo.' });
    }
    const [dbsExistentes] = await core.query('SHOW DATABASES LIKE ?', [dbName]);
    if (dbsExistentes.length) {
      await marcarError(core, id, `Ya existe físicamente una base llamada '${dbName}' sin registrar en studios — requiere revisión manual.`);
      return res.status(409).json({ error: 'Ya existe una base con ese nombre en el servidor, sin registrar. Requiere revisión manual antes de continuar.' });
    }
  } catch (err) {
    console.error('❌ Error chequeando colisiones:', err.message);
    return res.status(500).json({ error: 'Error al validar disponibilidad del nombre.' });
  }

  // A partir de acá se crean recursos reales.
  let conn;
  try {
    conn = await conectarComoRoot();
    await conn.query(`CREATE DATABASE \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.end();

    conn = await conectarComoRoot(dbName);
    const schemaBase = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sql', 'studio_schema.sql'), 'utf8');
    const schemaAgenda = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sql', 'agenda_schema.sql'), 'utf8');
    await conn.query(schemaBase);
    await conn.query(schemaAgenda);
    // studio_config no vive en ningun schema.sql - la app la crea sola la primera vez
    // que alguien entra al panel Reformers (ensureConfigTable en routes/stats.js).
    // La creamos ya de una para que el estudio quede completo desde el dia uno.
    await conn.query(`
      CREATE TABLE IF NOT EXISTS studio_config (
        clave VARCHAR(80) PRIMARY KEY,
        valor TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error('❌ Error creando base/schema:', err.message);
    await marcarError(core, id, `Falló la creación de la base '${dbName}': ${err.message}. Puede haber quedado creada a medias — revisar manualmente.`);
    return res.status(500).json({ error: 'Error al crear la base del estudio nuevo. Revisar manualmente antes de reintentar.' });
  } finally {
    if (conn) await conn.end().catch(() => {});
  }

  // Registrar en la base central + crear el admin del estudio.
  let studioId, password;
  try {
    const [result] = await core.query(
      'INSERT INTO studios (name, slug, db_name, active) VALUES (?, ?, ?, 1)',
      [solicitud.nombre_estudio, slug, dbName]
    );
    studioId = result.insertId;

    password = generarPassword();
    const passwordHash = await bcrypt.hash(password, 10);
    await core.query(
      `INSERT INTO users (email, password_hash, role, studio_id, active, nombre)
       VALUES (?, ?, 'admin', ?, 1, 'Administrador')`,
      [solicitud.email_contacto, passwordHash, studioId]
    );
  } catch (err) {
    console.error('❌ Error registrando estudio en core:', err.message);
    await marcarError(core, id, `La base '${dbName}' se creó pero falló el registro en studios/users: ${err.message}. La base quedó creada sin dueño — revisar manualmente.`);
    return res.status(500).json({ error: 'La base se creó pero falló el alta del admin. Revisar manualmente.' });
  }

  // Mandar credenciales. Si el mail falla, el estudio ya quedó funcionando igual.
  try {
    await enviarCredencialesEstudio(solicitud.email_contacto, solicitud.nombre_estudio, solicitud.email_contacto, password);
  } catch (err) {
    console.error('❌ Error enviando mail de credenciales:', err.message);
    await core.query(
      `UPDATE solicitudes_estudio SET estado='aprobado', notas_admin=?, resuelto_en=NOW() WHERE id=?`,
      [`Estudio creado OK, pero falló el envío del mail: ${err.message}. Pasarle el acceso a mano.`, id]
    );
    return res.json({
      ok: true,
      aviso: 'Estudio creado, pero no se pudo enviar el mail. Pasale las credenciales a mano.',
      studio_id: studioId, db_name: dbName, email: solicitud.email_contacto, password,
    });
  }

  await core.query(`UPDATE solicitudes_estudio SET estado='aprobado', resuelto_en=NOW() WHERE id=?`, [id]);
  res.json({ ok: true, mensaje: 'Estudio creado y credenciales enviadas por mail.', studio_id: studioId, db_name: dbName, slug });
});

module.exports = router;
