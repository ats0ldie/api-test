import express from 'express';

export default function (pool) {
    const router = express.Router();
  
  // 📄 Obtener datos de un cliente por email
  router.get('/by-email/:email', async (req, res) => {
    const { email } = req.params;

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Formato de email inválido' });
    }

    const query = `
      SELECT scli.nombre AS nombres, scli.rifci AS cedula, scli.telefono, scli.email, dire11, limited, formap, mfactura, mfactura, diasppago1, porppago1,
             scli.sicm AS simc, scliseg.descrip AS descip, scli.cliente,
             (SELECT oficial FROM monecam ORDER BY fecha DESC LIMIT 1) AS factor_cambiario
      FROM scli
      INNER JOIN scliseg ON scli.segme = scliseg.segmento
      WHERE scli.email = ?
    `;

    try {
      console.log(`[INFO] Buscando cliente con email: ${email}`);
      const [results] = await pool.promise().query(query, [email]);

      if (results.length === 0) {
        return res.status(404).json({ error: 'Cliente no encontrado' });
      }

      const clientData = results[0];
      if (clientData.descip && typeof clientData.descip === 'string') {
        clientData.descip = clientData.descip.trim();
      }
      clientData.factor_cambiario = clientData.factor_cambiario || 1.00;
      console.log(`[SUCCESS] Cliente encontrado: ${clientData.nombres}`);
      res.json(clientData);
    } catch (err) {
      console.error('⚠️ Error consultando cliente por email:', err);
      res.status(500).json({ error: 'Error en la consulta del cliente', details: err.code });
    }
  });
  
    return router;
  }
