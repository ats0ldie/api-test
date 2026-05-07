# 🌐 Integración con Webflow - Droguería Joskar

## 📋 Resumen

Esta documentación explica cómo integrar la API de autenticación JWT con páginas embebidas en Webflow.

## 🔧 Configuración en Webflow

### 1. Agregar el código JavaScript

Copia el contenido del archivo `webflow-auth.js` y pégalo en el `<head>` de tu página en Webflow:

```html
<script>
// 🔐 Utilidades de autenticación para Webflow
const API_BASE_URL = 'https://jkserverom.drogueriajoskar.com:3000';

// [Todo el código del archivo webflow-auth.js aquí]
</script>
```

### 2. Inicializar autenticación

En tu página de Webflow, agrega este código para inicializar la autenticación:

```javascript
document.addEventListener("DOMContentLoaded", async () => {
    try {
        // Inicializar autenticación
        const authSuccess = await webflowAuth.initializeAuth();
        if (!authSuccess) {
            console.log('Autenticación fallida');
            return;
        }
        
        // Obtener datos del usuario
        const userData = webflowAuth.getUserData();
        console.log('Usuario autenticado:', userData);
        
        // Cargar datos protegidos
        await loadProtectedData();
    } catch (error) {
        console.error('Error:', error);
    }
});
```

## 🚀 Uso de las Funciones

### Autenticación

```javascript
// Autenticar usuario
const authData = await webflowAuth.authenticateUser('cliente@ejemplo.com');

// Verificar si está autenticado
if (webflowAuth.isAuthenticated()) {
    console.log('Usuario autenticado');
}

// Obtener datos del usuario
const userData = webflowAuth.getUserData();
```

### Cargar Inventario

```javascript
// Cargar inventario con tipo de precio específico
const inventario = await webflowAuth.loadInventarioWebflow(1); // tipo precio 1
const inventario2 = await webflowAuth.loadInventarioWebflow(2); // tipo precio 2

// Usar los datos
inventario.forEach(producto => {
    console.log(producto.ddetallada, producto.precio);
});
```

### Cargar Clientes

```javascript
// Cargar clientes con paginación
const clientes = await webflowAuth.loadClientesWebflow(1, 10); // página 1, 10 por página

// Usar los datos
clientes.forEach(cliente => {
    console.log(cliente.nombres, cliente.email);
});
```

### Peticiones Personalizadas

```javascript
// Hacer peticiones personalizadas usando headers
const response = await webflowAuth.authenticatedFetch(`${API_BASE_URL}/inventario/?tipoprecio=1`);

const data = await response.json();
```

## 🔗 Rutas Disponibles

### Autenticación
- `POST /rq_cliente/auth` - Autenticar y obtener token (con email en body)

### Datos Protegidos (requieren token en header Authorization)
- `GET /inventario/?tipoprecio=1` - Inventario
- `GET /clientes/?page=1&limit=10` - Clientes

### Datos Públicos (sin token)
- `GET /empleados` - Lista de empleados
- `POST /devolucion` - Enviar devolución
- `POST /xlsx` - Enviar pedido

## 📝 Ejemplo Completo para Webflow

```html
<!DOCTYPE html>
<html>
<head>
    <script>
        // 🔐 Utilidades de autenticación para Webflow
        const API_BASE_URL = 'https://jkserverom.drogueriajoskar.com:3000';
        
        // [Todo el código de webflow-auth.js aquí]
        
        // Inicializar cuando cargue la página
        document.addEventListener("DOMContentLoaded", async () => {
            try {
                const authSuccess = await webflowAuth.initializeAuth();
                if (authSuccess) {
                    await loadInventario();
                }
            } catch (error) {
                console.error('Error:', error);
            }
        });
        
        async function loadInventario() {
            try {
                const userData = webflowAuth.getUserData();
                const inventario = await webflowAuth.loadInventarioWebflow(userData.tipoprecio);
                
                // Mostrar inventario en tu página
                displayInventario(inventario);
            } catch (error) {
                console.error('Error cargando inventario:', error);
            }
        }
        
        function displayInventario(productos) {
            const container = document.getElementById('inventario-container');
            container.innerHTML = '';
            
            productos.forEach(producto => {
                const div = document.createElement('div');
                div.innerHTML = `
                    <h3>${producto.ddetallada}</h3>
                    <p>Precio: $${producto.precio}</p>
                    <p>Stock: ${producto.existencia}</p>
                `;
                container.appendChild(div);
            });
        }
    </script>
</head>
<body>
    <div id="inventario-container">
        <p>Cargando inventario...</p>
    </div>
</body>
</html>
```

## 🔒 Seguridad

### Ventajas de esta Implementación

1. **Token en Query Params**: Funciona con CORS y no requiere headers personalizados
2. **Autenticación Automática**: Se maneja automáticamente la expiración de tokens
3. **Compatible con Webflow**: No requiere archivos externos
4. **Manejo de Errores**: Respuestas claras para diferentes tipos de errores

### Consideraciones de Seguridad

- Los tokens se envían en query params (menos seguro que headers)
- Los tokens expiran en 24 horas
- Se limpian automáticamente al expirar

## 🐛 Solución de Problemas

### Error: "Token requerido"
- Verificar que el usuario se autenticó correctamente
- Verificar que el token no ha expirado

### Error: "Cliente no encontrado"
- Verificar que el email existe en la base de datos
- Verificar el formato del email

### Error: "Sesión expirada"
- El token JWT ha expirado
- Se debe re-autenticar automáticamente

### Error de CORS
- Verificar que la URL de la API esté correcta
- Verificar que el dominio esté permitido en el servidor

## 📞 Soporte

Si tienes problemas con la integración:

1. Verifica que el código JavaScript esté correctamente pegado
2. Revisa la consola del navegador para errores
3. Verifica que las rutas de la API estén funcionando
4. Confirma que el email del cliente existe en la base de datos 