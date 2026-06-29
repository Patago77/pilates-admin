const express = require('express');
const router = express.Router();
const authenticateToken = require('../authMiddleware');
const { requireAdmin } = require('../authMiddleware');

router.get('/gastos/detalle/:mes', authenticateToken, requireAdmin, async (req, res) => {
  const { mes } = req.params; // formato '2025-05'
  try {
    const [rows] = await req.db.query(`
      SELECT id, fecha, categoria, descripcion, monto
      FROM gastos
      WHERE DATE_FORMAT(fecha, '%Y-%m') = ?
      ORDER BY fecha DESC
    `, [mes]);
    res.json(rows);
  } catch (err) {
    console.error("❌ Error al obtener detalle de gastos:", err.message);
    res.status(500).json({ error: "Error al obtener detalle de gastos" });
  }
});

// ✅ Total de gastos del mes actual
router.get('/gastos/mensuales/total', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const hoy = new Date();
    const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
    const ultimoDiaMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];

    const [[row]] = await req.db.query(
      `SELECT COALESCE(SUM(monto), 0) AS totalGastos FROM gastos WHERE fecha BETWEEN ? AND ?`,
      [primerDiaMes, ultimoDiaMes]
    );

    res.json({ totalGastos: Number(row.totalGastos) || 0 });
  } catch (err) {
    console.error("❌ Error al obtener total mensual:", err.message);
    res.status(500).json({ error: "Error al calcular gastos del mes." });
  }
});

// ✅ Gastos agrupados por categoría del mes actual
router.get('/gastos/mensuales', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const hoy = new Date();
    const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
    const ultimoDiaMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];

    const [rows] = await req.db.query(
      `SELECT categoria, SUM(monto) AS total
       FROM gastos
       WHERE fecha BETWEEN ? AND ?
       GROUP BY categoria`,
      [primerDiaMes, ultimoDiaMes]
    );

    res.json(rows);
  } catch (err) {
    console.error("❌ Error al obtener gastos mensuales:", err.message);
    res.status(500).json({ error: "Error al obtener estadísticas de gastos." });
  }
});

// ✅ Gastos agrupados por mes (para la tabla "Gastos Mensuales")
router.get('/gastos/por-mes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await req.db.query(`
      SELECT DATE_FORMAT(fecha, '%Y-%m') AS mes,
             COALESCE(SUM(monto), 0) AS total
      FROM gastos
      GROUP BY mes
      ORDER BY mes DESC
      LIMIT 24
    `);

    res.json(rows);
  } catch (err) {
    console.error("❌ Error al obtener gastos por mes:", err.message);
    res.status(500).json({ error: "Error al obtener gastos por mes." });
  }
});


// ✅ Total de ingresos y egresos y saldo del mes actual (consolidado)
router.get('/resumen/mensual', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const hoy = new Date();
    const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
    const ultimoDiaMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];

    const [[{ totalIngresos }]] = await req.db.query(
      `SELECT COALESCE(SUM(amount), 0) AS totalIngresos
       FROM payments
       WHERE COALESCE(serviceMonth, DATE_FORMAT(paymentDate, '%Y-%m')) = ?`,
      [mesActual]
    );

    const [[{ totalGastos }]] = await req.db.query(
      `SELECT COALESCE(SUM(monto), 0) AS totalGastos
       FROM gastos
       WHERE fecha BETWEEN ? AND ?`,
      [primerDiaMes, ultimoDiaMes]
    );

    const saldo = (Number(totalIngresos) || 0) - (Number(totalGastos) || 0);

    res.json({
      totalIngresos: Number(totalIngresos) || 0,
      totalGastos: Number(totalGastos) || 0,
      saldo
    });
  } catch (err) {
    console.error("❌ Error al obtener resumen mensual:", err.message);
    res.status(500).json({ error: "Error al calcular resumen mensual." });
  }
});

// Obtener todos los gastos
router.get('/gastos', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT id, categoria, descripcion, monto, fecha FROM gastos ORDER BY fecha DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ Error al obtener los gastos:", err.message);
    res.status(500).json({ error: "Error al obtener los gastos." });
  }
});

// Obtener un gasto por id
router.get('/gastos/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [[row]] = await req.db.query(
      `SELECT id, categoria, descripcion, monto, fecha FROM gastos WHERE id = ?`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: "Gasto no encontrado." });
    res.json(row);
  } catch (err) {
    console.error("❌ Error al obtener gasto:", err.message);
    res.status(500).json({ error: "Error al obtener el gasto." });
  }
});

// Registrar un nuevo gasto
router.post('/gastos', authenticateToken, requireAdmin, async (req, res) => {
  const { categoria, descripcion, monto, fecha } = req.body;

  if (!categoria || !descripcion || !fecha || isNaN(monto)) {
    return res.status(400).json({ error: "Todos los campos son obligatorios y el monto debe ser válido." });
  }

  try {
    const [result] = await req.db.query(
      `INSERT INTO gastos (categoria, descripcion, monto, fecha) VALUES (?, ?, ?, ?)`,
      [categoria, descripcion, monto, fecha]
    );
    res.json({ id: result.insertId, categoria, descripcion, monto, fecha });
  } catch (err) {
    console.error("❌ Error al guardar gasto:", err.message);
    res.status(500).json({ error: "Error al guardar el gasto." });
  }
});

// Editar un gasto
router.put('/gastos/:id', authenticateToken, requireAdmin, async (req, res) => {
  const gastoId = req.params.id;
  const { categoria, descripcion, monto, fecha } = req.body;

  if (!categoria || !descripcion || !fecha || isNaN(monto)) {
    return res.status(400).json({ error: "Todos los campos son obligatorios y el monto debe ser válido." });
  }

  try {
    const [result] = await req.db.query(
      `UPDATE gastos SET categoria = ?, descripcion = ?, monto = ?, fecha = ? WHERE id = ?`,
      [categoria, descripcion, monto, fecha, gastoId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ error: "Gasto no encontrado." });

    res.json({ message: "Gasto actualizado correctamente" });
  } catch (err) {
    console.error("❌ Error al actualizar gasto:", err.message);
    res.status(500).json({ error: "Error al actualizar el gasto." });
  }
});

// Eliminar un gasto
router.delete('/gastos/:id', authenticateToken, requireAdmin, async (req, res) => {
  const gastoId = req.params.id;

  try {
    const [result] = await req.db.query(`DELETE FROM gastos WHERE id = ?`, [gastoId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Gasto no encontrado." });
    res.json({ message: "Gasto eliminado correctamente" });
  } catch (err) {
    console.error("❌ Error al eliminar gasto:", err.message);
    res.status(500).json({ error: "Error al eliminar el gasto." });
  }
});

module.exports = router;
