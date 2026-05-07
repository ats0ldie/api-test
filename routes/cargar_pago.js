import express from 'express';
import nodemailer from 'nodemailer';
import multer from 'multer';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
// Middleware de Multer para manejar cualquier archivo de imagen
const upload = multer({ storage: multer.memoryStorage() }).fields([
  { name: 'captura', maxCount: 1 },
  { name: 'capturaRetencion', maxCount: 1 }
]);

router.post('/', upload, async (req, res) => {
  // Extraemos los datos enviados desde el frontend
  const {
    vendedor,
    nombreFarmacia,
    rif,
    numFactura,
    monto,
    numReferencia,
    pago,
    fechaPago,
    banco,
    tipoDescuento,
    nota,
    retencion
  } = req.body;

  // Extraemos los archivos de imagen
  const capturaFile = req.files?.captura?.[0];
  const capturaRetencionFile = req.files?.capturaRetencion?.[0];

  // Validamos que todos los datos necesarios estén presentes
  if (!vendedor || !nombreFarmacia || !numReferencia || !capturaFile) {
    return res.status(400).json({ error: 'Faltan datos requeridos (vendedor, cliente, referencia o imagen de comprobante).' });
  }

  const to = 'cobranzas@drogueriajoskar.com'; // Correo de destino
  const cliente = nombreFarmacia; // Usamos nombreFarmacia como el cliente para el asunto

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  // Construir el cuerpo del correo para mejor legibilidad
  const emailBody = `
    Se ha recibido un nuevo comprobante de pago con los siguientes detalles:
    -------------------------------------------------
    Vendedor: ${vendedor || 'N/A'}
    Cliente: ${nombreFarmacia || 'N/A'}
    RIF: ${rif || 'N/A'}
    Nº Factura: ${numFactura || 'N/A'}
    Fecha de Pago: ${fechaPago || 'N/A'}
    Monto: ${monto || 'N/A'}
    Nº Referencia: ${numReferencia || 'N/A'}
    Tipo de Pago: ${pago || 'N/A'}
    Banco: ${banco || 'N/A'}
    Descuentos: ${tipoDescuento || 'Ninguno'}
    Retención Aplicada: ${retencion || 'N/A'}
    Nota / Observación: ${nota || 'Sin nota.'}
    -------------------------------------------------
  `;

  // Preparar los adjuntos
  const attachments = [];
  if (capturaFile) {
    attachments.push({ filename: capturaFile.originalname, content: capturaFile.buffer });
  }
  if (capturaRetencionFile) {
    attachments.push({ filename: capturaRetencionFile.originalname, content: capturaRetencionFile.buffer });
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to,
      subject: `Pago de ${cliente}`, // Asunto del correo
      text: emailBody, // El cuerpo del correo es la línea de texto
      attachments: attachments // Adjuntamos las imágenes
    });
    res.json({ ok: true, message: 'Correo enviado exitosamente.' });
  } catch (err) {
    console.error('Error enviando correo de pago:', err);
    res.status(500).json({ error: 'Error al enviar el correo.', details: err.message });
  }
});

export default router;