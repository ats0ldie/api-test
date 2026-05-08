// 🔐 Utilidades de autenticación para el frontend

const API_BASE_URL = 'https://testapi.drogueriajoskar.com:7030';

// Función para autenticar al usuario y obtener token
async function authenticateUser(email) {
  try {
    const response = await fetch(`${API_BASE_URL}/rq_cliente/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Error de autenticación');
    }

    const data = await response.json();
    
    // Guardar token en localStorage
    localStorage.setItem('jwt_token', data.token);
    localStorage.setItem('userEmail', email);
    localStorage.setItem('userData', JSON.stringify(data.cliente));
    
    return data;
  } catch (error) {
    console.error('❌ Error de autenticación:', error);
    throw error;
  }
}

// Función para obtener el token del localStorage
function getToken() {
  return localStorage.getItem('jwt_token');
}

// Función para verificar si el usuario está autenticado
function isAuthenticated() {
  const token = getToken();
  if (!token) return false;
  
  try {
    // Verificar si el token no ha expirado (decodificación básica)
    const payload = JSON.parse(atob(token.split('.')[1]));
    const currentTime = Date.now() / 1000;
    return payload.exp > currentTime;
  } catch (error) {
    console.error('❌ Error verificando token:', error);
    return false;
  }
}

// Función para hacer peticiones autenticadas
async function authenticatedFetch(url, options = {}) {
  const token = getToken();
  
  if (!token) {
    throw new Error('No hay token de autenticación');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...options.headers
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (response.status === 401 || response.status === 403) {
    // Token expirado o inválido
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('userData');
    throw new Error('Sesión expirada. Por favor, inicie sesión nuevamente.');
  }

  return response;
}

// Función para cerrar sesión
function logout() {
  localStorage.removeItem('jwt_token');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('userData');
  localStorage.removeItem('cart');
}

// Función para obtener datos del usuario
function getUserData() {
  const userData = localStorage.getItem('userData');
  return userData ? JSON.parse(userData) : null;
}

// Función para inicializar la autenticación
async function initializeAuth() {
  const email = localStorage.getItem('userEmail');
  
  if (!email) {
    const userEmail = prompt("Por favor ingresa tu correo electrónico:");
    if (userEmail && userEmail.includes('@')) {
      try {
        await authenticateUser(userEmail);
        return true;
      } catch (error) {
        alert(`Error de autenticación: ${error.message}`);
        return false;
      }
    } else {
      alert("Por favor ingresa un correo electrónico válido");
      return false;
    }
  }

  // Verificar si el token existe y es válido
  if (!isAuthenticated()) {
    try {
      await authenticateUser(email);
      return true;
    } catch (error) {
      alert(`Error de autenticación: ${error.message}`);
      logout();
      return false;
    }
  }

  return true;
}

// Exportar funciones para uso global
window.authUtils = {
  authenticateUser,
  getToken,
  isAuthenticated,
  authenticatedFetch,
  logout,
  getUserData,
  initializeAuth
}; 