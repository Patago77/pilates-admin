const express = require('express');
const authenticateToken = require('../authMiddleware');

const router = express.Router();

// Mantiene plan_actual del alumno sincronizado con su último plan de pago
async function syncPlanActual(db, documento, plan) {
  if (!documento || !plan) return;
  try {
    await db.query(`UPDATE students SET plan_actual=? WHERE documento=?`, [plan, documento]);
  } catch(e) {
    console.warn('⚠️ syncPlanActual falló:', e.message);
  }
}

// Migración segura: agrega columnas nuevas si aún no existen en la DB del estudio
const _paymentColsReady = new WeakSet();
async function ensurePaymentColumns(db) {
  if (_paymentColsReady.has(db)) return;
  const migrations = [
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS serviceMonth VARCHAR(7) DEFAULT NULL`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS metodoPago VARCHAR(30) DEFAULT NULL`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS estadoDeuda ENUM('al_dia','debe','le_debemos') DEFAULT 'al_dia'`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS comentarios TEXT DEFAULT NULL`,
  ];
  for (const sql of migrations) {
    await db.query(sql).catch(e => console.warn('⚠️ migration:', e.message));
  }
  _paymentColsReady.add(db);
}

// 📥 Registrar un pago con validación y monto incluido
router.post('/payments', authenticateToken, async (req, res) => {
  const { fullName, subscriptionType, paymentDate, amount, documento, serviceMonth, comentarios, metodoPago, estadoDeuda } = req.body;

  if (!fullName || !subscriptionType || !paymentDate || isNaN(amount)) {
    return res.status(400).json({ error: "Todos los campos son obligatorios y el monto debe ser válido." });
  }

  const mesServicio = serviceMonth || paymentDate.substring(0, 7);
  const estadoFinal = ['al_dia','debe','le_debemos'].includes(estadoDeuda) ? estadoDeuda : 'al_dia';

  try {
    await ensurePaymentColumns(req.db);
    const [result] = await req.db.query(
      `INSERT INTO payments (fullName, subscriptionType, paymentDate, amount, documento, serviceMonth, metodoPago, estadoDeuda, comentarios)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fullName, subscriptionType, paymentDate, amount, documento || null, mesServicio, metodoPago || null, estadoFinal, comentarios || null]
    );
    await syncPlanActual(req.db, documento, subscriptionType);
    res.json({ id: result.insertId, fullName, subscriptionType, paymentDate, amount, documento: documento || null, serviceMonth: mesServicio, estadoDeuda: estadoFinal });
  } catch (err) {
    console.error("❌ Error al guardar pago:", err.message);
    res.status(500).json({ error: "Error al guardar el pago." });
  }
});

// ✏️ Editar un pago existente por ID
router.put('/payments/:id', authenticateToken, async (req, res) => {
  const paymentId = req.params.id;
  const { fullName, subscriptionType, paymentDate, amount, documento, estadoDeuda, metodoPago, comentarios } = req.body;

  if (!fullName || !subscriptionType || !paymentDate || isNaN(amount)) {
    return res.status(400).json({ error: "Todos los campos son obligatorios y el monto debe ser válido." });
  }

  const estadoFinal = ['al_dia','debe','le_debemos'].includes(estadoDeuda) ? estadoDeuda : null;

  try {
    await ensurePaymentColumns(req.db);

    if (documento === undefined) {
      const [result] = await req.db.query(
        `UPDATE payments
         SET fullName = ?, subscriptionType = ?, paymentDate = ?, amount = ?
             ${estadoFinal !== null ? ', estadoDeuda = ?' : ''}
             ${metodoPago !== undefined ? ', metodoPago = ?' : ''}
             ${comentarios !== undefined ? ', comentarios = ?' : ''}
         WHERE id = ?`,
        [fullName, subscriptionType, paymentDate, amount,
         ...(estadoFinal !== null ? [estadoFinal] : []),
         ...(metodoPago !== undefined ? [metodoPago || null] : []),
         ...(comentarios !== undefined ? [comentarios || null] : []),
         paymentId]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: "Pago no encontrado." });
      const [[pago]] = await req.db.query(`SELECT documento FROM payments WHERE id=?`, [paymentId]);
      await syncPlanActual(req.db, pago?.documento, subscriptionType);
      return res.json({ message: "Pago actualizado correctamente" });
    }

    const doc = String(documento).trim();
    if (!doc) return res.status(400).json({ error: "El documento no puede estar vacío." });

    const [result] = await req.db.query(
      `UPDATE payments
       SET fullName = ?, subscriptionType = ?, paymentDate = ?, amount = ?, documento = ?
           ${estadoFinal !== null ? ', estadoDeuda = ?' : ''}
           ${metodoPago !== undefined ? ', metodoPago = ?' : ''}
           ${comentarios !== undefined ? ', comentarios = ?' : ''}
       WHERE id = ?`,
      [fullName, subscriptionType, paymentDate, amount, doc,
       ...(estadoFinal !== null ? [estadoFinal] : []),
       ...(metodoPago !== undefined ? [metodoPago || null] : []),
       ...(comentarios !== undefined ? [comentarios || null] : []),
       paymentId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Pago no encontrado." });
    await syncPlanActual(req.db, doc, subscriptionType);

    res.json({ message: "Pago actualizado correctamente" });
  } catch (err) {
    console.error("❌ Error al editar pago:", err.message);
    res.status(500).json({ error: "Error al editar el pago." });
  }
});

// Obtener pagos con paginación y búsqueda opcional
router.get('/payments', authenticateToken, async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  || '1', 10));
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit || '100', 10)));
    const offset = (page - 1) * limit;
    const buscar = req.query.q ? `%${req.query.q}%` : null;
    const mes    = req.query.mes || null; // formato YYYY-MM

    const conds = [];
    const params = [];
    if (buscar) { conds.push('(fullName LIKE ? OR documento LIKE ?)'); params.push(buscar, buscar); }
    if (mes)    { conds.push("DATE_FORMAT(paymentDate,'%Y-%m') = ?"); params.push(mes); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const [rows] = await req.db.query(
      `SELECT * FROM payments ${where} ORDER BY paymentDate DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM payments ${where}`,
      params
    );

    res.json({ payments: rows, total, page, limit });
  } catch (err) {
    console.error("❌ Error al obtener pagos:", err.message);
    res.status(500).json({ error: "Error al obtener pagos" });
  }
});

// 📄 Obtener un pago por ID
router.get('/payments/:id', authenticateToken, async (req, res) => {
  const paymentId = req.params.id;

  try {
    const [rows] = await req.db.query('SELECT * FROM payments WHERE id = ?', [paymentId]);
    if (rows.length === 0) return res.status(404).json({ error: "Pago no encontrado." });
    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Error al obtener pago por ID:", err.message);
    res.status(500).json({ error: "Error al obtener el pago." });
  }
});

// 🔄 Busca por documento **O** por nombre
router.get('/payments/buscar/:query', authenticateToken, async (req, res) => {
  const query = (req.params.query || '').trim();
  if (!query) return res.status(400).json({ error: "La búsqueda no puede estar vacía" });

  try {
    const [rows] = await req.db.query(
      `SELECT * FROM payments
       WHERE documento = ? OR fullName LIKE ?
       ORDER BY paymentDate DESC`,
      [query, `%${query}%`]
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ Error al buscar pagos:", err.message);
    res.status(500).json({ error: "Error al buscar pagos" });
  }
});

// 🗑️ Eliminar un pago por ID
router.delete('/payments/:id', authenticateToken, async (req, res) => {
  const paymentId = req.params.id;

  try {
    // Guardar documento y plan antes de borrar para re-sincronizar
    const [[pago]] = await req.db.query(`SELECT documento, subscriptionType FROM payments WHERE id=?`, [paymentId]);
    const [result] = await req.db.query('DELETE FROM payments WHERE id = ?', [paymentId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Pago no encontrado' });

    // Recalcular plan_actual desde el pago más reciente del alumno
    if (pago?.documento) {
      const [[ultimo]] = await req.db.query(
        `SELECT subscriptionType FROM payments WHERE documento=? ORDER BY paymentDate DESC LIMIT 1`,
        [pago.documento]
      );
      // Si queda otro pago, usamos ese plan; si no, no tocamos plan_actual (queda como estaba)
      if (ultimo) await syncPlanActual(req.db, pago.documento, ultimo.subscriptionType);
    }

    res.json({ message: 'Pago eliminado correctamente' });
  } catch (err) {
    console.error("❌ Error al eliminar pago:", err.message);
    res.status(500).json({ error: 'Error al eliminar el pago.' });
  }
});

// 📈 Alumnos activos por mes
router.get('/alumnos/mensuales', authenticateToken, async (req, res) => {
  try {
    const [results] = await req.db.query(`
      SELECT COALESCE(serviceMonth, DATE_FORMAT(paymentDate,'%Y-%m')) AS mes,
             COUNT(DISTINCT documento) AS cantidad
      FROM payments
      WHERE documento IS NOT NULL
      GROUP BY mes
      ORDER BY mes
    `);
    res.json(results);
  } catch (err) {
    console.error("❌ Error al obtener alumnos por mes:", err.message);
    res.status(500).json({ error: "Error al obtener alumnos por mes." });
  }
});

// 📊 Estado de abono del mes actual por documento
router.get('/abono/:documento', authenticateToken, async (req, res) => {
  const { documento } = req.params;
  const mesActual = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).substring(0, 7);

  try {
    // Último pago del alumno en el mes actual
    const [pagos] = await req.db.query(
      `SELECT subscriptionType FROM payments
       WHERE documento = ? AND COALESCE(serviceMonth, DATE_FORMAT(paymentDate, '%Y-%m')) = ?
       ORDER BY paymentDate DESC LIMIT 1`,
      [documento, mesActual]
    );

    // Si no hay pago este mes, usar plan_actual del perfil de la alumna
    const [alumna] = await req.db.query(`SELECT plan_actual FROM students WHERE documento = ?`, [documento]);
    const subscriptionType = pagos[0]?.subscriptionType || alumna[0]?.plan_actual || null;

    // Clases del plan (0 si no hay plan o es personalizado)
    let clasesAbono = 0;
    let personalizado = false;
    if (subscriptionType) {
      const [plan] = await req.db.query(
        `SELECT clases FROM planes_config WHERE codigo = ? LIMIT 1`,
        [subscriptionType]
      );
      if (plan[0]) {
        clasesAbono = plan[0].clases;
      } else {
        personalizado = true;
      }
    }

    // Asistencias del mes
    const [asist] = await req.db.query(
      `SELECT COUNT(*) AS total FROM attendance
       WHERE documento = ? AND DATE_FORMAT(fecha, '%Y-%m') = ?`,
      [documento, mesActual]
    );
    const clasesUsadas = asist[0]?.total || 0;

    res.json({
      documento,
      subscriptionType,
      clases_abono: clasesAbono,
      clases_usadas: clasesUsadas,
      restantes: Math.max(0, clasesAbono - clasesUsadas),
      personalizado
    });
  } catch (err) {
    console.error("❌ Error al obtener abono:", err.message);
    res.status(500).json({ error: "Error al obtener estado del abono." });
  }
});

// 💳 Ingresos por tipo de abono
router.get('/estadisticas/abonos', authenticateToken, async (req, res) => {
  try {
    const [results] = await req.db.query(`
      SELECT subscriptionType AS tipo_abono, SUM(amount) AS total
      FROM payments
      GROUP BY subscriptionType
    `);
    res.json(results);
  } catch (err) {
    console.error("❌ Error al obtener ingresos por abono:", err.message);
    res.status(500).json({ error: "Error al obtener ingresos por abono." });
  }
});

// ============================================================
// PLANES (planes_config)
// ============================================================
router.get('/planes', authenticateToken, async (req, res) => {
  try {
    const [rows] = await req.db.query('SELECT * FROM planes_config ORDER BY precio ASC');
    res.json(rows);
  } catch (err) {
    console.error('❌ Error GET planes:', err.message);
    res.status(500).json({ error: 'Error al obtener planes.' });
  }
});

router.post('/planes', authenticateToken, async (req, res) => {
  const { codigo, nombre, clases, precio } = req.body;
  if (!codigo || !nombre) return res.status(400).json({ error: 'Código y nombre son obligatorios.' });
  try {
    await req.db.query(
      'INSERT INTO planes_config (codigo, nombre, clases, precio) VALUES (?, ?, ?, ?)',
      [codigo, nombre, parseInt(clases) || 0, parseFloat(precio) || 0]
    );
    const [[plan]] = await req.db.query('SELECT * FROM planes_config WHERE codigo = ?', [codigo]);
    res.status(201).json(plan);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Ya existe un plan con ese código.' });
    console.error('❌ Error POST planes:', err.message);
    res.status(500).json({ error: 'Error al crear plan.' });
  }
});

router.put('/planes/:codigo', authenticateToken, async (req, res) => {
  const { nombre, clases, precio } = req.body;
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });
  try {
    const [result] = await req.db.query(
      'UPDATE planes_config SET nombre=?, clases=?, precio=? WHERE codigo=?',
      [nombre, parseInt(clases) || 0, parseFloat(precio) || 0, req.params.codigo]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Plan no encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Error PUT planes:', err.message);
    res.status(500).json({ error: 'Error al actualizar plan.' });
  }
});

router.delete('/planes/:codigo', authenticateToken, async (req, res) => {
  try {
    const [result] = await req.db.query('DELETE FROM planes_config WHERE codigo=?', [req.params.codigo]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Plan no encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Error DELETE planes:', err.message);
    res.status(500).json({ error: 'Error al eliminar plan.' });
  }
});

// ============================================================
// PAGOS PENDIENTES — lado admin
// ============================================================

// GET /admin/pagos-pendientes
router.get('/admin/pagos-pendientes', authenticateToken, async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT * FROM pagos_pendientes WHERE estado='pendiente' ORDER BY created_at ASC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Error al obtener pagos pendientes.' }); }
});

// POST /admin/pagos-pendientes/:id/confirmar — convierte en pago real
router.post('/admin/pagos-pendientes/:id/confirmar', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    // UPDATE atómico: solo avanza si el estado es 'pendiente', previene doble confirmación
    const [lock] = await req.db.query(
      `UPDATE pagos_pendientes SET estado='procesando' WHERE id=? AND estado='pendiente'`,
      [id]
    );
    if (lock.affectedRows === 0) {
      return res.status(409).json({ error: 'Este pago ya fue confirmado o no existe.' });
    }

    const [[p]] = await req.db.query(`SELECT * FROM pagos_pendientes WHERE id=?`, [id]);
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const mes = hoy.substring(0, 7);

    // Registrar como pago real
    await req.db.query(
      `INSERT INTO payments (fullName, subscriptionType, paymentDate, amount, documento, serviceMonth)
       VALUES (?,?,?,?,?,?)`,
      [p.nombre, p.plan, hoy, p.monto, p.documento, mes]
    );
    // Mantener plan_actual del alumno sincronizado
    await syncPlanActual(req.db, p.documento, p.plan);
    // Marcar como confirmado
    await req.db.query(`UPDATE pagos_pendientes SET estado='confirmado' WHERE id=?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    // Si falla después del lock, revertir a 'pendiente' para que se pueda reintentar
    try { await req.db.query(`UPDATE pagos_pendientes SET estado='pendiente' WHERE id=? AND estado='procesando'`, [id]); } catch {}
    console.error('❌ Error confirmar pago:', err.message);
    res.status(500).json({ error: 'Error al confirmar.' });
  }
});

// DELETE /admin/pagos-pendientes/:id — rechazar
router.delete('/admin/pagos-pendientes/:id', authenticateToken, async (req, res) => {
  try {
    await req.db.query(`UPDATE pagos_pendientes SET estado='rechazado' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Error al rechazar.' }); }
});

// ============================================================
// CONFIG PAGO (CBU / alias) — admin
// ============================================================
const _configTableReady = new WeakSet();
async function ensureConfigTable(db) {
  if (_configTableReady.has(db)) return;
  await db.query(`CREATE TABLE IF NOT EXISTS studio_config (
    clave VARCHAR(80) PRIMARY KEY, valor TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
  _configTableReady.add(db);
}

router.get('/admin/config-pago', authenticateToken, async (req, res) => {
  try {
    await ensureConfigTable(req.db);
    const [rows] = await req.db.query(`SELECT clave, valor FROM studio_config WHERE clave LIKE 'pago_%'`);
    const cfg = {};
    rows.forEach(r => { cfg[r.clave.replace('pago_', '')] = r.valor; });
    res.json(cfg);
  } catch (err) { res.status(500).json({ error: 'Error al obtener config.' }); }
});

router.post('/admin/config-pago', authenticateToken, async (req, res) => {
  try {
    await ensureConfigTable(req.db);
    const campos = ['cbu', 'alias', 'titular', 'alias_mp', 'titular_mp'];
    for (const campo of campos) {
      if (req.body[campo] !== undefined) {
        await req.db.query(
          `INSERT INTO studio_config (clave, valor) VALUES (?,?) ON DUPLICATE KEY UPDATE valor=VALUES(valor)`,
          [`pago_${campo}`, req.body[campo]]
        );
      }
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Error al guardar config.' }); }
});

module.exports = router;
