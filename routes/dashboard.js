const express = require('express');
const authenticateToken = require('../authMiddleware');

const router = express.Router();

/**
 * Dashboard (por estudio):
 * - ingresos totales
 * - cantidad pagos
 * - ingresos por mes
 * - vencidos
 * - próximos a vencer
 */
router.get('/dashboard', authenticateToken, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const upcomingDate = new Date();
  upcomingDate.setDate(upcomingDate.getDate() + 7);
  const upcomingDateStr = upcomingDate.toISOString().split('T')[0];

  try {
    const [[totalIncomeRow]] = await req.db.query('SELECT COALESCE(SUM(amount), 0) AS totalIncome FROM payments');
    const [[totalPaymentsRow]] = await req.db.query('SELECT COUNT(*) AS totalPayments FROM payments');

    const [paymentsPerMonth] = await req.db.query(`
      SELECT DATE_FORMAT(paymentDate, '%Y-%m') AS month, SUM(amount) AS totalIncome
      FROM payments
      GROUP BY month
      ORDER BY month DESC
    `);

    const [overduePaymentsRows] = await req.db.query(
      'SELECT DISTINCT fullName FROM payments WHERE paymentDate < ? ORDER BY paymentDate DESC LIMIT 100',
      [today]
    );

    const [upcomingPaymentsRows] = await req.db.query(
      'SELECT DISTINCT fullName FROM payments WHERE paymentDate BETWEEN ? AND ? ORDER BY paymentDate ASC LIMIT 100',
      [today, upcomingDateStr]
    );

    res.json({
      totalIncome: Number(totalIncomeRow.totalIncome) || 0,
      totalPayments: Number(totalPaymentsRow.totalPayments) || 0,
      paymentsPerMonth,
      overduePayments: overduePaymentsRows.map(r => r.fullName),
      upcomingPayments: upcomingPaymentsRows.map(r => r.fullName)
    });
  } catch (err) {
    console.error("❌ Error en el dashboard:", err.message);
    res.status(500).json({ error: "Error en el dashboard" });
  }
});

/**
 * 📈 Serie mensual (ingresos vs gastos)
 * GET /api/resumen/serie?months=12
 */
router.get('/resumen/serie', authenticateToken, async (req, res) => {
  try {
    const months = Math.max(1, Math.min(parseInt(req.query.months || '12', 10), 36));

    const [rows] = await req.db.query(
      `
      SELECT m.mes,
             COALESCE(i.ingresos, 0) AS totalIngresos,
             COALESCE(g.gastos, 0)   AS totalGastos,
             (COALESCE(i.ingresos, 0) - COALESCE(g.gastos, 0)) AS saldo
      FROM (
        SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL seq MONTH), '%Y-%m') AS mes
        FROM (
          SELECT 0 seq UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
          UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11
          UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17
          UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL SELECT 20 UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23
          UNION ALL SELECT 24 UNION ALL SELECT 25 UNION ALL SELECT 26 UNION ALL SELECT 27 UNION ALL SELECT 28 UNION ALL SELECT 29
          UNION ALL SELECT 30 UNION ALL SELECT 31 UNION ALL SELECT 32 UNION ALL SELECT 33 UNION ALL SELECT 34 UNION ALL SELECT 35
        ) nums
        LIMIT ?
      ) m
      LEFT JOIN (
        SELECT DATE_FORMAT(paymentDate, '%Y-%m') AS mes, SUM(amount) AS ingresos
        FROM payments
        GROUP BY mes
      ) i ON i.mes = m.mes
      LEFT JOIN (
        SELECT DATE_FORMAT(fecha, '%Y-%m') AS mes, SUM(monto) AS gastos
        FROM gastos
        GROUP BY mes
      ) g ON g.mes = m.mes
      ORDER BY m.mes ASC
      `,
      [months]
    );

    res.json({ months, series: rows });
  } catch (err) {
    console.error("❌ Error serie mensual:", err.message);
    res.status(500).json({ error: "Error al obtener la serie mensual" });
  }
});


module.exports = router;
