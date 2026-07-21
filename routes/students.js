// routes/students.js
const express = require('express');
const authenticateToken = require('../authMiddleware');
const { calcularEstadoAbono } = require('./agenda');
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

// 🔄 Cambiar DNI de un alumno (cascada en todas las tablas)
router.put('/students/:documento/cambiar-documento', authenticateToken, async (req, res) => {
  const { nuevoDocumento } = req.body;
  const docViejo = req.params.documento;
  if (!nuevoDocumento) return res.status(400).json({ error: "Nuevo documento requerido." });
  if (nuevoDocumento === docViejo) return res.status(400).json({ error: "El documento es igual al actual." });
  const conn = await req.db.getConnection();
  try {
    await conn.beginTransaction();
    const [[existe]] = await conn.query('SELECT id FROM students WHERE documento = ?', [nuevoDocumento]);
    if (existe) { await conn.rollback(); conn.release(); return res.status(409).json({ error: "Ya existe un alumno con ese DNI." }); }
    await conn.query('UPDATE payments SET documento=? WHERE documento=?', [nuevoDocumento, docViejo]);
    await conn.query('UPDATE agenda_reservas SET documento=? WHERE documento=?', [nuevoDocumento, docViejo]);
    await conn.query('UPDATE attendance SET documento=? WHERE documento=?', [nuevoDocumento, docViejo]);
    await conn.query('UPDATE student_tokens SET documento=? WHERE documento=?', [nuevoDocumento, docViejo]);
    await conn.query('UPDATE students SET documento=? WHERE documento=?', [nuevoDocumento, docViejo]);
    await conn.commit();
    conn.release();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error("❌ Error cambiar documento:", err.message);
    res.status(500).json({ error: "Error al cambiar el documento." });
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

// 🔄 Activar/desactivar alumno (toggle rápido desde el listado)
router.patch('/students/:documento/activo', authenticateToken, async (req, res) => {
  const { activo } = req.body;
  try {
    const [result] = await req.db.query(
      `UPDATE students SET activo=? WHERE documento=?`,
      [activo ? 1 : 0, req.params.documento]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Alumno no encontrado." });
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Error al actualizar estado del alumno:", err.message);
    res.status(500).json({ error: "Error al actualizar el estado." });
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

    // Reservas recientes — últimos 2 meses
    const [reservasMes] = await req.db.query(
      `SELECT id, fecha, hora, estado, motivo_consumo, clase_devuelta
       FROM agenda_reservas
       WHERE documento = ? AND fecha >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH),'%Y-%m-01')
       ORDER BY fecha DESC, hora DESC
       LIMIT 40`,
      [documento]
    );

    // Asistencias por mes — desde agenda_reservas (últimos 6 meses)
    const [asistMeses] = await req.db.query(
      `SELECT DATE_FORMAT(fecha,'%Y-%m') AS mes, COUNT(*) AS clases
       FROM agenda_reservas
       WHERE documento = ? AND estado = 'confirmado'
         AND (motivo_consumo IS NULL OR motivo_consumo != 'ausente')
       GROUP BY mes ORDER BY mes DESC LIMIT 6`,
      [documento]
    );

    // Estado completo del mes — misma lógica que el portal (cruce reservas + asistencias)
    const estadoMes = await calcularEstadoAbono(req.db, documento, mesActual);

    res.json({
      alumno: st[0],
      totalPagado: Number(totalPagado),
      ultimoPago: ultimoPago[0] || null,
      pagosRecientes,
      asistMeses,
      mesActual: {
        plan: estadoMes.plan,
        sinPagoRegistrado: estadoMes.sin_pago_registrado,
        clasesUsadas: estadoMes.consumidas,
        clasesTotal: estadoMes.clases_plan,
        clasesExtra: estadoMes.extra_admin,
        restantes: estadoMes.restantes,
        reservasActivas: estadoMes.reservas_activas,
        asistidas: estadoMes.asistidas,
        ausencias: estadoMes.ausencias
      },
      reservasMes
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

// 📋 Asistencias del día — lee de agenda_reservas (reservas confirmadas)
router.get('/asistencia/hoy', authenticateToken, async (req, res) => {
  const fecha = req.query.fecha || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  try {
    const [rows] = await req.db.query(
      `SELECT ar.id, ar.documento, ar.fecha, ar.hora AS horario, ar.created_at, ar.motivo_consumo, s.nombre
       FROM agenda_reservas ar
       JOIN students s ON s.documento = ar.documento
       WHERE ar.fecha = ? AND ar.estado = 'confirmado'
       ORDER BY ar.hora ASC, s.nombre ASC`,
      [fecha]
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ Error asistencias hoy:", err.message);
    res.status(500).json({ error: "Error al obtener asistencias." });
  }
});

// 📊 Resumen de asistencias de un mes — lee de agenda_reservas
router.get('/asistencia/mes/:mes', authenticateToken, async (req, res) => {
  const { mes } = req.params;
  try {
    const [[{ total, alumnas, diasConClase }]] = await req.db.query(
      `SELECT COUNT(*) AS total,
              COUNT(DISTINCT documento) AS alumnas,
              COUNT(DISTINCT fecha) AS diasConClase
       FROM agenda_reservas WHERE DATE_FORMAT(fecha,'%Y-%m') = ? AND estado = 'confirmado'`,
      [mes]
    );
    const [ranking] = await req.db.query(
      `SELECT ar.documento, s.nombre, COUNT(*) AS clases
       FROM agenda_reservas ar
       JOIN students s ON s.documento = ar.documento
       WHERE DATE_FORMAT(ar.fecha,'%Y-%m') = ? AND ar.estado = 'confirmado'
       GROUP BY ar.documento, s.nombre
       ORDER BY clases DESC LIMIT 10`,
      [mes]
    );
    res.json({ total: Number(total), alumnas: Number(alumnas), diasConClase: Number(diasConClase), ranking });
  } catch (err) {
    console.error("❌ Error asistencia mes:", err.message);
    res.status(500).json({ error: "Error al obtener resumen del mes." });
  }
});

// 📋 Historial de asistencias (tabla attendance) de un alumno puntual
router.get('/asistencia/alumno/:documento', authenticateToken, async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT id, fecha, horario FROM attendance WHERE documento = ? ORDER BY fecha DESC LIMIT 100`,
      [req.params.documento]
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ Error historial asistencias alumno:", err.message);
    res.status(500).json({ error: "Error al obtener el historial de asistencias." });
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

// 📋 Alumnos con reserva en un slot — para tomar asistencia
router.get('/asistencia/slot', authenticateToken, async (req, res) => {
  const { fecha, hora } = req.query;
  if (!fecha || !hora) return res.status(400).json({ error: 'Fecha y hora requeridas.' });
  try {
    const [rows] = await req.db.query(
      `SELECT ar.id, ar.documento, ar.motivo_consumo, s.nombre
       FROM agenda_reservas ar
       JOIN students s ON s.documento = ar.documento
       WHERE ar.fecha = ? AND ar.hora = ? AND ar.estado = 'confirmado'
       ORDER BY s.nombre`,
      [fecha, hora]
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Error slot asistencia:', err.message);
    res.status(500).json({ error: 'Error al obtener el slot.' });
  }
});

// ❌ Marcar alumno como ausente en un slot
router.post('/asistencia/ausente/:id', authenticateToken, async (req, res) => {
  try {
    await req.db.query(
      `UPDATE agenda_reservas SET motivo_consumo = 'ausente' WHERE id = ?`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Error marcar ausente:', err.message);
    res.status(500).json({ error: 'Error al marcar ausente.' });
  }
});

// ✅ Desmarcar ausente (vino a clase)
router.delete('/asistencia/ausente/:id', authenticateToken, async (req, res) => {
  try {
    await req.db.query(
      `UPDATE agenda_reservas SET motivo_consumo = NULL WHERE id = ? AND motivo_consumo = 'ausente'`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Error desmarcar ausente:', err.message);
    res.status(500).json({ error: 'Error al actualizar.' });
  }
});

module.exports = router;
