// Carga datos de ejemplo (ficticios) en un estudio demo, para mostrarle
// el sistema "andando" a un prospecto sin exponer datos reales de nadie.
//
// Uso:
//   node scripts/seed_demo.js <db_name> [cantidad_alumnas]
// Ej:
//   node scripts/seed_demo.js studio_estudio_demo_db 40
//
// Seguridad: se niega a correr si <db_name> no tiene el patrón
// studio_..._db que usa el onboarding — así no hay forma de que esto
// termine escribiendo datos falsos en una base real por error de tipeo.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const dbName = process.argv[2];
const cantidadAlumnas = Math.min(parseInt(process.argv[3] || '40', 10), 200);

if (!dbName) {
  console.error('Uso: node scripts/seed_demo.js <db_name> [cantidad_alumnas]');
  process.exit(1);
}
if (!/^studio_[a-z0-9_]+_db$/.test(dbName)) {
  console.error(`❌ '${dbName}' no tiene el patrón de un estudio creado por el onboarding (studio_..._db).`);
  console.error('   Por seguridad este script no corre contra bases que no coincidan con ese patrón.');
  process.exit(1);
}

const NOMBRES = ['María', 'Lucía', 'Sofía', 'Valentina', 'Camila', 'Julieta', 'Martina', 'Florencia', 'Agustina', 'Micaela',
  'Rocío', 'Carla', 'Paula', 'Daniela', 'Antonella', 'Belén', 'Victoria', 'Milagros', 'Ana', 'Laura'];
const APELLIDOS = ['González', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'Pérez', 'García', 'Sánchez', 'Romero', 'Díaz',
  'Álvarez', 'Torres', 'Ruiz', 'Ramírez', 'Flores', 'Acosta', 'Benítez', 'Medina', 'Herrera', 'Suárez'];
const PLANES = [
  { nombre: '4 clases', precio: 58000 },
  { nombre: '6 clases', precio: 66000 },
  { nombre: '8 clases', precio: 74000 },
  { nombre: '12 clases', precio: 81000 },
];
const HORAS = ['09:00', '10:00', '11:00', '12:00', '13:00', '17:00', '18:00', '19:00', '20:00'];
// Patrón de ocupación por hora (0 a 1), variado a propósito para que se vea real.
const OCUPACION_HORA = { '09:00': 0.8, '10:00': 0.6, '11:00': 0.5, '12:00': 0.3, '13:00': 0.4, '17:00': 0.3, '18:00': 0.75, '19:00': 0.85, '20:00': 0.9 };

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomDocumento() { return String(30000000 + Math.floor(Math.random() * 20000000)); }
function fechaISO(d) { return d.toISOString().slice(0, 10); }

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: dbName,
  });

  console.log(`→ Sembrando ${cantidadAlumnas} alumnas de ejemplo en ${dbName}...`);

  // 0) Limpiar datos de una siembra anterior — el script no es acumulativo,
  // correrlo dos veces sobre la misma base debe dar el mismo resultado, no duplicar.
  // Seguro: dbName ya pasó el chequeo de patrón studio_..._db de más arriba.
  for (const tabla of ['agenda_reservas', 'payments', 'gastos', 'students']) {
    await conn.query(`TRUNCATE TABLE ${tabla}`);
  }

  // 1) Alumnas
  const alumnas = [];
  for (let i = 0; i < cantidadAlumnas; i++) {
    const fullName = `${pick(NOMBRES)} ${pick(APELLIDOS)}`;
    const documento = randomDocumento();
    const email = `alumna${i + 1}@demo.com`;
    alumnas.push({ fullName, documento, email, plan: pick(PLANES) });
  }
  for (const a of alumnas) {
    await conn.query(
      'INSERT INTO students (nombre, documento, email, activo) VALUES (?, ?, ?, 1)',
      [a.fullName, a.documento, a.email]
    );
  }

  // 2) Pagos — últimos 3 meses, la mayoría al día, algunas en deuda para que se vea real
  const hoy = new Date();
  for (let mesAtras = 2; mesAtras >= 0; mesAtras--) {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - mesAtras, 5 + Math.floor(Math.random() * 5));
    const serviceMonth = fecha.toISOString().slice(0, 7);
    for (const a of alumnas) {
      if (mesAtras === 0 && Math.random() < 0.15) continue; // ~15% sin pagar el mes actual, para que se note
      const debe = mesAtras === 0 && Math.random() < 0.1;
      await conn.query(
        `INSERT INTO payments (fullName, documento, subscriptionType, amount, paymentDate, serviceMonth, metodoPago, estadoDeuda)
         VALUES (?, ?, ?, ?, ?, ?, 'transferencia', ?)`,
        [a.fullName, a.documento, a.plan.nombre, a.plan.precio, fechaISO(fecha), serviceMonth, debe ? 'debe' : 'al_dia']
      );
    }
  }

  // 3) Gastos — algunos genéricos de un estudio
  const gastosEjemplo = [
    ['Alquiler', 'Alquiler del local', 350000],
    ['Sueldos', 'Sueldo profesoras', 480000],
    ['Insumos', 'Colchonetas y bandas', 45000],
    ['Servicios', 'Luz y agua', 38000],
    ['Marketing', 'Publicidad redes sociales', 20000],
  ];
  for (let mesAtras = 1; mesAtras >= 0; mesAtras--) {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - mesAtras, 10);
    for (const [categoria, descripcion, monto] of gastosEjemplo) {
      await conn.query(
        'INSERT INTO gastos (fecha, categoria, descripcion, monto) VALUES (?, ?, ?, ?)',
        [fechaISO(fecha), categoria, descripcion, monto]
      );
    }
  }

  // 4) Agenda — últimas 4 semanas, Lunes a Viernes, con ocupación variada por hora
  let totalReservas = 0;
  for (let semana = 3; semana >= 0; semana--) {
    for (let dia = 0; dia < 5; dia++) { // 0=Lunes ... 4=Viernes
      const fecha = new Date(hoy);
      fecha.setDate(hoy.getDate() - (semana * 7) - hoy.getDay() + 1 + dia);
      if (fecha > hoy) continue;
      for (const hora of HORAS) {
        const objetivo = Math.round(5 * OCUPACION_HORA[hora]); // capacidad de referencia: 5
        const cantidad = Math.max(0, objetivo + Math.floor(Math.random() * 2) - 1); // un poco de variación
        const elegidas = [...alumnas].sort(() => Math.random() - 0.5).slice(0, cantidad);
        for (const a of elegidas) {
          try {
            await conn.query(
              `INSERT IGNORE INTO agenda_reservas (fecha, hora, documento, estado) VALUES (?, ?, ?, 'confirmado')`,
              [fechaISO(fecha), hora, a.documento]
            );
            totalReservas++;
          } catch { /* colisión de horario para esa alumna, se ignora */ }
        }
      }
    }
  }

  // 5) Config del estudio — horario semanal + reformers, para que esos paneles no queden vacíos
  // studio_config no la crea ningun schema.sql: la app la crea sola (ensureConfigTable en
  // routes/stats.js) la primera vez que alguien entra al panel Reformers. En un estudio
  // recien creado todavia no existe, asi que la creamos acá con la misma definicion.
  await conn.query(`
    CREATE TABLE IF NOT EXISTS studio_config (
      clave VARCHAR(80) PRIMARY KEY,
      valor TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  const horarioSemana = { '1': HORAS, '2': HORAS, '3': HORAS, '4': HORAS, '5': HORAS };
  await conn.query(
    `INSERT INTO studio_config (clave, valor) VALUES ('agenda_horario_semana', ?)
     ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
    [JSON.stringify(horarioSemana)]
  );
  const rfConfig = { rf_cantidad: '5', rf_precio_clase: '22000', rf_precio_alquiler: '10000', rf_sueldo_profe: '12000', rf_precio_clase_profe: '15000', rf_alumnos_por_reformer: '1' };
  for (const [clave, valor] of Object.entries(rfConfig)) {
    await conn.query(
      `INSERT INTO studio_config (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
      [clave, valor]
    );
  }

  await conn.end();
  console.log(`✅ Listo: ${alumnas.length} alumnas, ${totalReservas} reservas de agenda, pagos y gastos de ejemplo cargados en ${dbName}.`);
}

main().catch(err => {
  console.error('❌ Error sembrando datos demo:', err.message);
  process.exit(1);
});
