import jwt from 'jsonwebtoken';

export function createAccessToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET no esta configurado');
  }

  return jwt.sign(
    { sub: String(user.id), role: user.role },
    secret,
    { expiresIn: '2h' }
  );
}

export function requireAuth(request, response, next) {
  const authorization = request.get('authorization');
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice(7)
    : null;

  if (!token || !process.env.JWT_SECRET) {
    return response.status(401).json({ message: 'Autenticacion requerida' });
  }

  try {
    request.auth = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return response.status(401).json({ message: 'Token invalido o expirado' });
  }
}

export function requireRole(...allowedRoles) {
  return (request, response, next) => {
    if (!allowedRoles.includes(request.auth?.role)) {
      return response.status(403).json({ message: 'Permisos insuficientes' });
    }

    return next();
  };
}
