const express = require('express');
const authenticateToken = require('../authMiddleware');

const router = express.Router();

const _configTableReady = new WeakSet();
async function ensureConfigTable(db) {
  if (_configTableReady.has(db)) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS studio_config (
      clave VARCHAR(80) PRIMARY KEY,
      valor TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  _configTableReady.add(db);
}

// ============================================================
// GET /stats/salud
// ============================================================
router.get('/stats/salud', authenticateToken, async (req, res) => {
  try {
    const mesActualAR = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).substring(0, 7);
    const [yAR, mAR] = mesActualAR.split('-').map(Number);
    const mesAnteriorAR = mAR === 1 ? `${yAR - 1}-12` : `${yAR}-${String(mAR - 1).padStart(2, '0')}`;

    // Ingresos del mes (por serviceMonth o paymentDate)
    const [[{ ingresos }]] = await req.db.query(
      `SELECT COALESCE(SUM(amount), 0) AS ingresos FROM payments
       WHERE COALESCE(serviceMonth, DATE_FORMAT(paymentDate,'%Y-%m')) = ?`,
      [mesActualAR]
    );

    // Gastos del mes
    const [[{ gastos }]] = await req.db.query(
      `SELECT COALESCE(SUM(monto), 0) AS gastos FROM gastos
       WHERE DATE_FORMAT(fecha, '%Y-%m') = ?`,
      [mesActualAR]
    );

    // Ticket promedio y máximo
    const [[{ ticket_promedio, ticket_max }]] = await req.db.query(
      `SELECT COALESCE(AVG(amount), 0) AS ticket_promedio,
              COALESCE(MAX(amount), 0) AS ticket_max
       FROM payments
       WHERE COALESCE(serviceMonth, DATE_FORMAT(paymentDate,'%Y-%m')) = ?`,
      [mesActualAR]
    );

    // Alumnos que pagaron este mes
    const [[{ alumnos_pagaron }]] = await req.db.query(
      `SELECT COUNT(DISTINCT documento) AS alumnos_pagaron FROM payments
       WHERE documento IS NOT NULL
         AND COALESCE(serviceMonth, DATE_FORMAT(paymentDate,'%Y-%m')) = ?`,
      [mesActualAR]
    );

    // Alumnos en riesgo: tuvieron asistencia el mes pasado pero no este mes
    const [[{ en_riesgo }]] = await req.db.query(
      `SELECT COUNT(DISTINCT documento) AS en_riesgo FROM attendance
       WHERE DATE_FORMAT(fecha, '%Y-%m') = ?
         AND documento NOT IN (
           SELECT DISTINCT documento FROM attendance
           WHERE DATE_FORMAT(fecha, '%Y-%m') = ?
         )`,
      [mesAnteriorAR, mesActualAR]
    );

    // Tasa de cobranza: alumnos activos (vinieron en los últimos 2 meses) que pagaron este mes
    const [[{ activos_recientes }]] = await req.db.query(
      `SELECT COUNT(DISTINCT documento) AS activos_recientes FROM attendance
       WHERE DATE_FORMAT(fecha, '%Y-%m') IN (?, ?)`,
      [mesActualAR, mesAnteriorAR]
    );

    const tasa_cobranza = activos_recientes > 0
      ? Math.min(100, Math.round((alumnos_pagaron / activos_recientes) * 100))
      : 0;

    const margen = ingresos > 0
      ? Math.round(((ingresos - gastos) / ingresos) * 100)
      : 0;

    // Score compuesto
    const score = Math.min(100, Math.round(
      (tasa_cobranza * 0.4) +
      (Math.max(0, margen) * 0.4) +
      (en_riesgo === 0 ? 20 : en_riesgo <= 3 ? 10 : 0)
    ));

    // Potencial: alumnos activos sin pago este mes * ticket promedio
    const [[{ sin_pagar }]] = await req.db.query(
      `SELECT COUNT(DISTINCT documento) AS sin_pagar FROM attendance
       WHERE DATE_FORMAT(fecha, '%Y-%m') = ?
         AND documento NOT IN (
           SELECT DISTINCT documento FROM payments
           WHERE documento IS NOT NULL
             AND COALESCE(serviceMonth, DATE_FORMAT(paymentDate,'%Y-%m')) = ?
         )`,
      [mesActualAR, mesActualAR]
    );

    res.json({
      score,
      tasa_cobranza,
      margen,
      ticket_promedio: Math.round(ticket_promedio),
      ticket_max: Math.round(ticket_max),
      en_riesgo,
      potencial: {
        total: Math.round(sin_pagar * ticket_promedio)
      }
    });
  } catch (err) {
    console.error('❌ Error stats/salud:', err.message);
    res.status(500).json({ error: 'Error al calcular salud del estudio.' });
  }
});

// ============================================================
// GET /stats/reformers  — lee config guardada
// POST /stats/reformers — guarda config
// ============================================================
router.get('/stats/reformers', authenticateToken, async (req, res) => {
  try {
    await ensureConfigTable(req.db);
    const [rows] = await req.db.query(
      `SELECT clave, valor FROM studio_config WHERE clave LIKE 'rf_%'`
    );
    const config = {};
    rows.forEach(r => {
      try { config[r.clave.replace('rf_', '')] = JSON.parse(r.valor); }
      catch { config[r.clave.replace('rf_', '')] = r.valor; }
    });
    res.json(config);
  } catch (err) {
    console.error('❌ Error GET reformers:', err.message);
    res.status(500).json({ error: 'Error al cargar config reformers.' });
  }
});

router.post('/stats/reformers', authenticateToken, async (req, res) => {
  try {
    await ensureConfigTable(req.db);
    const campos = ['cantidad', 'precio_clase', 'precio_alquiler', 'sueldo_profe', 'precio_clase_profe', 'alumnos_por_reformer', 'horario'];
    for (const campo of campos) {
      if (req.body[campo] !== undefined) {
        await req.db.query(
          `INSERT INTO studio_config (clave, valor) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
          [`rf_${campo}`, JSON.stringify(req.body[campo])]
        );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Error POST reformers:', err.message);
    res.status(500).json({ error: 'Error al guardar config reformers.' });
  }
});

// ============================================================
// GET /stats/informe-mes
// ============================================================
router.get('/stats/informe-mes', authenticateToken, async (req, res) => {
  try {
    const ahoraAR  = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const mesActual = ahoraAR.substring(0, 7);
    const dia = parseInt(ahoraAR.split('-')[2]);
    const [yM, mM] = mesActual.split('-').map(Number);

    const periodo_cobro_activo = dia >= 1 && dia <= 10;
    const primeroDeSiguiente = new Date(yM, mM, 1); // mM es 1-indexado → new Date(yM, mM) = 1ro del mes siguiente
    const dias_para_cobro = Math.ceil((primeroDeSiguiente - new Date()) / (1000 * 60 * 60 * 24));

    // Sin pagar: vinieron este mes pero no tienen pago registrado
    const [sinPagarRows] = await req.db.query(
      `SELECT DISTINCT a.documento, s.nombre, s.telefono
       FROM attendance a
       LEFT JOIN students s ON s.documento = a.documento
       WHERE DATE_FORMAT(a.fecha, '%Y-%m') = ?
         AND a.documento NOT IN (
           SELECT DISTINCT documento FROM payments
           WHERE documento IS NOT NULL
             AND COALESCE(serviceMonth, DATE_FORMAT(paymentDate, '%Y-%m')) = ?
         )`,
      [mesActual, mesActual]
    );

    // Sin venir: pagaron este mes pero no tienen asistencia
    const [sinVenirRows] = await req.db.query(
      `SELECT DISTINCT p.documento, p.fullName AS nombre, s.telefono
       FROM payments p
       LEFT JOIN students s ON s.documento = p.documento
       WHERE p.documento IS NOT NULL
         AND COALESCE(p.serviceMonth, DATE_FORMAT(p.paymentDate, '%Y-%m')) = ?
         AND p.documento NOT IN (
           SELECT DISTINCT documento FROM attendance
           WHERE DATE_FORMAT(fecha, '%Y-%m') = ?
         )`,
      [mesActual, mesActual]
    );

    // No volvieron: tuvieron asistencia hace 2+ meses y no este mes ni el pasado
    const mesAnterior = mM === 1
      ? `${yM - 1}-12`
      : `${yM}-${String(mM - 1).padStart(2, '0')}`;

    const [[{ no_volvieron }]] = await req.db.query(
      `SELECT COUNT(DISTINCT documento) AS no_volvieron FROM attendance
       WHERE documento NOT IN (
         SELECT DISTINCT documento FROM attendance
         WHERE DATE_FORMAT(fecha, '%Y-%m') IN (?, ?)
       )`,
      [mesActual, mesAnterior]
    );

    // Regulares: vinieron al menos 2 de los últimos 3 meses
    const [[{ regulares }]] = await req.db.query(
      `SELECT COUNT(*) AS regulares FROM (
         SELECT documento, COUNT(DISTINCT DATE_FORMAT(fecha,'%Y-%m')) AS meses
         FROM attendance
         WHERE fecha >= DATE_SUB(LAST_DAY(NOW()), INTERVAL 3 MONTH)
         GROUP BY documento
         HAVING meses >= 2
       ) t`
    );

    res.json({
      periodo_cobro_activo,
      dias_para_cobro,
      sin_pagar: sinPagarRows,
      sin_venir: sinVenirRows,
      no_volvieron,
      regulares
    });
  } catch (err) {
    console.error('❌ Error stats/informe-mes:', err.message);
    res.status(500).json({ error: 'Error al generar informe del mes.' });
  }
});

// GET /stats/alumnos-aviso?filtro=todos|conAbono|sinPago|inactivos
router.get('/stats/alumnos-aviso', authenticateToken, async (req, res) => {
  const filtro = req.query.filtro || 'todos';
  try {
    let rows;
    const mes = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).substring(0, 7);

    if (filtro === 'conAbono') {
      [rows] = await req.db.query(
        `SELECT DISTINCT s.documento, s.nombre, s.telefono, s.email
         FROM students s
         INNER JOIN payments p ON p.documento = s.documento
           AND COALESCE(p.serviceMonth, DATE_FORMAT(p.paymentDate,'%Y-%m')) = ?
         WHERE s.activo = 1
         ORDER BY s.nombre ASC`,
        [mes]
      );
    } else if (filtro === 'sinPago') {
      [rows] = await req.db.query(
        `SELECT s.documento, s.nombre, s.telefono, s.email
         FROM students s
         WHERE s.activo = 1
           AND s.documento NOT IN (
             SELECT DISTINCT documento FROM payments
             WHERE documento IS NOT NULL
               AND COALESCE(serviceMonth, DATE_FORMAT(paymentDate,'%Y-%m')) = ?
           )
         ORDER BY s.nombre ASC`,
        [mes]
      );
    } else if (filtro === 'inactivos') {
      [rows] = await req.db.query(
        `SELECT s.documento, s.nombre, s.telefono, s.email
         FROM students s
         WHERE s.activo = 0
         ORDER BY s.nombre ASC`
      );
    } else {
      [rows] = await req.db.query(
        `SELECT documento, nombre, telefono, email FROM students WHERE activo = 1 ORDER BY nombre ASC`
      );
    }
    res.json(rows);
  } catch (err) {
    console.error('❌ Error alumnos-aviso:', err.message);
    res.status(500).json({ error: 'Error al obtener alumnos.' });
  }
});

// POST /stats/campana-email — envía campaña de reactivación a inactivos
router.post('/stats/campana-email', authenticateToken, async (req, res) => {
  const { mensaje, asunto } = req.body;
  if (!mensaje) return res.status(400).json({ error: 'Falta el mensaje.' });
  try {
    const { enviarCampana } = require('../emailService');
    const [alumnos] = await req.db.query(
      `SELECT nombre, email FROM students WHERE activo = 0 AND email IS NOT NULL AND email != '' ORDER BY nombre ASC`
    );
    // Responder inmediatamente para evitar timeout de Nginx
    res.json({ ok: true, enviados: alumnos.length, errores: 0, total: alumnos.length });
    // Enviar emails en background
    let errores = 0;
    for (const a of alumnos) {
      try {
        await enviarCampana(a.email, a.nombre, mensaje, asunto);
        await new Promise(r => setTimeout(r, 150));
      } catch(e) {
        console.warn(`⚠️ Email fallido ${a.email}:`, e.message);
        errores++;
      }
    }
    console.log(`✅ Campaña completada: ${alumnos.length - errores}/${alumnos.length} enviados`);
  } catch(err) {
    if (!res.headersSent) {
      console.error('❌ Error campaña email:', err.message);
      res.status(500).json({ error: 'Error al enviar campaña.' });
    }
  }
});

// ============================================================
// GET /stats/agenda-horario  — lee horario semanal
// POST /stats/agenda-horario — guarda horario semanal
// ============================================================
const HORAS_DEFAULT = ['09:00','10:00','11:00','12:00','13:00','17:00','18:00','19:00','20:00'];
const HORARIO_DEFAULT = { '1': HORAS_DEFAULT, '2': HORAS_DEFAULT, '3': HORAS_DEFAULT, '4': HORAS_DEFAULT, '5': HORAS_DEFAULT };

router.get('/stats/agenda-horario', authenticateToken, async (req, res) => {
  try {
    await ensureConfigTable(req.db);
    const [[row]] = await req.db.query(`SELECT valor FROM studio_config WHERE clave = 'agenda_horario_semana'`);
    const horario = row ? JSON.parse(row.valor) : HORARIO_DEFAULT;
    res.json(horario);
  } catch (err) {
    res.status(500).json({ error: 'Error al cargar horario.' });
  }
});

router.post('/stats/agenda-horario', authenticateToken, async (req, res) => {
  try {
    await ensureConfigTable(req.db);
    const horario = req.body;
    await req.db.query(
      `INSERT INTO studio_config (clave, valor) VALUES ('agenda_horario_semana', ?)
       ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
      [JSON.stringify(horario)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar horario.' });
  }
});

module.exports = router;
