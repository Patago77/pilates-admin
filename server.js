require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { body, validationResult } = require('express-validator');

dotenv.config();

// Rutas
const paymentsRouter = require('./routes/payments');
const gastosRouter = require('./routes/gastos');
const studentsRouter = require('./routes/students');
const dashboardRouter = require('./routes/dashboard');
const statsRouter  = require('./routes/stats');
const reciboRouter = require('./routes/recibo');
const agendaRouter = require('./routes/agenda');
const usersRouter   = require('./routes/users');
const importarRouter = require('./routes/importar');

const { getCorePool } = require('./db');
const authenticateToken = require('./authMiddleware');

const app = express();
const port = process.env.PORT || 3000;

const SECRET_KEY = process.env.SECRET_KEY;
if (!SECRET_KEY) {
  console.error("❌ ERROR: SECRET_KEY no está definida en .env");
  process.exit(1);
}

// === Seguridad / hardening básico ===
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false, // simplifica para Bootstrap/CDN
}));

const allowedOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
app.use(cors({
  origin: allowedOrigin,
  credentials: false,
}));

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static('public'));

// Rate limit para login (evita fuerza bruta)
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});


// ================== LOGIN (core_db) ==================
app.post('/api/login',
  loginLimiter,
  [
    body('email').trim().notEmpty().withMessage('El email es obligatorio.'),
    body('password').notEmpty().withMessage('La contraseña es obligatoria.')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;

    try {
      const core = getCorePool();

      // users en core_db deben tener studio_id y password_hash
      const [rows] = await core.query(
        `SELECT u.id, u.email, u.password_hash, u.role, u.studio_id, s.db_name AS studio_db
         FROM users u
         JOIN studios s ON s.id = u.studio_id
         WHERE u.email = ? AND u.active = 1 AND s.active = 1
         LIMIT 1`,
        [email]
      );

      const user = rows[0];
      if (!user) return res.status(401).json({ error: "Usuario o contraseña incorrectos" });

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: "Usuario o contraseña incorrectos" });

      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role,
          studio_id: user.studio_id,
          studio_db: user.studio_db,
        },
        SECRET_KEY,
        { expiresIn: '24h' }
      );

      const isProd = process.env.NODE_ENV === 'production';
      res.cookie('admin_token', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24h en ms
      });
      res.json({ ok: true, user: { nombre: user.nombre, role: user.role } });
    } catch (error) {
      console.error("❌ Error en el login:", error.message);
      res.status(500).json({ error: "Error interno del servidor" });
    }
  }
);

// ================== LOGOUT ==================
app.post('/api/logout', (req, res) => {
  res.clearCookie('admin_token', { httpOnly: true, sameSite: 'strict' });
  res.json({ ok: true });
});

// ================== ME ==================
app.get('/api/me', authenticateToken, (req, res) => {
  res.json({ nombre: req.user.nombre, role: req.user.role });
});

// ================== RUTAS DE APP (requieren JWT) ==================
app.use('/api', paymentsRouter);
app.use('/api', gastosRouter);
app.use('/api', studentsRouter);
app.use('/api', dashboardRouter);
app.use('/api', statsRouter);
app.use('/api', reciboRouter);
app.use('/api', agendaRouter);
app.use('/api', usersRouter);
app.use('/api', importarRouter);

const path = require('path');

// Panel admin — sin caché
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/index.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Portal del alumno
app.get(['/mi-agenda', '/alumnos'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mi-agenda.html'));
});

// Inicio del servidor
app.listen(port, () => {
  console.log(`🚀 Servidor corriendo en puerto ${port}`);
});
