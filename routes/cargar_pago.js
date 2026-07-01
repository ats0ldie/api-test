import express from 'express';
import nodemailer from 'nodemailer';
import multer from 'multer';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// Inicialización de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default function (pool) {
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

    const to = 'cobranzas2@drogueriajoskar.com'; // Correo de destino
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

    let imageUrl = null;
    let retencionImageUrl = null;

    try {
      // 1. Obtener código de cliente desde la base de datos MySQL (datasis.scli)
      let codigoCliente = '';
      try {
        const dbName = process.env.DB_NAME || 'datasis';
        const [rows] = await pool.promise().query(
          `SELECT cliente FROM ${dbName}.scli WHERE rifci = ? OR nombre = ? LIMIT 1`,
          [rif || '', nombreFarmacia || '']
        );
        if (rows && rows.length > 0) {
          codigoCliente = rows[0].cliente;
        }
      } catch (dbErr) {
        console.warn('⚠️ No se pudo obtener el código del cliente desde datasis.scli:', dbErr.message);
      }

      // Identificador base para el nombre del archivo
      const baseIdentifier = codigoCliente || numFactura || numReferencia || 'pago';
      const cleanIdentifier = baseIdentifier.toString().replace(/[^a-zA-Z0-9-_]/g, '');

      // 2. Subir comprobante principal a Supabase Storage
      if (capturaFile) {
        const ext = capturaFile.originalname.split('.').pop() || 'png';
        const fileName = `${cleanIdentifier}_${Date.now()}.${ext}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('pagosPortal')
          .upload(fileName, capturaFile.buffer, {
            contentType: capturaFile.mimetype,
            upsert: true
          });

        if (uploadError) {
          console.error('Error al subir comprobante a Supabase Storage:', uploadError);
          throw new Error(`Error al subir comprobante a Supabase Storage: ${uploadError.message}`);
        }

        const { data: publicUrlData } = supabase.storage
          .from('pagosPortal')
          .getPublicUrl(fileName);

        imageUrl = publicUrlData?.publicUrl || null;
      }

      // 3. Subir comprobante de retención (opcional) a Supabase Storage
      if (capturaRetencionFile) {
        const extRet = capturaRetencionFile.originalname.split('.').pop() || 'png';
        const fileNameRet = `${cleanIdentifier}_retencion_${Date.now()}.${extRet}`;

        const { data: uploadDataRet, error: uploadErrorRet } = await supabase.storage
          .from('pagosPortal')
          .upload(fileNameRet, capturaRetencionFile.buffer, {
            contentType: capturaRetencionFile.mimetype,
            upsert: true
          });

        if (uploadErrorRet) {
          console.error('Error al subir retención a Supabase Storage:', uploadErrorRet);
        } else {
          const { data: publicUrlDataRet } = supabase.storage
            .from('pagosPortal')
            .getPublicUrl(fileNameRet);
          retencionImageUrl = publicUrlDataRet?.publicUrl || null;
        }
      }

      // 4. Insertar datos en la tabla 'pagosPortal' de Supabase
      const { error: supabaseDbError } = await supabase
        .from('pagosPortal')
        .insert([
          {
            vende: vendedor || null,
            cliente: nombreFarmacia || null,
            rif: rif || null,
            facs: numFactura || null,
            fbanco: fechaPago || null,
            monto: monto ? parseFloat(monto) : null,
            numero: numReferencia || null,
            tipo_op: pago || null,
            banco: banco || null,
            comenta: nota || null,
            imgcomp: imageUrl || null,
            rete: retencion || null
          }
        ]);

      if (supabaseDbError) {
        console.error('Error al insertar registro en pagosPortal de Supabase:', supabaseDbError);
        throw new Error(`Error en base de datos Supabase: ${supabaseDbError.message}`);
      }

      // 5. Cargar en tabla datasisweb (wecli) de MySQL
      let connection;
      try {
        connection = await pool.promise().getConnection();
        await connection.beginTransaction();
        const query = `
          INSERT INTO wecli (vende, cliente, rif, facs, fbanco, monto, numero, tipo_op, banco, comenta, imgcomp, rete, fecha)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [
          vendedor || null,                // 1. vende
          nombreFarmacia || null,          // 2. cliente
          rif || null,                     // 3. rif
          numFactura || null,              // 4. facs
          fechaPago || null,               // 5. fbanco
          monto || null,                   // 6. monto
          numReferencia || null,           // 7. numero
          pago || null,                    // 8. tipo_op
          banco || null,                   // 9. banco
          nota || null,                    // 10. comenta
          imageUrl || (capturaFile ? capturaFile.originalname : null), // 11. imgcomp (el link o el nombre de la imagen)
          retencion || null,               // 12. rete
          new Date().toISOString().slice(0, 10) // 13. fecha
        ];

        await connection.execute(query, values);
        await connection.commit();
      } catch (dbErr) {
        if (connection) {
          try {
            await connection.rollback();
          } catch (rollbackError) {
            console.error('⚠️ Error al realizar rollback:', rollbackError.message);
          }
        }
        console.error('Error registrando el pago en la base de datos MySQL:', dbErr);
        return res.status(500).json({ error: 'Error al registrar el pago en la base de datos MySQL.', details: dbErr.message });
      } finally {
        if (connection) connection.release();
      }

      // Construir cuerpo del correo final incluyendo las URLs de Supabase
      const finalEmailBody = `
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
    URL Comprobante Supabase: ${imageUrl || 'N/A'}
    ${retencionImageUrl ? `URL Retención Supabase: ${retencionImageUrl}` : ''}
    -------------------------------------------------
  `;

      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to,
        subject: `Pago de ${cliente}`, // Asunto del correo
        text: finalEmailBody, // El cuerpo del correo
        attachments: attachments // Adjuntamos las imágenes
      });

      res.json({ ok: true, message: 'Pago registrado y correo enviado exitosamente.' });
    } catch (err) {
      console.error('Error enviando correo de pago:', err);
      res.status(500).json({ error: 'Error al registrar el pago.', details: err.message });
    }
  });

  return router;
}
