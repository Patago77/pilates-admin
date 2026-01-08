// routes/students.js
const express = require('express');
const authenticateToken = require('../authMiddleware');
const router = express.Router();

// 👉 Registrar un nuevo alumno
router.post('/students', authenticateToken, async (req, res) => {
  const { nombre, documento, email, telefono } = req.body;
  if (!nombre || !documento) {
    return res.status(400).json({ error: "Nombre y documento son obligatorios." });
  }

  try {
    // Control duplicados
    const [existe] = await req.db.query('SELECT id FROM students WHERE documento = ?', [documento]);
    if (existe.length > 0) {
      return res.status(400).json({ error: "Ya existe un alumno con ese documento." });
    }

    const [result] = await req.db.query(
      'INSERT INTO students (nombre, documento, email, telefono) VALUES (?, ?, ?, ?)',
      [nombre, documento, email, telefono]
    );

    res.json({ id: result.insertId, nombre, documento, email, telefono });
  } catch (err) {
    console.error("❌ Error al guardar alumno:", err.message);
    res.status(500).json({ error: "Error al guardar alumno" });
  }
});

// 👉 Traer todos los alumnos
router.get('/students', authenticateToken, async (req, res) => {
  try {
    const [rows] = await req.db.query('SELECT * FROM students ORDER BY nombre ASC');
    res.json(rows);
  } catch (err) {
    console.error("❌ Error al obtener alumnos:", err.message);
    res.status(500).json({ error: "Error al obtener alumnos" });
  }
});

module.exports = router;
