const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM     = `"Studio Pilates" <${process.env.SMTP_USER}>`;
const OVERRIDE = process.env.MAIL_TEST_OVERRIDE || null;

function destino(email) {
  return OVERRIDE || email;
}

function fmtFecha(fecha) {
  return new Date(fecha + 'T12:00:00-03:00')
    .toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });
}

function wrapEmail(contenido) {
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e9e4ff;">
      <div style="background:#1C1A2E;padding:20px 28px;">
        <div style="color:#a78bfa;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;">Studio Pilates</div>
      </div>
      <div style="padding:28px;">
        ${contenido}
      </div>
      <div style="background:#f5f4ff;padding:14px 28px;font-size:11px;color:#aaa;text-align:center;">
        Este es un mensaje automático, no respondas a este correo.
      </div>
    </div>`;
}

async function enviarOTP(email, nombre, otp) {
  const to = destino(email);
  await transporter.sendMail({
    from: FROM,
    to,
    subject: 'Tu código de acceso — Studio Pilates',
    html: wrapEmail(`
      <h2 style="color:#1C1A2E;margin:0 0 8px;">Hola ${nombre}</h2>
      <p style="color:#555;margin:0 0 20px;">Tu código de acceso al portal de clases es:</p>
      <div style="font-size:42px;font-weight:700;letter-spacing:12px;color:#6D28D9;text-align:center;padding:24px 0;background:#f5f4ff;border-radius:10px;margin-bottom:20px;">
        ${otp}
      </div>
      <p style="color:#888;font-size:13px;margin:0;">Válido por <b>15 minutos</b>. No lo compartas con nadie.</p>
      ${OVERRIDE ? `<p style="color:#E24B4A;font-size:11px;margin-top:12px;">[TEST] Destinatario original: ${email}</p>` : ''}`),
  });
}

async function enviarConfirmacionReserva(email, nombre, fecha, hora) {
  const to = destino(email);
  const fechaFmt = fmtFecha(fecha);
  await transporter.sendMail({
    from: FROM,
    to,
    subject: `Clase confirmada — ${fechaFmt} ${hora}hs`,
    html: wrapEmail(`
      <h2 style="color:#1D9E75;margin:0 0 8px;">¡Reserva confirmada!</h2>
      <p style="color:#555;margin:0 0 16px;">Hola <b>${nombre}</b>, tu clase quedó agendada:</p>
      <div style="background:#f0fdf8;border-radius:10px;padding:18px 20px;margin-bottom:16px;border-left:4px solid #1D9E75;">
        <div style="font-size:15px;color:#1C1A2E;margin-bottom:6px;">📅 <b>${fechaFmt}</b></div>
        <div style="font-size:15px;color:#1C1A2E;">🕐 <b>${hora}hs</b></div>
      </div>
      <p style="color:#888;font-size:13px;margin:0;">Podés cancelar hasta <b>12 horas antes</b> desde tu portal y la clase vuelve a tu abono.</p>
      ${OVERRIDE ? `<p style="color:#E24B4A;font-size:11px;margin-top:12px;">[TEST] Destinatario original: ${email}</p>` : ''}`),
  });
}

async function enviarCancelacion(email, nombre, fecha, hora, claseDevuelta = false) {
  const to = destino(email);
  const fechaFmt = fmtFecha(fecha);
  const mensajeAbono = claseDevuelta
    ? '<p style="color:#1D9E75;font-size:13px;margin-top:12px;">✅ La clase fue devuelta a tu abono.</p>'
    : '<p style="color:#E24B4A;font-size:13px;margin-top:12px;">⚠️ La clase fue descontada de tu abono (cancelación tardía o límite alcanzado).</p>';

  await transporter.sendMail({
    from: FROM,
    to,
    subject: `Clase cancelada — ${fechaFmt} ${hora}hs`,
    html: wrapEmail(`
      <h2 style="color:#E24B4A;margin:0 0 8px;">Clase cancelada</h2>
      <p style="color:#555;margin:0 0 16px;">Hola <b>${nombre}</b>, cancelaste tu clase del:</p>
      <div style="background:#fef2f2;border-radius:10px;padding:18px 20px;margin-bottom:16px;border-left:4px solid #E24B4A;">
        <div style="font-size:15px;color:#1C1A2E;margin-bottom:6px;">📅 <b>${fechaFmt}</b></div>
        <div style="font-size:15px;color:#1C1A2E;">🕐 <b>${hora}hs</b></div>
      </div>
      ${mensajeAbono}
      <p style="color:#888;font-size:13px;margin-top:8px;">Podés reservar otro turno desde tu portal cuando quieras.</p>
      ${OVERRIDE ? `<p style="color:#E24B4A;font-size:11px;margin-top:12px;">[TEST] Destinatario original: ${email}</p>` : ''}`),
  });
}

async function enviarRecordatorio(email, nombre, fecha, hora) {
  const to = destino(email);
  const fechaFmt = fmtFecha(fecha);
  await transporter.sendMail({
    from: FROM,
    to,
    subject: `Recordatorio: clase mañana ${hora}hs — Studio Pilates`,
    html: wrapEmail(`
      <h2 style="color:#6D28D9;margin:0 0 8px;">Recordatorio de clase</h2>
      <p style="color:#555;margin:0 0 16px;">Hola <b>${nombre}</b>, mañana tenés clase:</p>
      <div style="background:#f5f4ff;border-radius:10px;padding:18px 20px;margin-bottom:16px;border-left:4px solid #6D28D9;">
        <div style="font-size:15px;color:#1C1A2E;margin-bottom:6px;">📅 <b>${fechaFmt}</b></div>
        <div style="font-size:15px;color:#1C1A2E;">🕐 <b>${hora}hs</b></div>
      </div>
      <p style="color:#888;font-size:13px;margin:0;">Si no podés asistir, cancelá antes de las <b>${hora}hs de hoy</b> para recuperar la clase.</p>
      ${OVERRIDE ? `<p style="color:#E24B4A;font-size:11px;margin-top:12px;">[TEST] Destinatario original: ${email}</p>` : ''}`),
  });
}

async function enviarCampana(email, nombre, mensajeTexto, asunto) {
  const to = destino(email);
  const primerNombre = nombre.split(' ')[0];
  const texto = mensajeTexto.replace(/\{nombre\}/gi, primerNombre).replace(/\n/g, '<br>');
  await transporter.sendMail({
    from: FROM,
    to,
    subject: asunto || 'Te extrañamos — Studio Pilates',
    html: wrapEmail(`
      <h2 style="color:#6D28D9;margin:0 0 16px;">¡Hola ${primerNombre}!</h2>
      <div style="color:#555;line-height:1.7;font-size:15px;">${texto}</div>
      ${OVERRIDE ? `<p style="color:#E24B4A;font-size:11px;margin-top:12px;">[TEST] Destinatario original: ${email}</p>` : ''}
    `),
  });
}

module.exports = { enviarOTP, enviarConfirmacionReserva, enviarCancelacion, enviarRecordatorio, enviarCampana };
