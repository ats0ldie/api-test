import express from 'express';

export default function (pool) {
  const router = express.Router();

  // 📄 Obtener lista de clientes
  router.get('/', (req, res) => {
    const { page = 1, limit = 10 } = req.query; // Parámetros de paginación
    const offset = (page - 1) * limit;

    const query = `
      SELECT cod_cli, nombres, cedula, usuario, clave, telefono, email, direccion,
             clasifempresa, zonaventa, simc, limitcredito, diascredito,
             deuda, tipoprecio 
      FROM v_cliente
    `;
    pool.query(query, [parseInt(limit), parseInt(offset)], (err, results) => {
      if (err) {
        console.error('⚠️ Error consultando clientes:', err);
        return res.status(500).json({ error: 'Error en la consulta de clientes' });
      }
      res.json(results);
    });
  });



  return router;
}
