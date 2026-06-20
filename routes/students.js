// routes/students.js
const express = require('express');
const authenticateToken = require('../authMiddleware');
const router = express.Router();

// 👉 Registrar un nuevo alumno
router.post('/students', authenticateToken, async (req, res) => {
  const { nombre, documento, email, telefono, fechaNacimiento, planActual } = req.body;
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
      'INSERT INTO students (nombre, documento, email, telefono, fecha_nacimiento, plan_actual) VALUES (?, ?, ?, ?, ?, ?)',
      [nombre, documento, email, telefono, fechaNacimiento || null, planActual || null]
    );

    res.json({ id: result.insertId, nombre, documento, email, telefono, fechaNacimiento, planActual });
  } catch (err) {
    console.error("❌ Error al guardar alumno:", err.message);
    res.status(500).json({ error: "Error al guardar alumno" });
  }
});

// 👉 Traer todos los alumnos (con paginación opcional)
router.get('/students', authenticateToken, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1', 10));
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit || '100', 10)));
    const offset = (page - 1) * limit;
    const buscar = req.query.q ? `%${req.query.q}%` : null;

    const whereJoin  = buscar ? 'WHERE s.nombre LIKE ? OR s.documento LIKE ?' : '';
    const whereCount = buscar ? 'WHERE nombre LIKE ? OR documento LIKE ?' : '';
    const params = buscar ? [buscar, buscar, limit, offset] : [limit, offset];

    const [rows] = await req.db.query(
      `SELECT s.*,
              MAX(p.paymentDate) AS ultimoPago,
              MAX(COALESCE(p.serviceMonth, DATE_FORMAT(p.paymentDate,'%Y-%m'))) AS ultimoMesPago
       FROM students s
       LEFT JOIN payments p ON p.documento = s.documento
       ${whereJoin}
       GROUP BY s.id
       ORDER BY s.nombre ASC LIMIT ? OFFSET ?`,
      params
    );
    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM students ${whereCount}`,
      buscar ? [buscar, buscar] : []
    );

    res.json({ students: rows, total, page, limit });
  } catch (err) {
    console.error("❌ Error al obtener alumnos:", err.message);
    res.status(500).json({ error: "Error al obtener alumnos" });
  }
});

// ✏️ Editar alumno
router.put('/students/:documento', authenticateToken, async (req, res) => {
  const { nombre, email, telefono, activo, fechaNacimiento, planActual } = req.body;
  if (!nombre) return res.status(400).json({ error: "El nombre es obligatorio." });
  try {
    const [result] = await req.db.query(
      `UPDATE students SET nombre=?, email=?, telefono=?, activo=?, fecha_nacimiento=?, plan_actual=? WHERE documento=?`,
      [nombre, email || null, telefono || null, activo !== undefined ? activo : 1, fechaNacimiento || null, planActual || null, req.params.documento]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Alumno no encontrado." });
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Error al editar alumno:", err.message);
    res.status(500).json({ error: "Error al editar alumno." });
  }
});

// 🗑️ Desactivar alumno (soft delete)
router.delete('/students/:documento', authenticateToken, async (req, res) => {
  try {
    const [result] = await req.db.query(
      `UPDATE students SET activo=0 WHERE documento=?`,
      [req.params.documento]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Alumno no encontrado." });
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Error al desactivar alumno:", err.message);
    res.status(500).json({ error: "Error al desactivar alumno." });
  }
});

// 📊 Estado de cuenta completo del alumno
router.get('/students/:documento/cuenta', authenticateToken, async (req, res) => {
  const { documento } = req.params;
  try {
    // Datos del alumno
    const [st] = await req.db.query('SELECT * FROM students WHERE documento = ?', [documento]);
    if (!st.length) return res.status(404).json({ error: "Alumno no encontrado." });

    const mesActual = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).substring(0, 7);

    // Último pago
    const [ultimoPago] = await req.db.query(
      `SELECT * FROM payments WHERE documento = ? ORDER BY paymentDate DESC LIMIT 1`,
      [documento]
    );

    // Total pagado histórico
    const [[{ totalPagado }]] = await req.db.query(
      `SELECT COALESCE(SUM(amount), 0) AS totalPagado FROM payments WHERE documento = ?`,
      [documento]
    );

    // Últimos 10 pagos individuales (no agrupados)
    const [pagosRecientes] = await req.db.query(
      `SELECT
         COALESCE(serviceMonth, DATE_FORMAT(paymentDate,'%Y-%m')) AS mes,
         subscriptionType,
         amount AS total,
         paymentDate,
         COALESCE(estadoDeuda, 'al_dia') AS estadoDeuda
       FROM payments WHERE documento = ?
       ORDER BY paymentDate DESC LIMIT 10`,
      [documento]
    );

    // Asistencias por mes (últimos 6 meses)
    const [asistMeses] = await req.db.query(
      `SELECT DATE_FORMAT(fecha,'%Y-%m') AS mes, COUNT(*) AS clases
       FROM attendance WHERE documento = ?
       GROUP BY mes ORDER BY mes DESC LIMIT 6`,
      [documento]
    );

    // Todos los pagos del mes (igual que calcularEstadoAbono — suma clases de múltiples planes)
    const [pagosMes] = await req.db.query(
      `SELECT p.subscriptionType, COALESCE(pc.clases, 0) AS clases
       FROM payments p
       LEFT JOIN planes_config pc ON pc.codigo = p.subscriptionType
       WHERE p.documento = ?
         AND COALESCE(p.serviceMonth, DATE_FORMAT(p.paymentDate,'%Y-%m')) = ?
       ORDER BY COALESCE(pc.clases, 0) DESC, p.paymentDate DESC`,
      [documento, mesActual]
    );
    // Plan principal = el de más clases; total = suma de todos
    let planCodigo    = pagosMes[0]?.subscriptionType || null;
    let clasesPagadas = pagosMes.reduce((s, p) => s + (parseInt(p.clases) || 0), 0);
    let sinPagoRegistrado = false;

    let planInfo = null;
    if (planCodigo) {
      const [plan] = await req.db.query('SELECT * FROM planes_config WHERE codigo = ?', [planCodigo]);
      if (plan[0]) planInfo = { ...plan[0], clases: clasesPagadas };
    } else if (st[0].plan_actual) {
      // Fallback: mismo comportamiento que el portal — usar plan_actual si no hay pago este mes
      const [[pc]] = await req.db.query('SELECT * FROM planes_config WHERE codigo = ?', [st[0].plan_actual]);
      if (pc) {
        planInfo = { ...pc, clases: parseInt(pc.clases) || 0 };
        clasesPagadas = parseInt(pc.clases) || 0;
        sinPagoRegistrado = true;
      }
    }

    // Clases usadas este mes
    const [[{ clasesUsadas }]] = await req.db.query(
      `SELECT COUNT(*) AS clasesUsadas FROM attendance
       WHERE documento = ? AND DATE_FORMAT(fecha,'%Y-%m') = ?`,
      [documento, mesActual]
    );

    // Clases extra devueltas por admin este mes
    const [[{ clasesExtra }]] = await req.db.query(
      `SELECT COALESCE(SUM(cantidad),0) AS clasesExtra FROM clases_extra
       WHERE documento = ? AND mes = ?`,
      [documento, mesActual]
    );

    const clasesTotal = planInfo?.clases || 0;
    const restantes   = Math.max(0, clasesTotal + parseInt(clasesExtra) - clasesUsadas);

    res.json({
      alumno: st[0],
      totalPagado: Number(totalPagado),
      ultimoPago: ultimoPago[0] || null,
      pagosRecientes,
      asistMeses,
      mesActual: {
        plan: planInfo,
        sinPagoRegistrado,
        clasesUsadas,
        clasesTotal,
        clasesExtra: parseInt(clasesExtra),
        restantes
      }
    });
  } catch (err) {
    console.error("❌ Error cuenta alumno:", err.message);
    res.status(500).json({ error: "Error al obtener estado de cuenta." });
  }
});

// ✅ Registrar asistencia rápida
router.post('/asistencia', authenticateToken, async (req, res) => {
  const { documento, fecha, horario } = req.body;
  if (!documento) return res.status(400).json({ error: "Documento requerido." });

  const fechaHoy = fecha || new Date().toISOString().split('T')[0];

  try {
    // Verificar que el alumno existe
    const [rows] = await req.db.query('SELECT nombre FROM students WHERE documento = ?', [documento]);
    if (!rows.length) return res.status(404).json({ error: "Alumno no encontrado." });

    // Evitar duplicado en el mismo día
    const [dup] = await req.db.query(
      'SELECT id FROM attendance WHERE documento = ? AND fecha = ?',
      [documento, fechaHoy]
    );
    if (dup.length) return res.status(409).json({ error: `${rows[0].nombre} ya tiene asistencia registrada hoy.`, nombre: rows[0].nombre });

    await req.db.query(
      'INSERT INTO attendance (documento, fecha, horario) VALUES (?, ?, ?)',
      [documento, fechaHoy, horario || null]
    );

    res.json({ ok: true, nombre: rows[0].nombre, fecha: fechaHoy });
  } catch (err) {
    console.error("❌ Error registrar asistencia:", err.message);
    res.status(500).json({ error: "Error al registrar asistencia." });
  }
});

// 📋 Asistencias del día
router.get('/asistencia/hoy', authenticateToken, async (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
  try {
    const [rows] = await req.db.query(
      `SELECT a.id, a.documento, a.fecha, a.horario, a.created_at, s.nombre
       FROM attendance a
       LEFT JOIN students s ON s.documento = a.documento
       WHERE a.fecha = ?
       ORDER BY a.created_at DESC`,
      [fecha]
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ Error asistencias hoy:", err.message);
    res.status(500).json({ error: "Error al obtener asistencias." });
  }
});

// 📊 Resumen de asistencias de un mes
router.get('/asistencia/mes/:mes', authenticateToken, async (req, res) => {
  const { mes } = req.params;
  try {
    // KPIs
    const [[{ total, alumnas, diasConClase }]] = await req.db.query(
      `SELECT COUNT(*) AS total,
              COUNT(DISTINCT documento) AS alumnas,
              COUNT(DISTINCT fecha) AS diasConClase
       FROM attendance WHERE DATE_FORMAT(fecha,'%Y-%m') = ?`,
      [mes]
    );
    // Ranking top 10
    const [ranking] = await req.db.query(
      `SELECT a.documento, s.nombre, COUNT(*) AS clases
       FROM attendance a
       LEFT JOIN students s ON s.documento = a.documento
       WHERE DATE_FORMAT(a.fecha,'%Y-%m') = ?
       GROUP BY a.documento, s.nombre
       ORDER BY clases DESC LIMIT 10`,
      [mes]
    );
    res.json({ total: Number(total), alumnas: Number(alumnas), diasConClase: Number(diasConClase), ranking });
  } catch (err) {
    console.error("❌ Error asistencia mes:", err.message);
    res.status(500).json({ error: "Error al obtener resumen del mes." });
  }
});

// 🗑️ Eliminar asistencia
router.delete('/asistencia/:id', authenticateToken, async (req, res) => {
  try {
    const [result] = await req.db.query('DELETE FROM attendance WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Asistencia no encontrada." });
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Error eliminar asistencia:", err.message);
    res.status(500).json({ error: "Error al eliminar asistencia." });
  }
});

module.exports = router;
