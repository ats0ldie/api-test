import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

export default function (pool) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    // Recibe datos desde el frontend (carrito de compras)
    const { cliente, items } = req.body;

    if (!cliente || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Faltan datos requeridos (cliente, items)' });
    }
    
    let connection;
    try {
      connection = await pool.promise().getConnection();
      await connection.beginTransaction();

      // 1. Obtener el último número de pedido y generar el nuevo
      const [rows] = await connection.execute(
        "SELECT archivo FROM itffac WHERE archivo LIKE 'c%' ORDER BY CAST(SUBSTRING(archivo, 2) AS UNSIGNED) DESC LIMIT 1"
      );

      let nextNum = 1;
      if (rows.length > 0) {
        const lastNum = parseInt(rows[0].archivo.substring(1), 10);
        nextNum = lastNum + 1;
      }
      const nuevoArchivo = 'c' + String(nextNum).padStart(5, '0'); // ej: c00001

      // 2. Preparar la consulta de inserción
      // Obtener fecha y hora actuales en formato YYYY-MM-DD y HH:MM:SS
      const now = new Date();
      const fechaPedido = now.toISOString().slice(0, 10); // 'YYYY-MM-DD'
      const horaPedido = now.toTimeString().slice(0, 8); // 'HH:MM:SS'

      const query = `
        INSERT INTO itffac (cliente, archivo, campo1, campo2, campo3, campo4, campo7, fecha, hora, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      // 3. Iterar sobre los artículos e insertarlos
      for (const item of items) {
        const values = [
          cliente,                                  // cliente: codigo de cliente
          nuevoArchivo,                             // archivo: numero de pedido
          item.codigo,                              // campo1: codigo del articulo
          item.descripcion,                         // campo2: descripcion del articulo
          item.quantity,                            // campo3: cantidad
          item.precio_total,                        // campo4: precio total del articulo
          'CC',                                     // campo7: valor fijo 'CC'
          fechaPedido,                              // fecha: fecha del pedido
          horaPedido,                               // hora: hora del pedido
          'E'                                       // status: valor fijo 'E'
        ];
        await connection.execute(query, values);
      }

      // 4. Confirmar la transacción
      await connection.commit();

      res.json({ 
        ok: true, 
        message: 'Pedido registrado exitosamente',
        pedidoNro: nuevoArchivo 
      });

    } catch (err) {
      if (connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error('⚠️ Error al realizar rollback (conexión cerrada):', rollbackError.message);
        }
      }
      console.error('⚠️ Error registrando pedido:', err);
      // Si el error es por cliente no encontrado, usar un status 404
      const statusCode = err.message.includes('no fue encontrado') ? 404 : 500;
      res.status(statusCode).json({ 
        error: 'Error al registrar el pedido en la base de datos', details: err.message 
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  });

  return router;
}