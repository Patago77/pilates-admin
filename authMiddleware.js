const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { getStudioPool } = require('./db');


const SECRET_KEY = process.env.SECRET_KEY;

if (!SECRET_KEY) {
  console.error("❌ ERROR: SECRET_KEY no está definida en .env");
  process.exit(1);
}

/**
 * Autenticación:
 * - Verifica JWT
 * - Adjunta req.user
 * - Adjunta req.db (pool MySQL del estudio) usando user.studio_db del token
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  // Cookie httpOnly (admin panel) → header Authorization (fallback) → query param (descarga PDF)
  const token = req.cookies?.admin_token
                || (authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null)
                || req.query.token || null;

  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado o formato incorrecto' });
  }

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido o expirado' });

    // user: { id, email, role, studio_id, studio_db }
    if (!user?.studio_db) {
      return res.status(403).json({ error: 'Token inválido (sin estudio asociado)' });
    }

    req.user = user;
    try {
      req.db = getStudioPool(user.studio_db);
    } catch (e) {
      return res.status(500).json({ error: 'Error de base de datos (pool)' });
    }

    next();
  });
}

// Solo permite acceso a roles admin
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido a administradores.' });
  }
  next();
}

module.exports = authenticateToken;
module.exports.requireAdmin = requireAdmin;
