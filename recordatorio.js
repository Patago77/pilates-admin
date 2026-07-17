require('dotenv').config();
const { getStudioPool } = require('./db');
const { enviarRecordatorio } = require('./emailService');

async function enviarRecordatorios() {
  const db = getStudioPool('pilates_admin_db');

  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  const fechaManana = manana.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

  try {
    const [turnos] = await db.query(
      `SELECT ar.hora, s.nombre, s.email
       FROM agenda_reservas ar
       JOIN students s ON s.documento = ar.documento
       WHERE ar.fecha = ? AND ar.estado = 'confirmado' AND s.email IS NOT NULL AND s.email != ''
       ORDER BY ar.hora ASC`,
      [fechaManana]
    );

    console.log(`📅 Recordatorios para ${fechaManana}: ${turnos.length} turnos`);

    for (const t of turnos) {
      try {
        await enviarRecordatorio(t.email, t.nombre.split(' ')[0], fechaManana, t.hora);
        console.log(`✅ ${t.nombre} <${t.email}> — ${t.hora}hs`);
      } catch (err) {
        console.error(`❌ Error enviando a ${t.email}:`, err.message);
      }
    }

    console.log('Listo.');
  } catch (err) {
    console.error('❌ Error consultando turnos:', err.message);
  } finally {
    process.exit(0);
  }
}

enviarRecordatorios();
