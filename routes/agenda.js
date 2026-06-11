const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const authenticateToken = require('../authMiddleware');
const { enviarOTP, enviarConfirmacionReserva, enviarCancelacion } = require('../emailService');

const router = express.Router();
const SECRET_KEY = process.env.SECRET_KEY;
const CAPACIDAD = 5;
const HORAS_CANCELACION = 12;

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Esperá 15 minutos.' }
});

// Horarios disponibles (sin descanso 14-17)
const HORAS_VALIDAS = ['09:00','10:00','11:00','12:00','13:00','17:00','18:00','19:00','20:00'];

// ── Middleware para autenticar al alumno (JWT del portal) ──
function authAlumno(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'No autenticado.' });
  try {
    req.alumno = jwt.verify(token, SECRET_KEY);
    next();
  } catch {
    res.status(401).json({ error: 'Sesión expirada. Ingresá nuevamente.' });
  }
}

// ================================================================
// AUTH ALUMNO
// ================================================================

// POST /api/alumno/solicitar-otp — alumno ingresa su documento
router.post('/alumno/solicitar-otp', otpLimiter, async (req, res) => {
  const { documento, studio_slug } = req.body;
  if (!documento) return res.status(400).json({ error: 'Documento requerido.' });
  if (!studio_slug) return res.status(400).json({ error: 'Estudio no especificado.' });

  const { getCorePool, getStudioPool } = require('../db');
  try {
    const core = getCorePool();
    const [studios] = await core.query('SELECT db_name FROM studios WHERE slug = ? AND active = 1', [studio_slug]);
    if (!studios.length) return res.status(404).json({ error: 'Estudio no encontrado.' });

    const db = getStudioPool(studios[0].db_name);
    const [rows] = await db.query(
      'SELECT nombre, email, documento FROM students WHERE documento = ? AND activo = 1',
      [documento.trim()]
    );

    if (!rows.length) return res.status(404).json({ error: 'Documento no encontrado. Consultá con la recepción.' });

    const alumno = rows[0];
    if (!alumno.email) return res.status(400).json({ error: 'No tenés email registrado. Consultá con la recepción.' });

    // Generar OTP de 6 dígitos
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    // Guardar OTP (invalidar anteriores)
    await db.query('DELETE FROM student_tokens WHERE documento = ?', [alumno.documento]);
    await db.query(
      'INSERT INTO student_tokens (documento, otp, expires_at) VALUES (?, ?, ?)',
      [alumno.documento, otp, expires]
    );

    // Enviar email
    await enviarOTP(alumno.email, alumno.nombre.split(' ')[0], otp);

    // Enmascarar email para mostrar al alumno
    const partes = alumno.email.split('@');
    const emailMask = partes[0].substring(0, 3) + '***@' + partes[1];

    res.json({ ok: true, emailMask, nombre: alumno.nombre.split(' ')[0] });
  } catch (err) {
    console.error('❌ Error solicitar-otp:', err.message);
    res.status(500).json({ error: 'Error al enviar el código. Intentá de nuevo.' });
  }
});

// POST /api/alumno/verificar-otp
router.post('/alumno/verificar-otp', otpLimiter, async (req, res) => {
  const { documento, otp, studio_slug } = req.body;
  if (!documento || !otp) return res.status(400).json({ error: 'Datos incompletos.' });
  if (!studio_slug) return res.status(400).json({ error: 'Estudio no especificado.' });

  const { getCorePool, getStudioPool } = require('../db');
  try {
    const core = getCorePool();
    const [studios] = await core.query('SELECT db_name FROM studios WHERE slug = ? AND active = 1', [studio_slug]);
    if (!studios.length) return res.status(404).json({ error: 'Estudio no encontrado.' });
    const db = getStudioPool(studios[0].db_name);

    const [tokens] = await db.query(
      'SELECT * FROM student_tokens WHERE documento = ? AND otp = ? AND used = 0 AND expires_at > NOW()',
      [documento.trim(), otp.trim()]
    );

    if (!tokens.length) return res.status(401).json({ error: 'Código incorrecto o expirado.' });

    // Marcar como usado
    await db.query('UPDATE student_tokens SET used = 1 WHERE id = ?', [tokens[0].id]);

    // Buscar datos del alumno
    const [rows] = await db.query('SELECT * FROM students WHERE documento = ?', [documento]);
    const alumno = rows[0];

    // Generar JWT para el alumno (7 días)
    const token = jwt.sign(
      { documento: alumno.documento, nombre: alumno.nombre, email: alumno.email, studio_db: studios[0].db_name, rol: 'alumno' },
      SECRET_KEY,
      { expiresIn: '7d' }
    );

    res.json({ token, nombre: alumno.nombre.split(' ')[0] });
  } catch (err) {
    console.error('❌ Error verificar-otp:', err.message);
    res.status(500).json({ error: 'Error al verificar. Intentá de nuevo.' });
  }
});

// ================================================================
// AGENDA — rutas para el alumno autenticado
// ================================================================

// GET /api/alumno/mis-reservas — reservas futuras del alumno
router.get('/alumno/mis-reservas', authAlumno, async (req, res) => {
  const { getStudioPool } = require('../db');
  const db = getStudioPool(req.alumno.studio_db);
  try {
    const [rows] = await db.query(
      `SELECT * FROM agenda_reservas
       WHERE documento = ? AND estado = 'confirmado' AND fecha >= CURDATE()
       ORDER BY fecha ASC, hora ASC`,
      [req.alumno.documento]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener reservas.' });
  }
});

// GET /api/agenda/disponibilidad/:fecha — slots del día con disponibilidad
router.get('/agenda/disponibilidad/:fecha', authAlumno, async (req, res) => {
  const { fecha } = req.params;
  const { getStudioPool } = require('../db');
  const db = getStudioPool(req.alumno.studio_db);

  // Validar que sea Lun-Vie
  const d = new Date(fecha + 'T12:00:00');
  const diaSemana = d.getDay(); // 0=Dom, 6=Sáb
  if (diaSemana === 0 || diaSemana === 6) {
    return res.json([]);
  }

  try {
    const [ocupados] = await db.query(
      `SELECT hora, COUNT(*) AS ocupados FROM agenda_reservas
       WHERE fecha = ? AND estado = 'confirmado' GROUP BY hora`,
      [fecha]
    );
    const mapOcupados = {};
    ocupados.forEach(o => mapOcupados[o.hora] = o.ocupados);

    // Reserva del alumno en ese día
    const [miReserva] = await db.query(
      `SELECT id, hora FROM agenda_reservas WHERE fecha = ? AND documento = ? AND estado = 'confirmado'`,
      [fecha, req.alumno.documento]
    );
    const miHora = miReserva[0]?.hora || null;
    const miId   = miReserva[0]?.id   || null;

    // Hora actual en Argentina para marcar slots pasados de hoy
    const hoyAR   = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const ahoraAR = new Date().toLocaleTimeString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false }).substring(0, 5);

    const slots = HORAS_VALIDAS.map(hora => ({
      hora,
      ocupados:    mapOcupados[hora] || 0,
      disponibles: CAPACIDAD - (mapOcupados[hora] || 0),
      capacidad:   CAPACIDAD,
      miReserva:   hora === miHora,
      reservaId:   hora === miHora ? miId : null,
      pasado:      fecha === hoyAR && hora < ahoraAR,
    }));

    res.json(slots);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener disponibilidad.' });
  }
});

// POST /api/agenda/reservar — el alumno reserva un turno
router.post('/agenda/reservar', authAlumno, async (req, res) => {
  const { fecha, hora } = req.body;
  if (!fecha || !hora) return res.status(400).json({ error: 'Fecha y hora requeridas.' });
  if (!HORAS_VALIDAS.includes(hora)) return res.status(400).json({ error: 'Horario no válido.' });

  const d = new Date(fecha + 'T12:00:00-03:00');
  if (d.getDay() === 0 || d.getDay() === 6) return res.status(400).json({ error: 'No hay clases ese día.' });
  const hoyAR   = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const ahoraAR = new Date().toLocaleTimeString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false }).substring(0, 5);
  if (fecha < hoyAR) return res.status(400).json({ error: 'No podés reservar fechas pasadas.' });
  if (fecha === hoyAR && hora < ahoraAR) return res.status(400).json({ error: 'Ese turno ya pasó.' });

  const { getStudioPool } = require('../db');
  const db = getStudioPool(req.alumno.studio_db);

  try {
    // Verificar abono activo para el mes de la clase
    const mesFecha = fecha.substring(0, 7);
    const estadoAbono = await calcularEstadoAbono(db, req.alumno.documento, mesFecha);

    if (!estadoAbono.abono_activo) {
      return res.status(403).json({
        error: 'No tenés abono activo para este mes.',
        codigo: 'SIN_ABONO',
        mensaje: 'Contactá con la recepción para renovar tu abono antes de reservar.'
      });
    }

    // Contar reservas futuras confirmadas del mismo mes para evitar que excedan el plan
    const [[{ futuras }]] = await db.query(
      `SELECT COUNT(*) AS futuras FROM agenda_reservas
       WHERE documento = ? AND DATE_FORMAT(fecha,'%Y-%m') = ? AND estado = 'confirmado' AND fecha >= CURDATE()`,
      [req.alumno.documento, mesFecha]
    );

    if (estadoAbono.abono_agotado || (estadoAbono.consumidas + futuras) >= estadoAbono.clases_plan) {
      return res.status(403).json({
        error: 'Ya tenés todas tus clases del mes reservadas o usadas.',
        codigo: 'ABONO_AGOTADO',
        mensaje: `Usaste o reservaste ${estadoAbono.consumidas + futuras} de ${estadoAbono.clases_plan} clases. Contactá con la recepción para ampliar o renovar tu abono.`
      });
    }

    // Verificar cupo y reservar en una transacción para evitar race conditions
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [yaReservado] = await conn.query(
        `SELECT id FROM agenda_reservas WHERE fecha = ? AND documento = ? AND estado = 'confirmado' FOR UPDATE`,
        [fecha, req.alumno.documento]
      );
      if (yaReservado.length) {
        await conn.rollback();
        return res.status(409).json({ error: 'Ya tenés una clase reservada ese día.' });
      }

      const [[{ ocupados }]] = await conn.query(
        `SELECT COUNT(*) AS ocupados FROM agenda_reservas WHERE fecha = ? AND hora = ? AND estado = 'confirmado' FOR UPDATE`,
        [fecha, hora]
      );
      if (ocupados >= CAPACIDAD) {
        await conn.rollback();
        return res.status(409).json({ error: 'El turno está completo.' });
      }

      await conn.query(
        'INSERT INTO agenda_reservas (fecha, hora, documento, estado) VALUES (?, ?, ?, ?)',
        [fecha, hora, req.alumno.documento, 'confirmado']
      );
      await conn.commit();
    } finally {
      conn.release();
    }

    // Email confirmación (sin await para no bloquear)
    if (req.alumno.email) {
      enviarConfirmacionReserva(req.alumno.email, req.alumno.nombre.split(' ')[0], fecha, hora)
        .catch(e => console.error('Email error:', e.message));
    }

    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya tenés una clase reservada en ese horario.' });
    console.error('❌ Error reservar:', err.message);
    res.status(500).json({ error: 'Error al reservar.' });
  }
});

// DELETE /api/agenda/cancelar/:id — el alumno cancela una reserva
router.delete('/agenda/cancelar/:id', authAlumno, async (req, res) => {
  const { getStudioPool } = require('../db');
  const db = getStudioPool(req.alumno.studio_db);

  try {
    const [rows] = await db.query(
      `SELECT * FROM agenda_reservas WHERE id = ? AND documento = ? AND estado = 'confirmado'`,
      [req.params.id, req.alumno.documento]
    );
    if (!rows.length) return res.status(404).json({ error: 'Reserva no encontrada.' });

    const reserva = rows[0];
    const fechaStr = reserva.fecha instanceof Date
      ? reserva.fecha.toISOString().split('T')[0]
      : String(reserva.fecha).split('T')[0];

    // Verificar 12 horas de anticipación — hora interpretada en Argentina (UTC-3, sin DST)
    const claseDateTime = new Date(`${fechaStr}T${reserva.hora}:00-03:00`);
    const limite = new Date(claseDateTime.getTime() - HORAS_CANCELACION * 60 * 60 * 1000);
    const conAviso = new Date() <= limite;

    if (!conAviso) {
      // Sin aviso — clase perdida
      await db.query(
        `UPDATE agenda_reservas SET estado='cancelado', cancelado_en=NOW(), clase_devuelta=0, motivo_consumo='sin_aviso' WHERE id=?`,
        [reserva.id]
      );
      if (req.alumno.email) {
        enviarCancelacion(req.alumno.email, req.alumno.nombre.split(' ')[0], fechaStr, reserva.hora, false)
          .catch(e => console.error('Email error:', e.message));
      }
      return res.json({ ok: true, clase_devuelta: false, mensaje: 'Cancelación tardía — la clase se descuenta del abono.' });
    }

    // Con aviso — verificar límite de 2 por mes
    const mes = fechaStr.substring(0, 7);
    const [[{ cancelacionesValidas }]] = await db.query(
      `SELECT COUNT(*) AS cancelacionesValidas FROM agenda_reservas
       WHERE documento = ? AND clase_devuelta = 1
         AND DATE_FORMAT(fecha,'%Y-%m') = ?`,
      [req.alumno.documento, mes]
    );

    const devuelta = cancelacionesValidas < 2;
    const motivo = devuelta ? null : 'limite_cancelaciones';

    await db.query(
      `UPDATE agenda_reservas SET estado='cancelado', cancelado_en=NOW(), clase_devuelta=?, motivo_consumo=? WHERE id=?`,
      [devuelta ? 1 : 0, motivo, reserva.id]
    );

    if (req.alumno.email) {
      enviarCancelacion(req.alumno.email, req.alumno.nombre.split(' ')[0], fechaStr, reserva.hora, devuelta)
        .catch(e => console.error('Email error:', e.message));
    }

    res.json({
      ok: true,
      clase_devuelta: devuelta,
      cancelaciones_validas_mes: cancelacionesValidas + (devuelta ? 1 : 0),
      mensaje: devuelta
        ? `Clase devuelta al abono. Usaste ${cancelacionesValidas + 1}/2 cancelaciones este mes.`
        : 'Límite de 2 cancelaciones alcanzado — la clase se descuenta del abono.'
    });
  } catch (err) {
    console.error('❌ Error cancelar:', err.message);
    res.status(500).json({ error: 'Error al cancelar.' });
  }
});

// ================================================================
// AGENDA — rutas para el ADMIN
// ================================================================

// GET /api/admin/agenda/sin-abono/:mes — alumnos con reservas pero sin pago ese mes
router.get('/admin/agenda/sin-abono/:mes', authenticateToken, async (req, res) => {
  const { mes } = req.params;
  try {
    const [rows] = await req.db.query(
      `SELECT DISTINCT ar.documento, s.nombre, s.telefono, s.email,
              COUNT(ar.id) AS reservas
       FROM agenda_reservas ar
       LEFT JOIN students s ON s.documento = ar.documento COLLATE utf8mb4_unicode_ci
       WHERE ar.estado = 'confirmado'
         AND DATE_FORMAT(ar.fecha,'%Y-%m') = ?
         AND ar.documento NOT IN (
           SELECT DISTINCT documento FROM payments
           WHERE documento IS NOT NULL
             AND COALESCE(serviceMonth, DATE_FORMAT(paymentDate,'%Y-%m')) = ?
         )
       GROUP BY ar.documento, s.nombre, s.telefono, s.email
       ORDER BY s.nombre ASC`,
      [mes, mes]
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Error sin-abono:', err.message);
    res.status(500).json({ error: 'Error al obtener alumnos sin abono.' });
  }
});

// GET /api/admin/agenda/:fecha — vista del día con todos los alumnos
router.get('/admin/agenda/:fecha', authenticateToken, async (req, res) => {
  const { fecha } = req.params;
  try {
    const [reservas] = await req.db.query(
      `SELECT ar.id, ar.hora, ar.documento, ar.estado, ar.created_at,
              s.nombre, s.telefono, s.email
       FROM agenda_reservas ar
       LEFT JOIN students s ON s.documento = ar.documento COLLATE utf8mb4_unicode_ci
       WHERE ar.fecha = ? AND ar.estado = 'confirmado'
       ORDER BY ar.hora ASC, s.nombre ASC`,
      [fecha]
    );

    // Agrupar por hora
    const slots = {};
    HORAS_VALIDAS.forEach(h => slots[h] = { hora: h, alumnos: [], ocupados: 0, disponibles: CAPACIDAD, capacidad: CAPACIDAD });
    reservas.forEach(r => {
      if (slots[r.hora]) {
        slots[r.hora].alumnos.push(r);
        slots[r.hora].ocupados++;
        slots[r.hora].disponibles--;
      }
    });

    res.json({ fecha, slots: Object.values(slots) });
  } catch (err) {
    console.error('❌ Error admin agenda:', err.message);
    res.status(500).json({ error: 'Error al obtener la agenda.' });
  }
});

// POST /api/admin/agenda/agregar — admin agrega un alumno a un turno
router.post('/admin/agenda/agregar', authenticateToken, async (req, res) => {
  const { fecha, hora, documento } = req.body;
  if (!fecha || !hora || !documento) return res.status(400).json({ error: 'Datos incompletos.' });

  const conn = await req.db.getConnection();
  try {
    await conn.beginTransaction();

    const [[{ ocupados }]] = await conn.query(
      `SELECT COUNT(*) AS ocupados FROM agenda_reservas WHERE fecha = ? AND hora = ? AND estado = 'confirmado' FOR UPDATE`,
      [fecha, hora]
    );
    if (ocupados >= CAPACIDAD) {
      await conn.rollback();
      return res.status(409).json({ error: 'El turno está completo.' });
    }

    await conn.query(
      'INSERT INTO agenda_reservas (fecha, hora, documento, estado) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE estado = "confirmado", cancelado_en = NULL',
      [fecha, hora, documento, 'confirmado']
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error agregar turno:', err.message);
    res.status(500).json({ error: 'Error al agregar alumno al turno.' });
  } finally {
    conn.release();
  }
});

// DELETE /api/admin/agenda/:id — admin quita un alumno de un turno
router.delete('/admin/agenda/:id', authenticateToken, async (req, res) => {
  try {
    await req.db.query(
      `UPDATE agenda_reservas SET estado = 'cancelado', cancelado_en = NOW() WHERE id = ?`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar del turno.' });
  }
});

// GET /api/admin/agenda/mes/:mes — resumen de reservas por día para un mes completo
router.get('/admin/agenda/mes/:mes', authenticateToken, async (req, res) => {
  const { mes } = req.params;
  try {
    const [rows] = await req.db.query(
      `SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, hora, COUNT(*) AS total
       FROM agenda_reservas
       WHERE DATE_FORMAT(fecha, '%Y-%m') = ? AND estado = 'confirmado'
       GROUP BY fecha, hora
       ORDER BY fecha ASC, hora ASC`,
      [mes]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener mes.' });
  }
});

// GET /api/admin/agenda/semana/:lunes — agenda de la semana completa
router.get('/admin/agenda/semana/:lunes', authenticateToken, async (req, res) => {
  const { lunes } = req.params;
  try {
    const [reservas] = await req.db.query(
      `SELECT ar.id, ar.fecha, ar.hora, ar.documento, s.nombre
       FROM agenda_reservas ar
       LEFT JOIN students s ON s.documento = ar.documento COLLATE utf8mb4_unicode_ci
       WHERE ar.fecha BETWEEN ? AND DATE_ADD(?, INTERVAL 4 DAY) AND ar.estado = 'confirmado'
       ORDER BY ar.fecha ASC, ar.hora ASC`,
      [lunes, lunes]
    );
    res.json(reservas);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener semana.' });
  }
});

// ================================================================
// ESTADO DE ABONO — cruce de pagos, agenda y asistencias
// ================================================================

// Función central: calcula el estado del abono de un alumno en un mes
async function calcularEstadoAbono(db, documento, mes) {
  // 1. Plan pagado para este serviceMonth (mes de servicio)
  // Busca primero por serviceMonth, luego por paymentDate como fallback
  const [pagos] = await db.query(
    `SELECT p.subscriptionType, pc.nombre AS plan_nombre, pc.clases AS clases_plan,
            p.amount, p.paymentDate,
            COALESCE(p.serviceMonth, DATE_FORMAT(p.paymentDate,'%Y-%m')) AS mes_servicio
     FROM payments p
     LEFT JOIN planes_config pc ON pc.codigo = p.subscriptionType
     WHERE p.documento = ?
       AND COALESCE(p.serviceMonth, DATE_FORMAT(p.paymentDate,'%Y-%m')) = ?
     ORDER BY p.paymentDate DESC LIMIT 1`,
    [documento, mes]
  );
  let pago = pagos[0] || null;

  // Si no hay pago este mes, intentar con plan_actual del perfil del alumno
  if (!pago) {
    const [[st]] = await db.query(`SELECT plan_actual FROM students WHERE documento=?`, [documento]);
    if (st?.plan_actual) {
      const [[pc]] = await db.query(`SELECT codigo, nombre, clases FROM planes_config WHERE codigo=?`, [st.plan_actual]);
      if (pc) {
        // Tratamos plan_actual como abono activo sin pago registrado todavía
        pago = { subscriptionType: pc.codigo, plan_nombre: pc.nombre, clases_plan: pc.clases, amount: null, _sinPago: true };
      }
    }
  }

  const clasesPlan = pago ? (parseInt(pago.clases_plan) || 0) : 0;

  // Período del abono: todo el mes calendario del serviceMonth
  const inicioMes = `${mes}-01`;
  const finMes    = new Date(parseInt(mes.split('-')[0]), parseInt(mes.split('-')[1]), 0)
                      .toISOString().split('T')[0];

  // 2. Clases asistidas en el período (solo hasta hoy — no contar clases futuras)
  const hoy = new Date().toISOString().split('T')[0];
  const [[{ asistidas }]] = await db.query(
    `SELECT COUNT(*) AS asistidas FROM attendance
     WHERE documento = ? AND fecha BETWEEN ? AND ? AND fecha <= ?`,
    [documento, inicioMes, finMes, hoy]
  );

  // 3. Reservas del período
  const [reservas] = await db.query(
    `SELECT id, fecha, hora, estado, clase_devuelta, motivo_consumo
     FROM agenda_reservas
     WHERE documento = ? AND fecha BETWEEN ? AND ?`,
    [documento, inicioMes, finMes]
  );

  const confirmadas    = reservas.filter(r => r.estado === 'confirmado').length;
  const cancelDevuelta = reservas.filter(r => r.estado === 'cancelado' && r.clase_devuelta === 1).length;
  const cancelPerdida  = reservas.filter(r => r.estado === 'cancelado' && r.clase_devuelta === 0).length;

  // 4. Ausencias: reservas confirmadas sin asistencia (solo fechas pasadas)
  const ausencias_query = await db.query(
    `SELECT ar.id FROM agenda_reservas ar
     WHERE ar.documento = ? AND ar.fecha BETWEEN ? AND ?
       AND ar.estado = 'confirmado' AND ar.fecha < ?
       AND NOT EXISTS (
         SELECT 1 FROM attendance a
         WHERE a.documento = ar.documento AND a.fecha = ar.fecha
       )`,
    [documento, inicioMes, finMes, hoy]
  );
  const ausencias = ausencias_query[0].length;

  // 5. Devoluciones manuales del admin
  const [[{ extra }]] = await db.query(
    `SELECT COALESCE(SUM(cantidad),0) AS extra FROM clases_extra
     WHERE documento = ? AND mes = ?`,
    [documento, mes]
  );

  // 6. Consumidas = asistidas + ausencias + cancelaciones perdidas
  const consumidas = asistidas + ausencias + cancelPerdida;

  // 7. Restantes = plan - consumidas + devoluciones admin
  const restantes = Math.max(0, clasesPlan - consumidas + parseInt(extra));

  // 8. Estado del abono
  const abonoActivo = pago !== null;
  const abonoAgotado = abonoActivo && clasesPlan > 0 && restantes === 0;

  return {
    mes,
    abono_activo: abonoActivo,
    abono_agotado: abonoAgotado,
    sin_pago_registrado: !!(pago?._sinPago),  // activo por plan_actual pero sin pago este mes
    plan: pago ? { codigo: pago.subscriptionType, nombre: pago.plan_nombre, clases: clasesPlan, monto: pago.amount } : null,
    clases_plan: clasesPlan,
    asistidas,
    ausencias,
    cancelaciones: {
      devueltas:   cancelDevuelta,
      perdidas:    cancelPerdida,
      disponibles: Math.max(0, 2 - cancelDevuelta)
    },
    extra_admin:  parseInt(extra),
    consumidas,
    restantes,
    reservas_activas: confirmadas
  };
}

// GET /api/alumno/estado-abono/:mes — estado del abono del alumno logueado
router.get('/alumno/estado-abono/:mes', authAlumno, async (req, res) => {
  const { getStudioPool } = require('../db');
  const db = getStudioPool(req.alumno.studio_db);
  try {
    const estado = await calcularEstadoAbono(db, req.alumno.documento, req.params.mes);
    res.json(estado);
  } catch (err) {
    console.error('❌ Error estado abono alumno:', err.message);
    res.status(500).json({ error: 'Error al obtener estado del abono.' });
  }
});

// GET /api/admin/abono/:documento/:mes
router.get('/admin/abono/:documento/:mes', authenticateToken, async (req, res) => {
  try {
    const estado = await calcularEstadoAbono(req.db, req.params.documento, req.params.mes);
    res.json(estado);
  } catch (err) {
    console.error('❌ Error estado abono:', err.message);
    res.status(500).json({ error: 'Error al calcular estado del abono.' });
  }
});

// GET /api/admin/abonos/mes/:mes — todos los alumnos con abono activo ese mes
router.get('/admin/abonos/mes/:mes', authenticateToken, async (req, res) => {
  const { mes } = req.params;
  try {
    // Alumnos que tienen pago o reserva este mes
    const [alumnos] = await req.db.query(
      `SELECT DISTINCT s.documento, s.nombre, s.telefono, s.email
       FROM students s
       WHERE s.activo = 1 AND (
         EXISTS (SELECT 1 FROM payments p WHERE p.documento = s.documento AND COALESCE(p.serviceMonth, DATE_FORMAT(p.paymentDate,'%Y-%m')) = ?)
         OR EXISTS (SELECT 1 FROM agenda_reservas ar WHERE ar.documento = s.documento AND DATE_FORMAT(ar.fecha,'%Y-%m') = ?)
       )
       ORDER BY s.nombre ASC`,
      [mes, mes]
    );

    const resultados = await Promise.all(
      alumnos.map(async a => {
        const estado = await calcularEstadoAbono(req.db, a.documento, mes);
        return { ...a, ...estado };
      })
    );

    res.json(resultados);
  } catch (err) {
    console.error('❌ Error abonos mes:', err.message);
    res.status(500).json({ error: 'Error al obtener abonos del mes.' });
  }
});

// POST /api/admin/abono/devolver — admin devuelve clases manualmente
router.post('/admin/abono/devolver', authenticateToken, async (req, res) => {
  const { documento, mes, cantidad, motivo } = req.body;
  if (!documento || !mes || !cantidad) return res.status(400).json({ error: 'Datos incompletos.' });
  try {
    await req.db.query(
      `INSERT INTO clases_extra (documento, mes, cantidad, motivo, creado_por) VALUES (?, ?, ?, ?, ?)`,
      [documento, mes, parseInt(cantidad), motivo || 'Devolución manual', req.user?.email || 'admin']
    );
    const estado = await calcularEstadoAbono(req.db, documento, mes);
    res.json({ ok: true, estado });
  } catch (err) {
    console.error('❌ Error devolver clases:', err.message);
    res.status(500).json({ error: 'Error al devolver clases.' });
  }
});

// ================================================================
// PAGOS PENDIENTES — lado alumno
// ================================================================

// GET /api/alumno/config-pago — devuelve CBU/alias al alumno logueado
router.get('/alumno/config-pago', authAlumno, async (req, res) => {
  const { getStudioPool } = require('../db');
  const db = getStudioPool(req.alumno.studio_db);
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS studio_config (
      clave VARCHAR(80) PRIMARY KEY, valor TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
    const [rows] = await db.query(`SELECT clave, valor FROM studio_config WHERE clave LIKE 'pago_%'`);
    const cfg = {};
    rows.forEach(r => { cfg[r.clave.replace('pago_', '')] = r.valor; });
    res.json(cfg);
  } catch (err) { res.status(500).json({ error: 'Error al obtener config.' }); }
});

// POST /api/alumno/pago-pendiente — alumno declara que transfirió
router.post('/alumno/pago-pendiente', authAlumno, async (req, res) => {
  const { plan, monto } = req.body;
  if (!plan || !monto) return res.status(400).json({ error: 'Datos incompletos.' });
  const { getStudioPool } = require('../db');
  const db = getStudioPool(req.alumno.studio_db);
  try {
    // Verificar que no haya uno pendiente ya
    const [dup] = await db.query(
      `SELECT id FROM pagos_pendientes WHERE documento=? AND estado='pendiente'`,
      [req.alumno.documento]
    );
    if (dup.length) return res.status(409).json({ error: 'Ya tenés un pago pendiente de confirmación.' });

    const [alumno] = await db.query('SELECT nombre FROM students WHERE documento=?', [req.alumno.documento]);
    await db.query(
      `INSERT INTO pagos_pendientes (documento, nombre, plan, monto) VALUES (?,?,?,?)`,
      [req.alumno.documento, alumno[0]?.nombre || req.alumno.documento, plan, monto]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Error pago pendiente:', err.message);
    res.status(500).json({ error: 'Error al registrar.' });
  }
});

// ================================================================
// NOTIFICACIONES INTERNAS
// ================================================================

// GET /api/alumno/notificaciones — alumna ve sus notificaciones no leídas
router.get('/alumno/notificaciones', authAlumno, async (req, res) => {
  const { getStudioPool } = require('../db');
  const db = getStudioPool(req.alumno.studio_db);
  const doc = req.alumno.documento;
  try {
    const [rows] = await db.query(
      `SELECT n.id, n.titulo, n.mensaje, n.tipo, n.created_at
       FROM notificaciones n
       WHERE (n.para = 'todos'
           OR (n.para = 'individual' AND n.documento_destino = ?)
           OR (n.para = 'conAbono' AND EXISTS (
                SELECT 1 FROM payments p
                WHERE p.documento = ?
                  AND COALESCE(p.serviceMonth, DATE_FORMAT(p.paymentDate,'%Y-%m'))
                    = DATE_FORMAT(NOW(),'%Y-%m')
              ))
         )
         AND (
           n.tipo = 'fija'
           OR n.id NOT IN (
             SELECT notificacion_id FROM notificaciones_leidas WHERE documento = ?
           )
         )
       ORDER BY n.tipo = 'fija' DESC, n.created_at DESC`,
      [doc, doc, doc]
    );
    res.json(rows);
  } catch(err) {
    console.error('❌ notificaciones alumno:', err.message);
    res.status(500).json({ error: 'Error.' });
  }
});

// POST /api/alumno/notificaciones/:id/leer
router.post('/alumno/notificaciones/:id/leer', authAlumno, async (req, res) => {
  const { getStudioPool } = require('../db');
  const db = getStudioPool(req.alumno.studio_db);
  try {
    await db.query(
      `INSERT IGNORE INTO notificaciones_leidas (notificacion_id, documento) VALUES (?,?)`,
      [req.params.id, req.alumno.documento]
    );
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: 'Error.' }); }
});

// POST /api/admin/notificacion — admin crea notificación
router.post('/admin/notificacion', authenticateToken, async (req, res) => {
  const { titulo, mensaje, tipo, para, documento_destino } = req.body;
  if (!titulo || !mensaje) return res.status(400).json({ error: 'Título y mensaje son obligatorios.' });
  try {
    const [r] = await req.db.query(
      `INSERT INTO notificaciones (titulo, mensaje, tipo, para, documento_destino) VALUES (?,?,?,?,?)`,
      [titulo, mensaje, tipo || 'info', para || 'todos', documento_destino || null]
    );
    res.json({ ok: true, id: r.insertId });
  } catch(err) {
    console.error('❌ crear notificación:', err.message);
    res.status(500).json({ error: 'Error al crear notificación.' });
  }
});

// GET /api/admin/notificaciones — lista de notificaciones enviadas
router.get('/admin/notificaciones', authenticateToken, async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT n.*, COUNT(nl.id) AS leidas
       FROM notificaciones n
       LEFT JOIN notificaciones_leidas nl ON nl.notificacion_id = n.id
       GROUP BY n.id ORDER BY n.created_at DESC LIMIT 50`
    );
    res.json(rows);
  } catch(err) { res.status(500).json({ error: 'Error.' }); }
});

// DELETE /api/admin/notificacion/:id — eliminar notificación
router.delete('/admin/notificacion/:id', authenticateToken, async (req, res) => {
  try {
    await req.db.query(`DELETE FROM notificaciones_leidas WHERE notificacion_id=?`, [req.params.id]);
    await req.db.query(`DELETE FROM notificaciones WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: 'Error.' }); }
});

module.exports = router;
