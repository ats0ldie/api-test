import jwt from 'jsonwebtoken';

export default function (req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ 
      error: 'Token de autorización requerido',
      message: 'Debe incluir el header Authorization: Bearer <token>' 
    });
  }

  const token = authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ 
      error: 'Formato de token inválido',
      message: 'El token debe estar en formato: Bearer <token>' 
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('❌ Error verificando token:', err.message);
    
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expirado',
        message: 'El token ha expirado, por favor inicie sesión nuevamente' 
      });
    }
    
    if (err.name === 'JsonWebTokenError') {
      return res.status(403).json({ 
        error: 'Token inválido',
        message: 'El token proporcionado no es válido' 
      });
    }
    
    return res.status(403).json({ 
      error: 'Error de autenticación',
      message: 'No se pudo verificar el token' 
    });
  }
}