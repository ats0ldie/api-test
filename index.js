import express from 'express';
import morgan from 'morgan';
import dotenv from 'dotenv';
import mysql from 'mysql2';
import cors from 'cors'; // <-- Importación agregada

dotenv.config();

const app = express();
const port = process.env.PORT || 7030;

// Configuración de CORS para permitir peticiones desde tu frontend
app.use(cors({
  origin: ['https://admin.drogueriajoskar.com', 'https://cliente.drogueriajoskar.com', 'https://testadmin.drogueriajoskar.com', 'https://testcliente.drogueriajoskar.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Middlewares base
app.use(express.json());
app.use(morgan('dev'));

// Configuración de pools
const poolConfig = { 
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 150,
  connectTimeout: 20000
};
const pool = mysql.createPool(poolConfig);

const poolWebConfig = {
  ...poolConfig,
  database: process.env.DB_WEB_NAME
};
const poolWeb = mysql.createPool(poolWebConfig);

// Ruta de health check
app.get('/health', async (req, res) => {
  try {
    const connection = await pool.promise().getConnection();
    await connection.ping();
    connection.release();
    res.status(200).json({ status: 'ok', message: 'API y base de datos operativas.' });
  } catch (err) {
    res.status(503).json({ status: 'error', message: 'DB error' });
  }
});

// Importación de rutas
import carritoRoute from './routes/carrito.js';
import empleadosRoute from './routes/empleados.js';
import rq_clienteRoute from './routes/rq_cliente.js';
import devolucionRoute from './routes/devolucion.js';
import cargarPagoRoute from './routes/cargar_pago.js';
import pedidoRoute from './routes/pedido.js';
import cuentaRoute from './routes/cuenta.js';

// Uso de rutas
app.use('/carrito', carritoRoute(pool));
app.use('/empleados', empleadosRoute());
app.use('/rq_cliente', rq_clienteRoute(pool));
app.use('/devolucion', devolucionRoute);
app.use('/cargar_pago', cargarPagoRoute);
app.use('/pedido', pedidoRoute(poolWeb));
app.use('/cuenta', cuentaRoute(pool));

// Manejador de errores global
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '💥 Error en el servidor' });
});

app.listen(port, () => {
  console.log(`✅ API lista en puerto: ${port}`);
});