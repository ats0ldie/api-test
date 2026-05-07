import express from 'express';
import nodemailer from 'nodemailer';
import multer from 'multer';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/', upload.single('file'), async (req, res) => {
  const { rif, nombreFarmacia, subject, text } = req.body;
  const file = req.file;

  if (!file || !rif || !nombreFarmacia) {
    return res.status(400).json({ error: 'Faltan datos requeridos (archivo, rif o nombreFarmacia)' });
  }

  const to = 'cobranzas@drogueriajoskar.com';
  const nombresLimpio = (nombreFarmacia || '').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
  const fileName = `${rif}_${nombresLimpio}.pdf`;

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
      subject: subject || `Devolución de ${nombreFarmacia}`,
      text: text || `Adjunto PDF de devolución del cliente ${rif} - ${nombreFarmacia}`,
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