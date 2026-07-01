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
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_KEY is required for Storage uploads');
    }

    return createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  };

  const ensurePaymentTable = async () => {
    const query = `
      CREATE TABLE IF NOT EXISTS wecli (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        vende VARCHAR(255) NULL,
        cliente VARCHAR(255) NULL,
        rif VARCHAR(100) NULL,
        facs VARCHAR(100) NULL,
        fbanco DATE NULL,
        monto DECIMAL(12,2) NULL,
        numero VARCHAR(100) NULL,
        tipo_op VARCHAR(50) NULL,
        banco VARCHAR(100) NULL,
        comenta TEXT NULL,
        imgcomp TEXT NULL,
        rete VARCHAR(10) NULL,
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
      const cleanId = (numFactura || numReferencia || 'pago')
        .toString()
        .replace(/[^a-zA-Z0-9-_]/g, '');

      const bucketName = process.env.SUPABASE_BUCKET_NAME || process.env.SUPABASE_BUCKET || 'pagosPortal';
      const supabase = getSupabaseClient();

      for (const file of capturaFiles) {
        const fileName = `${cleanId}_${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;
        attachments.push({ filename: file.originalname, content: file.buffer });

        if (supabase) {
          const { error } = await supabase.storage.from(bucketName).upload(fileName, file.buffer, {
            contentType: file.mimetype,
            upsert: true
          });

          if (error) throw error;

          const { data } = supabase.storage.from(bucketName).getPublicUrl(fileName);
          imageUrls.push(data.publicUrl);
        }
      }

      if (capturaRetencionFile) {
        attachments.push({ filename: capturaRetencionFile.originalname, content: capturaRetencionFile.buffer });

        if (supabase) {
          const fileName = `${cleanId}_retencion_${Date.now()}_${capturaRetencionFile.originalname.replace(/\s+/g, '_')}`;
          const { error } = await supabase.storage.from(bucketName).upload(fileName, capturaRetencionFile.buffer, {
            contentType: capturaRetencionFile.mimetype,
            upsert: true
          });

          if (error) throw error;

          const { data } = supabase.storage.from(bucketName).getPublicUrl(fileName);
          retencionUrl = data.publicUrl;
        }
      }

      await ensurePaymentTable();

      const [result] = await pool.promise().query(
        `
          INSERT INTO wecli (
            vende,
            cliente,
            rif,
            facs,
            fbanco,
            monto,
            numero,
            tipo_op,
            banco,
            comenta,
            imgcomp,
            rete
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          vendedor || null,
          nombreFarmacia || null,
          rif || null,
          numFactura || null,
          fechaPago ? new Date(fechaPago) : null,
          monto ? parseFloat(monto) : null,
          numReferencia || null,
          pago || null,
          banco || null,
          nota || null,
          imageUrls[0] || null,
          retencion || null
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