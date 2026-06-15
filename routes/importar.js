const express = require('express');
const multer  = require('multer');
const authenticateToken = require('../authMiddleware');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Parsea CSV de Neocita
// Formato: Fecha, Hora, Estado, cliente, Motivo, Documento, Tel., Whatsapp, email, obrasocial
function parsearCSVNeocita(buffer) {
  const lines = buffer.toString('utf8').split('\n').map(l => l.trim()).filter(Boolean);
  const registros = [];

  for (const line of lines) {
    // Ignorar encabezados y secciones
    if (line.startsWith('Fecha') || line.startsWith('Turnos cancelados')) continue;
    const cols = line.split(',').map(c => c.trim());
    if (cols.length < 6) continue;

    const fecha     = cols[0]; // DD-MM-YYYY
    const hora      = cols[1]; // HH:MM
    const estado    = cols[2];
    const cliente   = cols[3];
    const motivo    = cols[4];
    const documento = cols[5]?.replace(/\s/g, '');
    const tel       = cols[6] || '';
    const whatsapp  = cols[7] || '';
    const email     = cols[8] || '';

    if (!fecha || !documento) continue;

    // Convertir fecha DD-MM-YYYY → YYYY-MM-DD
    const partes = fecha.split('-');
    if (partes.length !== 3) continue;
    const fechaISO = `${partes[2]}-${partes[1].padStart(2,'0')}-${partes[0].padStart(2,'0')}`;

    registros.push({ fechaISO, hora, estado, cliente, motivo, documento, tel, whatsapp, email });
  }
  return registros;
}

// ── POST /importar/preview — previsualizar importación de asistencias ──
router.post('/importar/preview', authenticateToken, upload.single('csv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo.' });
  try {
    const registros = parsearCSVNeocita(req.file.buffer);
    const confirmados = registros.filter(r => r.estado === 'Confirmado' && r.documento);
    const noAsistieron = registros.filter(r => r.estado !== 'Confirmado' && r.documento);

    // Verificar qué documentos existen en el sistema
    const docs = [...new Set(confirmados.map(r => r.documento))];
    let reconocidosSet = new Set();
    if (docs.length) {
      const placeholders = docs.map(() => '?').join(',');
      const [rows] = await req.db.query(`SELECT documento FROM students WHERE documento IN (${placeholders})`, docs);
      reconocidosSet = new Set(rows.map(r => r.documento));
    }

    // Alumnos no reconocidos (únicos)
    const noReconMap = {};
    confirmados.forEach(r => {
      if (!reconocidosSet.has(r.documento) && !noReconMap[r.documento]) {
        noReconMap[r.documento] = { documento: r.documento, cliente: r.cliente };
      }
    });
    const no_reconocidos_lista = Object.values(noReconMap);

    // Rango de fechas
    const fechas = confirmados.map(r => r.fechaISO).sort();
    const fechas_rango = fechas.length ? { desde: fechas[0], hasta: fechas[fechas.length - 1] } : { desde: '-', hasta: '-' };

    // Muestra de asistencias reconocidas
    const muestra = confirmados
      .filter(r => reconocidosSet.has(r.documento))
      .slice(0, 10)
      .map(r => ({ fecha: r.fechaISO, hora: r.hora, nombre: r.cliente, documento: r.documento }));

    res.json({
      asistieron: confirmados.length,
      no_asistieron: noAsistieron.length,
      reconocidos: docs.filter(d => reconocidosSet.has(d)).length,
      no_reconocidos: no_reconocidos_lista.length,
      fechas_rango,
      muestra,
      no_reconocidos_lista
    });
  } catch (err) {
    console.error('❌ Error preview:', err.message, err.stack);
    res.status(500).json({ error: 'Error al procesar el archivo: ' + err.message });
  }
});

// ── POST /importar/confirmar — importar asistencias desde CSV de Neocita ──
router.post('/importar/confirmar', authenticateToken, upload.single('csv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo.' });
  try {
    const registros = parsearCSVNeocita(req.file.buffer);
    const confirmados = registros.filter(r => r.estado === 'Confirmado' && r.documento);

    let importados = 0;
    let duplicados = 0;
    let sinAlumno  = 0;

    for (const r of confirmados) {
      // Verificar que el alumno existe
      const [existe] = await req.db.query(
        'SELECT id FROM students WHERE documento = ?', [r.documento]
      );
      if (!existe.length) { sinAlumno++; continue; }

      // Insertar asistencia evitando duplicados
      try {
        await req.db.query(
          `INSERT IGNORE INTO attendance (documento, fecha, horario) VALUES (?, ?, ?)`,
          [r.documento, r.fechaISO, r.hora]
        );
        importados++;
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') duplicados++;
        else throw e;
      }
    }

    res.json({
      ok: true,
      mensaje: `✅ ${importados} asistencias importadas. ${duplicados} ya existían. ${sinAlumno} alumnos no encontrados en el sistema.`
    });
  } catch (err) {
    console.error('❌ Error importar asistencias:', err.message);
    res.status(500).json({ error: 'Error al importar asistencias.' });
  }
});

// ── POST /importar/clientes — crear/actualizar alumnos desde CSV de Neocita (agenda o clientes) ──
router.post('/importar/clientes', authenticateToken, upload.single('csv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo.' });
  try {
    const texto = req.file.buffer.toString('utf8');
    const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean);

    // Detectar formato: agenda (tiene "Estado" en header) vs clientes de Neocita
    const header = lineas[0] || '';
    const esFormatoAgenda = header.toLowerCase().includes('estado') || header.toLowerCase().includes('hora');

    const porDoc = {};

    if (esFormatoAgenda) {
      // Extraer alumnos únicos del CSV de agenda
      const registros = parsearCSVNeocita(req.file.buffer);
      for (const r of registros) {
        if (!r.documento) continue;
        if (!porDoc[r.documento]) {
          porDoc[r.documento] = { documento: r.documento, nombre: r.cliente, email: r.email, tel: r.tel };
        } else {
          if (r.email && !porDoc[r.documento].email) porDoc[r.documento].email = r.email;
          if (r.tel   && !porDoc[r.documento].tel)   porDoc[r.documento].tel   = r.tel;
        }
      }
    } else {
      // Formato clientes de Neocita: intentar columnas flexibles
      // Buscar índices por nombre de columna en el header
      const cols = header.split(',').map(c => c.trim().toLowerCase());
      const iNombre = cols.findIndex(c => c.includes('nombre') || c.includes('cliente'));
      const iDoc    = cols.findIndex(c => c.includes('documento') || c.includes('dni') || c.includes('doc'));
      const iEmail  = cols.findIndex(c => c.includes('email') || c.includes('mail'));
      const iTel    = cols.findIndex(c => c.includes('tel') || c.includes('whatsapp') || c.includes('celular'));

      for (let i = 1; i < lineas.length; i++) {
        const row = lineas[i].split(',').map(c => c.trim());
        const doc = iDoc >= 0 ? row[iDoc]?.replace(/\s/g,'') : null;
        if (!doc) continue;
        porDoc[doc] = {
          documento: doc,
          nombre:    iNombre >= 0 ? (row[iNombre] || '') : '',
          email:     iEmail  >= 0 ? (row[iEmail]  || '') : '',
          tel:       iTel    >= 0 ? (row[iTel]    || '') : ''
        };
      }
    }

    let actualizados = 0;
    let creados      = 0;
    let sinCambios   = 0;

    for (const r of Object.values(porDoc)) {
      if (!r.documento) continue;
      const nombre = (r.nombre || '').replace(/\s+/g, ' ').trim();
      if (!nombre) continue;

      const [existe] = await req.db.query(
        'SELECT id, email, telefono FROM students WHERE documento = ?', [r.documento]
      );

      if (existe.length) {
        const updates = [];
        const params  = [];
        if (r.email && !existe[0].email)    { updates.push('email=?');    params.push(r.email); }
        if (r.tel   && !existe[0].telefono) { updates.push('telefono=?'); params.push(r.tel);   }
        if (updates.length) {
          params.push(r.documento);
          await req.db.query(`UPDATE students SET ${updates.join(',')} WHERE documento=?`, params);
          actualizados++;
        } else {
          sinCambios++;
        }
      } else {
        await req.db.query(
          `INSERT IGNORE INTO students (nombre, documento, email, telefono, activo) VALUES (?, ?, ?, ?, 1)`,
          [nombre, r.documento, r.email || null, r.tel || null]
        );
        creados++;
      }
    }

    res.json({
      ok: true,
      mensaje: `✅ ${creados} alumnos nuevos creados, ${actualizados} actualizados con email/teléfono, ${sinCambios} sin cambios.`
    });
  } catch (err) {
    console.error('❌ Error importar clientes:', err.message);
    res.status(500).json({ error: 'Error al importar clientes: ' + err.message });
  }
});

// ── Parsea CSV de Neocita manteniendo registros SIN documento (para agenda import) ──
function parsearCSVNeocitaAgenda(buffer) {
  const lines = buffer.toString('utf8').replace(/^﻿/, '').split('\n').map(l => l.trim()).filter(Boolean);
  const registros = [];
  for (const line of lines) {
    if (line.startsWith('Fecha') || line.startsWith('Turnos cancelados')) continue;
    const cols = line.split(',').map(c => c.trim());
    if (cols.length < 4) continue;
    const fecha     = cols[0];
    const hora      = cols[1];
    const estado    = cols[2];
    const cliente   = cols[3];
    const motivo    = cols[4] || '';
    const documento = (cols[5] || '').replace(/\s/g, '');
    const tel       = cols[6] || '';
    const email     = cols[8] || '';
    if (!fecha || !estado) continue;
    const partes = fecha.split('-');
    if (partes.length !== 3) continue;
    const fechaISO = `${partes[2]}-${partes[1].padStart(2,'0')}-${partes[0].padStart(2,'0')}`;
    registros.push({ fechaISO, hora, estado, cliente, motivo, documento: documento || null, tel, email });
  }
  return registros;
}

// ── Normaliza nombre para matching flexible (sin tildes, minúsculas, sin dobles espacios) ──
function normalizarNombre(nombre) {
  return (nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ── POST /importar/agenda/preview — previsualizar reservas futuras a importar ──
router.post('/importar/agenda/preview', authenticateToken, upload.single('csv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo.' });
  try {
    const registros = parsearCSVNeocitaAgenda(req.file.buffer);
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

    // Solo futuros confirmados
    const futuros = registros.filter(r => r.estado === 'Confirmado' && r.fechaISO >= hoy);

    // Cargar todos los alumnos para matching por nombre
    const [alumnos] = await req.db.query('SELECT documento, nombre FROM students');
    const mapaDoc   = {};
    const mapaNombre = {};
    alumnos.forEach(a => {
      mapaDoc[a.documento] = a;
      mapaNombre[normalizarNombre(a.nombre)] = a;
    });

    const preview = futuros.map(r => {
      let alumno = null;
      let metodo = null;
      if (r.documento && mapaDoc[r.documento]) {
        alumno = mapaDoc[r.documento];
        metodo = 'documento';
      } else {
        const norm = normalizarNombre(r.cliente);
        if (mapaNombre[norm]) {
          alumno = mapaNombre[norm];
          metodo = 'nombre_exacto';
        } else {
          // Match parcial: buscar si algún alumno contiene las palabras del nombre importado
          const palabras = norm.split(' ').filter(p => p.length > 2);
          const encontrado = alumnos.find(a => {
            const na = normalizarNombre(a.nombre);
            return palabras.length >= 2 && palabras.every(p => na.includes(p));
          });
          if (encontrado) { alumno = encontrado; metodo = 'nombre_parcial'; }
        }
      }
      return {
        fechaISO: r.fechaISO, hora: r.hora, cliente: r.cliente,
        documento: alumno?.documento || null,
        nombre_sistema: alumno?.nombre || null,
        metodo: metodo || 'no_encontrado'
      };
    });

    const resumen = {
      total: futuros.length,
      por_documento:   preview.filter(p => p.metodo === 'documento').length,
      por_nombre:      preview.filter(p => p.metodo === 'nombre_exacto' || p.metodo === 'nombre_parcial').length,
      no_encontrados:  preview.filter(p => p.metodo === 'no_encontrado').length,
    };

    res.json({ resumen, registros: preview });
  } catch (err) {
    console.error('❌ Error preview agenda:', err.message);
    res.status(500).json({ error: 'Error al procesar: ' + err.message });
  }
});

// ── POST /importar/agenda/confirmar — insertar reservas futuras en agenda_reservas ──
router.post('/importar/agenda/confirmar', authenticateToken, upload.single('csv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo.' });
  try {
    const registros = parsearCSVNeocitaAgenda(req.file.buffer);
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const futuros = registros.filter(r => r.estado === 'Confirmado' && r.fechaISO >= hoy);

    const [alumnos] = await req.db.query('SELECT documento, nombre FROM students');
    const mapaDoc    = {};
    const mapaNombre = {};
    alumnos.forEach(a => {
      mapaDoc[a.documento] = a;
      mapaNombre[normalizarNombre(a.nombre)] = a;
    });

    // Cargar cupo actual por slot para respetar la capacidad durante el import
    const CAPACIDAD = 5;
    const fechas = [...new Set(futuros.map(r => r.fechaISO))];
    const cupoActual = {};
    if (fechas.length) {
      const [ocupados] = await req.db.query(
        `SELECT fecha, hora, COUNT(*) AS n FROM agenda_reservas
         WHERE fecha IN (${fechas.map(() => '?').join(',')}) AND estado = 'confirmado'
         GROUP BY fecha, hora`,
        fechas
      );
      ocupados.forEach(o => {
        const key = `${o.fecha instanceof Date ? o.fecha.toISOString().split('T')[0] : String(o.fecha).split('T')[0]}|${o.hora}`;
        cupoActual[key] = o.n;
      });
    }

    let importados    = 0;
    let duplicados    = 0;
    let noEncontrados = 0;
    let sinCupo       = 0;
    const noEncontradosNombres = new Set();

    for (const r of futuros) {
      let docFinal = null;
      if (r.documento && mapaDoc[r.documento]) {
        docFinal = r.documento;
      } else {
        const norm = normalizarNombre(r.cliente);
        if (mapaNombre[norm]) {
          docFinal = mapaNombre[norm].documento;
        } else {
          const palabras = norm.split(' ').filter(p => p.length > 2);
          const encontrado = alumnos.find(a => {
            const na = normalizarNombre(a.nombre);
            return palabras.length >= 2 && palabras.every(p => na.includes(p));
          });
          if (encontrado) docFinal = encontrado.documento;
        }
      }

      if (!docFinal) { noEncontrados++; noEncontradosNombres.add(r.cliente); continue; }

      const slotKey = `${r.fechaISO}|${r.hora}`;
      if ((cupoActual[slotKey] || 0) >= CAPACIDAD) { sinCupo++; continue; }

      try {
        const [result] = await req.db.query(
          `INSERT IGNORE INTO agenda_reservas (fecha, hora, documento, estado) VALUES (?, ?, ?, 'confirmado')`,
          [r.fechaISO, r.hora, docFinal]
        );
        if (result.affectedRows > 0) {
          importados++;
          cupoActual[slotKey] = (cupoActual[slotKey] || 0) + 1;
        } else {
          duplicados++;
        }
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') duplicados++;
        else throw e;
      }
    }

    res.json({
      ok: true,
      mensaje: `✅ ${importados} reservas importadas. ${duplicados} ya existían. ${noEncontrados} alumnos no encontrados.`,
      importados, duplicados, noEncontrados,
      noEncontradosLista: [...noEncontradosNombres].sort()
    });
  } catch (err) {
    console.error('❌ Error importar agenda:', err.message);
    res.status(500).json({ error: 'Error al importar reservas: ' + err.message });
  }
});

module.exports = router;
