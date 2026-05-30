import express from 'express';
import nodemailer from 'nodemailer';
import multer from 'multer';
import dotenv from 'dotenv';

dotenv.config();
// INICIO CAMBIOS
export default function (pool) {
  const router = express.Router();
  // FIN CAMBIOS

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
      // INICIO CAMBIOS
      // cargar en tabla datasisweb (wecli) 
      let connection;
      try {
        connection = await pool.promise().getConnection();
        await connection.beginTransaction();
        const query = `
          INSERT INTO wecli (vende, cliente, rif, facs, fbanco, monto, numero, tipo_op, banco, comenta, fecha)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [
          vendedor || null,                // 1. vende
          nombreFarmacia || null,          // 2. cliente
          rif || null,                     // 3. rif
          numFactura || null,              // 4. facs
          fechaPago || null,               // 5. fbanco (Asumiendo que es la fecha de pago)
          monto || null,                   // 6. monto
          numReferencia || null,           // 7. numero
          pago || null,                    // 8. tipo_op (tipo de pago)
          banco || null,                   // 9. banco
          nota || null,                    // 10. comenta (o podría ser tipoDescuento)
          // capturaFile ? capturaFile.originalname : null, // 11. imgcomp (el nombre de la imagen)
          retencion || null,               // 12. rete
          new Date().toISOString().slice(0, 10) // 13. fecha (Asumiendo fecha actual de registro)
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
        console.error('Error registrando el pago en la base de datos:', dbErr);
        return res.status(500).json({ error: 'Error al registrar el pago en la base de datos.', details: dbErr.message });
      } finally {
        if (connection) connection.release();
      }
      // FIN CAMBIOS
      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to,
        subject: `Pago de ${cliente}`, // Asunto del correo
        text: emailBody, // El cuerpo del correo es la línea de texto
        attachments: attachments // Adjuntamos las imágenes
      });


      res.json({ ok: true, message: 'Pago registrado y correo enviado exitosamente.' });
    } catch (err) {
      console.error('Error enviando correo de pago:', err);
      res.status(500).json({ error: 'Error al enviar el correo.', details: err.message });
    }
  });

  // INICIO CAMBIOS
  return router;
}


//export default router;