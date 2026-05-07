import express from 'express';

export default function (pool) {
  const router = express.Router();

  // 📦 Obtener inventario con lógica de descuentos por lote o generales
  router.get('/', (req, res) => {
    const tipoprecio = parseInt(req.query.tipoprecio, 10) || 1;
    const precioCampo = tipoprecio === 2 ? 'a.pvreferencial2' : 'a.pvreferencial1';

    // Consulta optimizada para aplicar el descuento correcto
    const query = `
      SELECT 
        a.id, a.ddetallada, a.codalternativo, ${precioCampo} AS precio, a.dependencias,
        e.codigoarticulo, e.id_art, e.fv, e.existencia, e.lote,
        COALESCE(
          (
            SELECT toyd.descuento
            FROM v_temp_articulos_ofertasydescuentos toyd
            JOIN v_ofertasydescuentos od ON toyd.id_oyd = od.id
            WHERE 
              CONVERT(toyd.codigoarticulo USING utf8) COLLATE utf8_spanish_ci = CONVERT(e.id_art USING utf8) COLLATE utf8_spanish_ci
              AND od.status_oyd = 'ACTIVO'
              AND od.tipomov = '2'
              AND CONVERT(toyd.lote USING utf8) COLLATE utf8_spanish_ci = CONVERT(e.lote USING utf8) COLLATE utf8_spanish_ci
            ORDER BY toyd.descuento DESC
            LIMIT 1
          ),
          (
            SELECT toyd.descuento
            FROM v_temp_articulos_ofertasydescuentos toyd
            JOIN v_ofertasydescuentos od ON toyd.id_oyd = od.id
            WHERE 
              CONVERT(toyd.codigoarticulo USING utf8) COLLATE utf8_spanish_ci = CONVERT(e.id_art USING utf8) COLLATE utf8_spanish_ci
              AND od.status_oyd = 'ACTIVO'
              AND od.tipomov = '0'
            ORDER BY toyd.descuento DESC
            LIMIT 1
          ),
          0
        ) AS descuento
      FROM v_articulo a
      LEFT JOIN v_articulo_existencia e ON a.id = e.id_art
      WHERE e.existencia > 0
      GROUP BY a.ddetallada, a.codalternativo,
                e.fv, e.existencia, e.lote, ${precioCampo};
    `;

    pool.query(query, (err, results) => {
      if (err) {
        console.error('⚠️ Error consultando inventario:', err); // <-- Esto te dará el detalle
        return res.status(500).json({ error: 'Error en la consulta de inventario' });
      }
      res.json(results);
    });
  });



  return router;
}