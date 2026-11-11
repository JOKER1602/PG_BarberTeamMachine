import jwt from 'jsonwebtoken';
import pool from '../config/database.js';

const AUTH_COOKIE = 'empyrean_session';
const SESSION_DURATION_MS = 2 * 60 * 60 * 1000;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET no esta configurado');
  return secret;
}

// El token solo identifica a la persona. Los permisos (rol global hoy, rol por
// barbería en SaaS) se leen de la base en cada petición, así un cambio de rol
// o una membresía revocada no siguen vigentes dentro de una cookie firmada.
export function createAccessToken(user) {
  return jwt.sign(
    { sub: String(user.id) },
    getJwtSecret(),
    { expiresIn: '2h' }
  );
}

function cookieOptions() {
  // En producción la aplicación debe publicarse mediante HTTPS. En desarrollo
  // localhost usa HTTP para que la cookie pueda probarse sin certificados.
  const secure = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION_MS
  };
}

export function setAuthCookie(response, user) {
  response.cookie(AUTH_COOKIE, createAccessToken(user), cookieOptions());
}

export function clearAuthCookie(response) {
  const { maxAge, ...options } = cookieOptions();
  response.clearCookie(AUTH_COOKIE, options);
}

function getCookieValue(request, name) {
  const cookies = request.get('cookie');
  if (!cookies) return null;
  const encoded = cookies.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!encoded) return null;
  try { return decodeURIComponent(encoded); } catch { return null; }
}

export function requireAuth(request, response, next) {
  // La cookie HttpOnly es la única fuente de autenticación. No se aceptan
  // tokens Bearer para impedir que una copia antigua de localStorage continúe
  // siendo una credencial válida después de la migración.
  const token = getCookieValue(request, AUTH_COOKIE);

  if (!token || !process.env.JWT_SECRET) {
    return response.status(401).json({ message: 'Autenticacion requerida' });
  }

  try {
    request.auth = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return response.status(401).json({ message: 'Token invalido o expirado' });
  }

  // El token dura 2 horas. Se confirma en cada petición que la cuenta siga
  // activa y se usa el rol vigente en la base, para que desactivar un usuario
  // o cambiar su rol tenga efecto inmediato y no al vencer la cookie.
  return pool.execute(
    'SELECT u.is_active AS "isActive", r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?',
    [request.auth.sub]
  ).then(([rows]) => {
    if (!rows[0]?.isActive) {
      clearAuthCookie(response);
      return response.status(401).json({ message: 'Usuario no disponible' });
    }
    request.auth.role = rows[0].role;
    return next();
  }).catch(next);
}

export function requireRole(...allowedRoles) {
  return (request, response, next) => {
    if (!allowedRoles.includes(request.auth?.role)) {
      return response.status(403).json({ message: 'Permisos insuficientes' });
    }

    return next();
  };
}
