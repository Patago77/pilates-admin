const express = require('express');
const bcrypt = require('bcrypt');
const authenticateToken = require('../authMiddleware');
const { getCorePool } = require('../db');

const router = express.Router();

// GET /api/users — usuarios del estudio actual
router.get('/users', authenticateToken, async (req, res) => {
  try {
    const core = getCorePool();
    const [rows] = await core.query(
      `SELECT id, email, nombre, role, active FROM users WHERE studio_id = ? ORDER BY nombre ASC`,
      [req.user.studio_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Error GET users:', err.message);
    res.status(500).json({ error: 'Error al obtener usuarios.' });
  }
});

// POST /api/users — crear usuario
router.post('/users', authenticateToken, async (req, res) => {
  const { nombre, email, password, rol } = req.body;
  if (!nombre || !email || !password) return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
  try {
    const core = getCorePool();
    const hash = await bcrypt.hash(password, 10);
    const [result] = await core.query(
      `INSERT INTO users (email, password_hash, nombre, role, studio_id, active) VALUES (?, ?, ?, ?, ?, 1)`,
      [email, hash, nombre, rol || 'recepcion', req.user.studio_id]
    );
    res.status(201).json({ id: result.insertId, email, nombre, role: rol || 'recepcion', active: 1 });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'El email ya está registrado.' });
    console.error('❌ Error POST users:', err.message);
    res.status(500).json({ error: 'Error al crear usuario.' });
  }
});

// PUT /api/users/:id — editar usuario
router.put('/users/:id', authenticateToken, async (req, res) => {
  const { nombre, email, rol } = req.body;
  try {
    const core = getCorePool();
    await core.query(
      `UPDATE users SET nombre=?, email=?, role=? WHERE id=? AND studio_id=?`,
      [nombre, email, rol, req.params.id, req.user.studio_id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al editar usuario.' });
  }
});

// PATCH /api/users/:id/active — activar/desactivar
router.patch('/users/:id/active', authenticateToken, async (req, res) => {
  const { active } = req.body;
  try {
    const core = getCorePool();
    await core.query(
      `UPDATE users SET active=? WHERE id=? AND studio_id=?`,
      [active, req.params.id, req.user.studio_id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar usuario.' });
  }
});

module.exports = router;
