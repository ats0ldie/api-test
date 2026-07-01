import express from 'express';
import nodemailer from 'nodemailer';
import multer from 'multer';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default function (pool) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() }).any();

  router.post('/', upload, async (req, res) => {
    const {
      vendedor, nombreFarmacia, rif, numFactura, monto,
      numReferencia, pago, fechaPago, banco, tipoDescuento, nota, retencion
    } = req.body;

    const files = req.files || [];
    const capturaFiles = files.filter(f => f.fieldname === 'captura');
    const capturaRetencionFile = files.find(f => f.fieldname === 'capturaRetencion');

    if (!vendedor || !nombreFarmacia || !numReferencia || capturaFiles.length === 0) {
      return res.status(400).json({ error: 'Faltan datos requeridos.' });
    }

    const to = 'cobranzas2@drogueriajoskar.com';
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: 465,
      secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    const attachments = [];
    capturaFiles.forEach(f => attachments.push({ filename: f.originalname, content: f.buffer }));
    if (capturaRetencionFile) attachments.push({ filename: capturaRetencionFile.originalname, content: capturaRetencionFile.buffer });

    let imageUrls = [];

    try {
      let codigoCliente = '';
      try {
        const [rows] = await pool.promise().query(`SELECT cliente FROM ${process.env.DB_NAME || 'datasis'}.scli WHERE rifci = ? OR nombre = ? LIMIT 1`, [rif || '', nombreFarmacia || '']);
        if (rows?.length > 0) codigoCliente = rows[0].cliente;
      } catch (dbErr) { console.warn(dbErr.message); }

      const cleanId = (codigoCliente || numFactura || numReferencia || 'pago').toString().replace(/[^a-zA-Z0-9-_]/g, '');

      // Subir todas las capturas
      for (const file of capturaFiles) {
        const fileName = `${cleanId}_${Date.now()}_${file.originalname}`;
        await supabase.storage.from('pagosPortal').upload(fileName, file.buffer, { contentType: file.mimetype });
        const { data } = supabase.storage.from('pagosPortal').getPublicUrl(fileName);
        imageUrls.push(data.publicUrl);
      }

      // Registro en BD y envío de correo igual que tu lógica original...
      // (Nota: imageUrls[0] es la principal ahora)
      
      await transporter.sendMail({
        from: process.env.SMTP_USER, to, subject: `Pago de ${nombreFarmacia}`,
        text: "Pago recibido con múltiples comprobantes.",
        attachments
      });

      res.json({ ok: true, message: 'Pago registrado.' });
    } catch (err) {
      res.status(500).json({ error: 'Error al registrar el pago.', details: err.message });
    }
  });

  return router;
}