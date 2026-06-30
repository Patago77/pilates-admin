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
  const today     = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const mesActual = today.substring(0, 7);
  const prevDate  = new Date(today + 'T12:00:00-03:00');
  prevDate.setMonth(prevDate.getMonth() - 1);
  const mesAnterior = prevDate.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).substring(0, 7);

  try {
    const [[totalIncomeRow]] = await req.db.query('SELECT COALESCE(SUM(amount), 0) AS totalIncome FROM payments');
    const [[totalPaymentsRow]] = await req.db.query('SELECT COUNT(*) AS totalPayments FROM payments');

    const [paymentsPerMonth] = await req.db.query(`
      SELECT COALESCE(serviceMonth, DATE_FORMAT(paymentDate,'%Y-%m')) AS month,
             SUM(amount) AS totalIncome
      FROM payments
      GROUP BY month
      ORDER BY month DESC
    `);

    // Ingresos y gastos del mes actual
    const [[incomeRow]] = await req.db.query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM payments
       WHERE COALESCE(serviceMonth, DATE_FORMAT(paymentDate,'%Y-%m')) = ?`,
      [mesActual]
    );
    const [[gastosRow]] = await req.db.query(
      `SELECT COALESCE(SUM(monto),0) AS total FROM gastos
       WHERE DATE_FORMAT(fecha,'%Y-%m') = ?`,
      [mesActual]
    );

    // Pagaron el mes pasado pero NO este mes → en riesgo de abandono
    // Usa documento como clave para evitar errores por diferencias en nombres
    const [overduePaymentsRows] = await req.db.query(
      `SELECT DISTINCT s.nombre, p.documento
       FROM payments p
       INNER JOIN students s ON s.documento = p.documento
       WHERE COALESCE(p.serviceMonth, DATE_FORMAT(p.paymentDate,'%Y-%m')) = ?
         AND p.documento IS NOT NULL
         AND s.activo = 1
         AND p.documento NOT IN (
           SELECT DISTINCT documento FROM payments
           WHERE documento IS NOT NULL
             AND COALESCE(serviceMonth, DATE_FORMAT(paymentDate,'%Y-%m')) = ?
         )
       ORDER BY s.nombre ASC LIMIT 100`,
      [mesAnterior, mesActual]
    );

    // Pagaron este mes
    const [upcomingPaymentsRows] = await req.db.query(
      `SELECT DISTINCT s.nombre, p.documento
       FROM payments p
       LEFT JOIN students s ON s.documento = p.documento
       WHERE COALESCE(p.serviceMonth, DATE_FORMAT(p.paymentDate,'%Y-%m')) = ?
         AND p.documento IS NOT NULL
       ORDER BY s.nombre ASC LIMIT 100`,
      [mesActual]
    );

    // Reservas de hoy
    const [[reservasHoy]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM agenda_reservas
       WHERE fecha = ? AND estado = 'confirmado'`,
      [today]
    );

    // Total alumnos activos (para panel de cobro)
    const [[{ totalActivos }]] = await req.db.query(
      `SELECT COUNT(*) AS totalActivos FROM students WHERE activo = 1`
    );

    res.json({
      totalIncome:      Number(totalIncomeRow.totalIncome) || 0,
      totalPayments:    Number(totalPaymentsRow.totalPayments) || 0,
      ingresosMes:      Number(incomeRow.total) || 0,
      gastosMes:        Number(gastosRow.total) || 0,
      saldoMes:         (Number(incomeRow.total) || 0) - (Number(gastosRow.total) || 0),
      reservasHoy:      Number(reservasHoy.total) || 0,
      totalActivos:     Number(totalActivos) || 0,
      paymentsPerMonth,
      overduePayments:  overduePaymentsRows.map(r => r.nombre || r.documento),
      upcomingPayments: upcomingPaymentsRows.map(r => r.nombre || r.documento),
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


// GET /resumen/hoy — actividad del día de hoy
router.get('/resumen/hoy', authenticateToken, async (req, res) => {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  try {
    const [reservas] = await req.db.query(`
      SELECT s.nombre, r.hora, r.fecha, r.created_at
      FROM agenda_reservas r
      JOIN students s ON s.documento = r.documento
      WHERE DATE(CONVERT_TZ(r.created_at, '+00:00', '-03:00')) = ?
        AND r.estado = 'confirmado'
      ORDER BY r.created_at DESC
    `, [hoy]);

    const [cancelaciones] = await req.db.query(`
      SELECT s.nombre, r.hora, r.fecha, r.clase_devuelta, r.cancelado_en
      FROM agenda_reservas r
      JOIN students s ON s.documento = r.documento
      WHERE DATE(CONVERT_TZ(r.cancelado_en, '+00:00', '-03:00')) = ?
        AND r.estado = 'cancelado'
      ORDER BY r.cancelado_en DESC
    `, [hoy]);

    const [pagos] = await req.db.query(`
      SELECT s.nombre, p.subscriptionType, p.amount, p.paymentDate, p.status
      FROM payments p
      JOIN students s ON s.documento = p.documento
      WHERE p.paymentDate = ?
      ORDER BY p.id DESC
    `, [hoy]);

    const [logins] = await req.db.query(`
      SELECT s.nombre, s.email, MAX(t.created_at) AS ultimo_acceso
      FROM student_tokens t
      JOIN students s ON s.documento = t.documento
      WHERE DATE(CONVERT_TZ(t.created_at, '+00:00', '-03:00')) = ?
      GROUP BY t.documento
      ORDER BY ultimo_acceso DESC
    `, [hoy]);

    const [solicitudes] = await req.db.query(`
      SELECT s.nombre, sc.cantidad, sc.nota_alumna, sc.estado, sc.created_at
      FROM solicitudes_clases sc
      JOIN students s ON s.documento = sc.documento
      WHERE DATE(CONVERT_TZ(sc.created_at, '+00:00', '-03:00')) = ?
      ORDER BY sc.created_at DESC
    `, [hoy]);

    res.json({ fecha: hoy, reservas, cancelaciones, pagos, logins, solicitudes });
  } catch (err) {
    console.error('❌ Error resumen hoy:', err.message);
    res.status(500).json({ error: 'Error al obtener actividad del día.' });
  }
});

module.exports = router;
