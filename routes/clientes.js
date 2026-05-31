import express from 'express';

export default function (pool) {
  const router = express.Router();

  // 📄 Obtener lista de clientes
  router.get('/', (req, res) => {
    // 1. Tomamos los parámetros y nos aseguramos de que sean números válidos
    const q = req.query.q || '';
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    let query = `
      SELECT cod_cli, nombres, cedula, usuario, clave, telefono, email, direccion,
             clasifempresa, zonaventa, simc, limitcredito, diascredito,
             deuda, tipoprecio 
      FROM v_cliente
    `;

    let params = [];

    // 2. Si hay texto a buscar, agregamos el filtro
    if (q) {
      query += ` WHERE nombres LIKE ? `;
      params.push(`%${q}%`);
    }

    // 3. Inyectamos LIMIT y OFFSET directamente de forma segura (como ya son enteros, no hay riesgo de inyección)
    query += ` LIMIT ${limit} OFFSET ${offset}`;

    pool.query(query, params, (err, results) => {
      if (err) {
        // Esto imprimirá en la consola exacta cuál es el error en caso de que falle
        console.error('⚠️ Error consultando clientes:', err.message);
        return res.status(500).json({ error: 'Error en la consulta de clientes' });
      }
      res.json(results);
    });
  });

  return router;
}
