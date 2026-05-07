# 🔐 Implementación de JWT - Droguería Joskar

## 📋 Resumen de Cambios

Se ha implementado un sistema completo de autenticación JWT para proteger las rutas de la API y mejorar la seguridad del sistema.

## 🗂️ Archivos Modificados

### Backend (Node.js/Express)

1. **`middleware/auth.js`** - Middleware de autenticación mejorado
   - Validación robusta de tokens JWT
   - Manejo de errores específicos (token expirado, inválido, etc.)
   - Mensajes de error descriptivos

2. **`routes/rq_cliente.js`** - Rutas de autenticación
   - Nueva ruta `/auth` para generar tokens JWT
   - Ruta `/by-email/:email` para obtener datos del cliente
   - Validación de formato de email

3. **`utils/jwt.js`** - Eliminado (duplicaba funcionalidad)
   - Se usa directamente `jsonwebtoken` en las rutas

### Frontend (HTML/JavaScript)

1. **`html/auth.js`** - Nuevo archivo de utilidades de autenticación
   - Función `authenticateUser()` para obtener token JWT
   - Función `authenticatedFetch()` para peticiones autenticadas
   - Función `initializeAuth()` para inicializar autenticación
   - Manejo de tokens expirados

2. **`html/inventario.html`** - Actualizado para usar JWT
3. **`html/carrito_compras.html`** - Actualizado para usar JWT
4. **`html/clientes.html`** - Actualizado para usar JWT

## 🔧 Cómo Funciona

### 1. Flujo de Autenticación

```javascript
// 1. Usuario ingresa email
const email = "cliente@ejemplo.com";

// 2. Se autentica y obtiene token
const authData = await authUtils.authenticateUser(email);
// Resultado: { token: "jwt_token_here", cliente: {...} }

// 3. Token se guarda en localStorage
localStorage.setItem('jwt_token', authData.token);

// 4. Peticiones posteriores incluyen el token
const response = await authUtils.authenticatedFetch('/inventario');
```

### 2. Protección de Rutas

Las rutas protegidas en el backend:
- `/inventario` - Requiere token JWT válido
- `/clientes` - Requiere token JWT válido

### 3. Manejo de Errores

- **Token expirado**: Se redirige al login
- **Token inválido**: Se muestra error y se solicita re-autenticación
- **Sin token**: Se solicita email para autenticación

## 🚀 Uso en el Frontend

### Inicialización Automática

```javascript
document.addEventListener("DOMContentLoaded", async () => {
    // Inicializar autenticación automáticamente
    const authSuccess = await authUtils.initializeAuth();
    if (!authSuccess) {
        // Redirigir al login o mostrar error
        return;
    }
    
    // Continuar con la carga de datos
    await loadProtectedData();
});
```

### Peticiones Autenticadas

```javascript
// En lugar de fetch normal
const response = await fetch('/inventario');

// Usar authenticatedFetch
const response = await authUtils.authenticatedFetch('/inventario');
```

## 🔒 Seguridad

### Ventajas de la Implementación

1. **Tokens JWT**: Autenticación sin estado, más escalable
2. **Expiración**: Tokens expiran automáticamente (24h por defecto)
3. **Validación**: Verificación de formato y validez de tokens
4. **Manejo de errores**: Respuestas específicas para diferentes tipos de errores
5. **Logout automático**: Limpieza de datos al cerrar sesión

### Configuración

```javascript
// En .env
JWT_SECRET=tu_secreto_super_seguro_aqui
JWT_EXPIRATION=24h
```

## 🧪 Testing

### Probar Autenticación

1. Abrir cualquier página protegida (inventario, clientes, carrito)
2. Ingresar email válido de cliente
3. Verificar que se genera token JWT
4. Verificar que las peticiones incluyen Authorization header

### Probar Protección

1. Intentar acceder a `/inventario` sin token → Debe devolver 401
2. Usar token expirado → Debe devolver 401 con mensaje específico
3. Usar token inválido → Debe devolver 403

## 📝 Notas Importantes

1. **Eliminación de duplicados**: Se eliminó `middlewares/authMiddleware.js` y `utils/jwt.js` para evitar duplicación
2. **Compatibilidad**: Las rutas existentes siguen funcionando, solo se agregó protección
3. **Fallback**: Si no hay email guardado, se solicita al usuario
4. **Persistencia**: El token se guarda en localStorage para persistir entre sesiones

## 🔄 Próximos Pasos

1. Implementar refresh tokens para mayor seguridad
2. Agregar roles y permisos específicos
3. Implementar rate limiting por usuario
4. Agregar logging de autenticación
5. Implementar logout en todas las páginas

## 🐛 Solución de Problemas

### Error: "Token de autorización requerido"
- Verificar que el token se está enviando en el header Authorization
- Verificar que el token no ha expirado

### Error: "Cliente no encontrado"
- Verificar que el email existe en la base de datos
- Verificar el formato del email

### Error: "Sesión expirada"
- El token JWT ha expirado
- Se debe re-autenticar al usuario 