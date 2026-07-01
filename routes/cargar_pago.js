import express from 'express';
import nodemailer from 'nodemailer';
import multer from 'multer';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

export default function (pool) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() }).any();

  const getSupabaseClient = () => {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) return null;
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  };

  const ensurePaymentTable = async () => {
    const query = `
      CREATE TABLE IF NOT EXISTS pagos_portal (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        vendedor VARCHAR(255) NULL,
        nombre_farmacia VARCHAR(255) NULL,
        rif VARCHAR(100) NULL,
        num_factura VARCHAR(100) NULL,
        monto DECIMAL(12,2) NULL,
        num_referencia VARCHAR(100) NULL,
        pago VARCHAR(50) NULL,
        fecha_pago DATE NULL,
        banco VARCHAR(100) NULL,
        nota TEXT NULL,
        retencion VARCHAR(10) NULL,
        captura_url TEXT NULL,
        captura_retencion_url TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    await pool.promise().query(query);
  };

  router.post('/', upload, async (req, res) => {
    console.log('[cargar_pago] body:', req.body);
    console.log('[cargar_pago] files:', (req.files || []).map((file) => ({ fieldname: file.fieldname, originalname: file.originalname })));

    const {
      vendedor, nombreFarmacia, rif, numFactura, monto,
      numReferencia, pago, fechaPago, banco, tipoDescuento, nota, retencion
    } = req.body;

    const files = Array.isArray(req.files) ? req.files : [];
    const capturaFiles = files.filter((file) => ['captura', 'comprobante_pago'].includes(file.fieldname));
    const capturaRetencionFile = files.find((file) => ['capturaRetencion', 'comprobante_retencion'].includes(file.fieldname));

    if (!vendedor || !nombreFarmacia || !numReferencia || capturaFiles.length === 0) {
      return res.status(400).json({ error: 'Faltan datos requeridos.' });
    }

    const to = process.env.PAYMENT_EMAIL_TO || 'cobranzas2@drogueriajoskar.com';
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: 465,
      secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    const attachments = [];
    const imageUrls = [];
    let retencionUrl = null;

    try {
      let codigoCliente = '';
      try {
        const [rows] = await pool.promise().query(
          `SELECT cliente FROM ${process.env.DB_NAME || 'datasis'}.scli WHERE rifci = ? OR nombre = ? LIMIT 1`,
          [rif || '', nombreFarmacia || '']
        );
        if (rows?.length > 0) codigoCliente = rows[0].cliente;
      } catch (dbErr) {
        console.warn('No se pudo resolver el cliente:', dbErr.message);
      }

      const cleanId = (codigoCliente || numFactura || numReferencia || 'pago')
        .toString()
        .replace(/[^a-zA-Z0-9-_]/g, '');

      const supabase = getSupabaseClient();

      for (const file of capturaFiles) {
        const fileName = `${cleanId}_${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;
        attachments.push({ filename: file.originalname, content: file.buffer });

        if (supabase) {
          await supabase.storage.from('pagosPortal').upload(fileName, file.buffer, {
            contentType: file.mimetype,
            upsert: true
          });
          const { data } = supabase.storage.from('pagosPortal').getPublicUrl(fileName);
          imageUrls.push(data.publicUrl);
        }
      }

      if (capturaRetencionFile) {
        attachments.push({ filename: capturaRetencionFile.originalname, content: capturaRetencionFile.buffer });

        if (supabase) {
          const fileName = `${cleanId}_retencion_${Date.now()}_${capturaRetencionFile.originalname.replace(/\s+/g, '_')}`;
          await supabase.storage.from('pagosPortal').upload(fileName, capturaRetencionFile.buffer, {
            contentType: capturaRetencionFile.mimetype,
            upsert: true
          });
          const { data } = supabase.storage.from('pagosPortal').getPublicUrl(fileName);
          retencionUrl = data.publicUrl;
        }
      }

      await ensurePaymentTable();

      const [result] = await pool.promise().query(
        `
          INSERT INTO pagos_portal (
            vendedor,
            nombre_farmacia,
            rif,
            num_factura,
            monto,
            num_referencia,
            pago,
            fecha_pago,
            banco,
            nota,
            retencion,
            captura_url,
            captura_retencion_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          vendedor || null,
          nombreFarmacia || null,
          rif || null,
          numFactura || null,
          monto || null,
          numReferencia || null,
          pago || null,
          fechaPago || null,
          banco || null,
          nota || null,
          retencion || null,
          imageUrls[0] || null,
          retencionUrl || null
        ]
      );

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
Descuento: ${tipoDescuento || 'Ninguno'}
Retención Aplicada: ${retencion || 'N/A'}
Nota / Observación: ${nota || 'Sin nota.'}
URL comprobante principal: ${imageUrls[0] || 'N/A'}
URL comprobante retención: ${retencionUrl || 'N/A'}
-------------------------------------------------
      `;

      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to,
        subject: `Pago de ${nombreFarmacia || 'Portal Joskar'}`,
        text: emailBody,
        attachments
      });

      res.json({ ok: true, message: 'Pago registrado.', id: result.insertId, urls: imageUrls, retencionUrl });
    } catch (err) {
      console.error('Error al registrar el pago:', err);
      res.status(500).json({ error: 'Error al registrar el pago.', details: err.message });
    }
  });

  return router;
}