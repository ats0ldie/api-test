import express from 'express';
import fs from 'fs';
import path from 'path';
import SftpClient from 'ssh2-sftp-client';
import dotenv from 'dotenv';
dotenv.config();

export default function(pool) {
  const router = express.Router();

  // Función para sanitizar texto de manera similar a Python
  const sanitizeText = (text) => {
    if (typeof text !== 'string') return "na";
    return text
      .normalize('NFD') // Separa caracteres base de diacríticos (acentos)
      .replace(/[\u0300-\u036f]/g, '') // Elimina los diacríticos
      .replace(/[^a-zA-Z0-9\s]/g, '') // Elimina caracteres especiales que no sean letras, números o espacios
      .trim()
      .toLowerCase();
  };

  router.post('/', async (req, res) => {
    const { email, descip } = req.body;

    if (!email || !descip) {
      return res.status(400).json({ error: 'Se requieren los parámetros "email" y "descip".' });
    }

    const segmentFileName = `${sanitizeText(descip.toLowerCase())}.json`;
    const remoteFilePath = path.join('/var/sftp/carrito', segmentFileName);

    // Configuración SFTP
    const sftpConfig = {
      host: process.env.SFTP_HOST,
      port: 22, // Asumiendo el puerto 22, si es distinto, actualízalo
      username: process.env.SFTP_USER,
      password: process.env.SFTP_PASS
    };

    const sftp = new SftpClient();
    try {
      await sftp.connect(sftpConfig);
      const data = await sftp.get(remoteFilePath);
      await sftp.end();

      const inventory = JSON.parse(data.toString('utf8'));
      return res.json({
        email,
        descip,
        inventario: inventory
      });
    } catch (err) {
      console.error('Error al leer el archivo vía SFTP:', err);
      return res.status(500).json({ error: 'No se pudo leer el archivo de inventario.' });
    }
  });

  return router;
}