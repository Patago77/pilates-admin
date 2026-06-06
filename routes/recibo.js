const express = require('express');
const PDFDocument = require('pdfkit');
const authenticateToken = require('../authMiddleware');

const router = express.Router();

router.get('/recibo/:id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await req.db.query('SELECT * FROM payments WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Pago no encontrado.' });
    const p = rows[0];

    // Datos del alumno si existe
    let alumno = null;
    if (p.documento) {
      const [st] = await req.db.query('SELECT * FROM students WHERE documento = ?', [p.documento]);
      alumno = st[0] || null;
    }

    const doc = new PDFDocument({ size: 'A5', margin: 40 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="recibo-${p.id}.pdf"`);
    doc.pipe(res);

    // Encabezado
    doc.fontSize(18).font('Helvetica-Bold').text('Studio Admin', { align: 'center' });
    doc.fontSize(11).font('Helvetica').fillColor('#666').text('Comprobante de pago', { align: 'center' });
    doc.moveDown(0.5);

    // Línea separadora
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.5);

    // Datos del recibo
    const fmt = (n) => Number(n).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
    const fmtFecha = (d) => new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const linea = (label, valor) => {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#333').text(label + ':', { continued: true, width: 130 });
      doc.font('Helvetica').fillColor('#000').text(' ' + valor);
    };

    doc.fillColor('#000');
    linea('N° recibo',   `#${String(p.id).padStart(4, '0')}`);
    linea('Fecha',       fmtFecha(p.paymentDate));
    linea('Alumno',      p.fullName || '—');
    if (p.documento) linea('Documento', p.documento);
    if (alumno?.telefono) linea('Teléfono', alumno.telefono);
    linea('Plan / Abono', p.subscriptionType || '—');
    if (p.serviceMonth) linea('Período', p.serviceMonth);
    doc.moveDown(0.4);

    // Monto destacado
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1D9E75')
       .text('Total abonado: ' + fmt(p.amount), { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#cccccc').stroke();

    // Pie
    doc.moveDown(1);
    doc.fontSize(9).font('Helvetica').fillColor('#999')
       .text('Este comprobante fue generado automáticamente por Studio Admin.', { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('❌ Error generando recibo:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar el recibo.' });
  }
});

module.exports = router;
