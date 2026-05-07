import express from 'express';
import nodemailer from 'nodemailer';
import multer from 'multer';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/', upload.single('file'), async (req, res) => {
  // Recibe datos desde el frontend
  const { cedula, nombres, subject, text } = req.body;
  const file = req.file;

  console.log('BODY:', req.body);
  console.log('FILE:', file);

  if (!file || !cedula || !nombres) {
    return res.status(400).json({ error: 'Faltan datos requeridos (archivo, cedula o nombres)' });
  }

  // Correo fijo de destino
  const to = 'atencion@drogueriajoskar.com';

  // Construir texto adicional con cedula
  let infoCliente = '';
  if (cedula) infoCliente += `Cédula: ${cedula}\n`;

  // Fecha y hora en zona -04:30
  const now = new Date();
  // Ajuste manual para -04:30 (Venezuela)
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset() - 270); // 270 min = 4h30m
  const pad = n => n.toString().padStart(2, '0');
  const fecha = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const hora = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  // Limpiar nombres para el archivo
  const nombresLimpio = (nombres || '').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
  const fileName = `${cedula}_${nombresLimpio}_${fecha}_${hora}.xlsx`;

  // Configura tu SMTP de Hostinger
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to,
      subject: `Pedido Online de ${nombres}`,
      text: `${infoCliente}${text || 'Adjunto su pedido en formato XLSX.'}`,
      attachments: [
        {
          filename: fileName,
          content: file.buffer
        }
      ]
    });
    res.json({ ok: true, message: 'Correo enviado' });
  } catch (err) {
    res.status(500).json({ error: 'Error enviando correo', details: err.message });
  }
});

export default router;