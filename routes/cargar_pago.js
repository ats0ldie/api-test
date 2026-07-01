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
    try {
      const { vendedor, nombreFarmacia, rif, numFactura, monto, numReferencia, pago, fechaPago, banco, nota, retencion } = req.body;
      const files = req.files || [];

      // Validación simple
      if (!vendedor || !nombreFarmacia || files.length === 0) {
        return res.status(400).json({ error: 'Faltan datos requeridos o archivos.' });
      }

      // 1. Obtener código de cliente (Manejo de error seguro)
      let codigoCliente = 'pago';
      try {
        const [rows] = await pool.promise().query(
          `SELECT cliente FROM ${process.env.DB_NAME || 'datasis'}.scli WHERE rifci = ? OR nombre = ? LIMIT 1`, 
          [rif || '', nombreFarmacia || '']
        );
        if (rows && rows.length > 0) codigoCliente = rows[0].cliente;
      } catch (e) { console.error("Error BD SCLI:", e.message); }

      const cleanId = (codigoCliente || 'pago').toString().replace(/[^a-zA-Z0-9-_]/g, '');

      // 2. Subir a Supabase
      const uploadedUrls = [];
      for (const file of files) {
        const fileName = `${cleanId}_${Date.now()}_${file.originalname}`;
        const { error: uploadError } = await supabase.storage.from('pagosPortal').upload(fileName, file.buffer, { contentType: file.mimetype });
        if (!uploadError) {
          const { data } = supabase.storage.from('pagosPortal').getPublicUrl(fileName);
          uploadedUrls.push(data.publicUrl);
        }
      }

      // 3. Insertar en MySQL (Usamos 'wecli' asegurando que los campos existan)
      // Nota: Si el insert falla, revisa que los nombres de columnas coincidan exactamente
      const [conn] = await pool.promise().getConnection();
      try {
        await conn.execute(
          `INSERT INTO wecli (vende, cliente, rif, facs, fbanco, monto, numero, tipo_op, banco, comenta, imgcomp, rete) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [vendedor, nombreFarmacia, rif, numFactura, fechaPago, monto || 0, numReferencia, pago, banco, nota, uploadedUrls[0] || null, retencion]
        );
      } catch (dbErr) {
        console.error("Error insertando en MySQL:", dbErr);
        throw new Error("No se pudo registrar en la base de datos local.");
      } finally {
        conn.release();
      }

      // 4. Correo
      const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: 465, secure: true, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      await transporter.sendMail({
        from: process.env.SMTP_USER, to: 'cobranzas2@drogueriajoskar.com', subject: `Pago de ${nombreFarmacia}`,
        text: `Pago recibido de ${nombreFarmacia}. Referencia: ${numReferencia}. Comprobantes: ${uploadedUrls.join(', ')}`
      });

      res.json({ ok: true, message: 'Pago registrado exitosamente.' });
    } catch (err) {
      console.error("Error Final:", err);
      res.status(500).json({ error: 'Error al registrar el pago.', details: err.message });
    }
  });

  return router;
}