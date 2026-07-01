import express from 'express';
import nodemailer from 'nodemailer';
import multer from 'multer';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default function (pool) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() }).any();

  router.post('/', upload, async (req, res) => {
    const { vendedor, nombreFarmacia, rif, numFactura, monto, numReferencia, pago, fechaPago, banco, nota, retencion } = req.body;
    
    // Identificar archivos desde el array de multer
    const files = req.files || [];
    const capturaFiles = files.filter(f => f.fieldname === 'comprobante_pago'); // 'comprobante_pago' es el nombre en tu input de page.tsx
    const capturaRetencionFile = files.find(f => f.fieldname === 'comprobante_retencion');

    if (!vendedor || !nombreFarmacia || !numReferencia || capturaFiles.length === 0) {
      return res.status(400).json({ error: 'Faltan datos requeridos o archivos.' });
    }

    try {
      // 1. Obtener cliente
      const [rows] = await pool.promise().query(`SELECT cliente FROM ${process.env.DB_NAME || 'datasis'}.scli WHERE rifci = ? OR nombre = ? LIMIT 1`, [rif || '', nombreFarmacia || '']);
      const codigoCliente = rows?.[0]?.cliente || 'pago';
      const cleanId = codigoCliente.toString().replace(/[^a-zA-Z0-9-_]/g, '');

      // 2. Subir archivos a Supabase
      const uploadedUrls = [];
      for (const file of capturaFiles) {
        const fileName = `${cleanId}_${Date.now()}_${file.originalname}`;
        await supabase.storage.from('pagosPortal').upload(fileName, file.buffer, { contentType: file.mimetype });
        const { data } = supabase.storage.from('pagosPortal').getPublicUrl(fileName);
        uploadedUrls.push(data.publicUrl);
      }

      // 3. Insertar en Supabase y MySQL (se usa la primera URL como principal)
      await supabase.from('pagosPortal').insert([{
        vende: vendedor, cliente: nombreFarmacia, rif, facs: numFactura, fbanco: fechaPago,
        monto: parseFloat(monto), numero: numReferencia, tipo_op: pago, banco, comenta: nota,
        imgcomp: uploadedUrls[0], rete: retencion
      }]);

      const [conn] = await pool.promise().getConnection();
      await conn.execute(`INSERT INTO wecli (vende, cliente, rif, facs, fbanco, monto, numero, tipo_op, banco, comenta, imgcomp, rete) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [vendedor, nombreFarmacia, rif, numFactura, fechaPago, monto, numReferencia, pago, banco, nota, uploadedUrls[0], retencion]);
      conn.release();

      // 4. Enviar Correo
      const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: 465, secure: true, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      await transporter.sendMail({
        from: process.env.SMTP_USER, to: 'cobranzas2@drogueriajoskar.com', subject: `Pago de ${nombreFarmacia}`,
        text: `Detalles: ${numReferencia}, Monto: ${monto}. URLs: ${uploadedUrls.join(', ')}`
      });

      res.json({ ok: true, message: 'Pago registrado exitosamente.' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al registrar el pago.', details: err.message });
    }
  });

  return router;
}