import express from 'express';
import cors from 'cors';
import https from 'https';
import http from 'node:http';
import fs from 'fs';
import morgan from 'morgan';
import dotenv from 'dotenv';
import mysql from 'mysql2';
//import rateLimit from 'express-rate-limit';
//import authMiddleware from './middlewares/authMiddlewares.js';

dotenv.config();

const app = express();
const port = process.env.PORT;

// 🌐 Middlewares
app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(express.json());
app.use(morgan('dev'));

// 🔌 Pool de conexiones MySQL
// Pool principal para 'datasis'
const poolConfig = { 
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 15,
  connectTimeout: 20000
};
const pool = mysql.createPool(poolConfig);

// Pool secundario para 'datasisweb' (solo para pedidos)
const poolWebConfig = {
  ...poolConfig,
  database: process.env.DB_WEB_NAME
};
const poolWeb = mysql.createPool(poolWebConfig);

// Log de diagnóstico para la configuración del pool web
const { password: webPassword, ...webConfigForLogging } = poolWebConfig;
console.log('[INFO] Configuración del pool para datasisweb:', webConfigForLogging);


// Ruta de Health Check para verificar la conexión a la BD
app.get('/health', async (req, res) => {
  // Log de la configuración para depuración (sin la contraseña)
  const { password, ...configForLogging } = poolConfig;
  console.log('[INFO] Health check: Intentando conectar con la configuración:', configForLogging);

  try {
    const connection = await pool.promise().getConnection();
    await connection.ping();
    connection.release();
    console.log('[SUCCESS] Health check exitoso.');
    res.status(200).json({ status: 'ok', message: 'API y base de datos operativas.' });
  } catch (err) {
    console.error('❌ Health check fallido:', err);
    res.status(503).json({ 
      status: 'error', 
      message: 'No se pudo establecer conexión con la base de datos.',
      details: {
        code: err.code,
        message: err.message
      }
    });
  }
});

// 🧭 Rutas de la API
import carritoRoute from './routes/carrito.js';
import empleadosRoute from './routes/empleados.js';
import rq_clienteRoute from './routes/rq_cliente.js';
import devolucionRoute from './routes/devolucion.js';
import cargarPagoRoute from './routes/cargar_pago.js'; // Importar la nueva ruta
import pedidoRoute from './routes/pedido.js';
import cuentaRoute from './routes/cuenta.js';

app.use('/carrito', carritoRoute(pool));
app.use('/empleados', empleadosRoute());
app.use('/rq_cliente', rq_clienteRoute(pool));
app.use('/devolucion', devolucionRoute);
app.use('/cargar_pago', cargarPagoRoute); // Usar la nueva ruta
app.use('/pedido', pedidoRoute(poolWeb)); // Usar el pool de 'datasisweb' para pedidos
app.use('/cuenta', cuentaRoute(pool));

// 🛑 Manejo global de errores
app.use((err, req, res, next) => {
  console.error('❌ Error interno del servidor:', err);
  res.status(500).json({ error: '💥 Ocurrió un error en el servidor, intenta más tarde.' });
});

// 🔐 Configuración SSL
// const httpsOptions = {
//   key: fs.readFileSync(process.env.SSL_KEY_PATH),
//   cert: fs.readFileSync(process.env.SSL_CERT_PATH)
// };

// 🚀 Iniciar servidor HTTPS
http.createServer(app).listen(port, () => {
  console.log(`✅ API segura corriendo en: https://jkserverom.drogueriajoskar.com:${port} 🔒`);
});
