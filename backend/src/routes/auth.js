import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { createAccessToken, requireAuth } from '../middleware/auth.js';
import { isEmailConfigured, sendPasswordResetEmail } from '../services/email.js';

const router = Router();
const credentialsSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase().trim()),
  password: z.string().min(8)
});
const registrationSchema = credentialsSchema.extend({
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(30).optional()
});

function publicUser(user) {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    phone: user.phone,
    role: user.role
  };
}

router.post('/register', async (request, response, next) => {
  const parsed = registrationSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ message: 'Datos de registro invalidos', errors: parsed.error.flatten() });
  }

  try {
    const { firstName, lastName, email, password, phone } = parsed.data;
    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return response.status(409).json({ message: 'El correo ya esta registrado' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      `INSERT INTO users (role_id, first_name, last_name, email, phone, password_hash)
       SELECT id, ?, ?, ?, ?, ? FROM roles WHERE name = 'CLIENTE'`,
      [firstName, lastName, email, phone ?? null, passwordHash]
    );
    const [rows] = await pool.execute(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [result.insertId]
    );
    const user = rows[0];

    return response.status(201).json({ user: publicUser(user), token: createAccessToken(user) });
  } catch (error) {
    return next(error);
  }
});

router.post('/login', async (request, response, next) => {
  const parsed = credentialsSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ message: 'Credenciales invalidas' });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.password_hash, u.is_active,
              r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?`,
      [parsed.data.email]
    );
    const user = rows[0];
    const passwordMatches = user && await bcrypt.compare(parsed.data.password, user.password_hash);

    if (!passwordMatches || !user.is_active) {
      return response.status(401).json({ message: 'Correo o contrasena incorrectos' });
    }

    return response.json({ user: publicUser(user), token: createAccessToken(user) });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', requireAuth, async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.is_active, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [request.auth.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return response.status(401).json({ message: 'Usuario no disponible' });
    }

    return response.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/me', requireAuth, async (request, response, next) => {
  const parsed = z.object({
    firstName: z.string().trim().min(2).max(80),
    lastName: z.string().trim().min(2).max(80),
    phone: z.string().trim().max(30).nullable().optional()
  }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: 'Datos de perfil invalidos' });
  try {
    await pool.execute(
      'UPDATE users SET first_name = ?, last_name = ?, phone = ? WHERE id = ?',
      [parsed.data.firstName, parsed.data.lastName, parsed.data.phone ?? null, request.auth.sub]
    );
    const [rows] = await pool.execute(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [request.auth.sub]
    );
    return response.json({ user: publicUser(rows[0]) });
  } catch (error) { return next(error); }
});

router.patch('/me/password', requireAuth, async (request, response, next) => {
  const parsed = z.object({ currentPassword: z.string().min(8), password: z.string().min(8) }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: 'Datos de contrasena invalidos' });
  try {
    const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [request.auth.sub]);
    if (!rows[0] || !(await bcrypt.compare(parsed.data.currentPassword, rows[0].password_hash))) {
      return response.status(400).json({ message: 'La contrasena actual no es correcta' });
    }
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(parsed.data.password, 12), request.auth.sub]);
    return response.json({ message: 'Contrasena actualizada correctamente' });
  } catch (error) { return next(error); }
});

router.post('/forgot-password', async (request, response, next) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ message: 'Correo invalido' });
  }

  try {
    if (!isEmailConfigured()) {
      return response.status(503).json({ message: 'El servicio de correo aún no está configurado. Contacta a la barbería.' });
    }

    const [rows] = await pool.execute('SELECT id, first_name AS firstName, email FROM users WHERE email = ? AND is_active = TRUE', [parsed.data.email.toLowerCase()]);
    if (rows.length > 0) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const frontendUrl = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
      const resetUrl = `${frontendUrl}/recuperar-contrasena?token=${rawToken}`;

      await pool.execute('UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL', [rows[0].id]);
      await pool.execute('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE))', [rows[0].id, tokenHash]);
      try {
        await sendPasswordResetEmail({ to: rows[0].email, firstName: rows[0].firstName, resetUrl });
      } catch (emailError) {
        await pool.execute('DELETE FROM password_reset_tokens WHERE token_hash = ?', [tokenHash]);
        return response.status(502).json({ message: 'No se pudo enviar el correo de recuperación. Intenta nuevamente más tarde.' });
      }
    }

    return response.json({ message: 'Si el correo existe, recibiras instrucciones para recuperar tu contrasena' });
  } catch (error) {
    return next(error);
  }
});

router.post('/reset-password', async (request, response, next) => {
  const parsed = z.object({
    token: z.string().length(64),
    password: z.string().min(8)
  }).safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ message: 'Datos de recuperacion invalidos' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(parsed.data.token).digest('hex');
    const [rows] = await pool.execute(
      `SELECT user_id FROM password_reset_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()`,
      [tokenHash]
    );
    if (rows.length === 0) {
      return response.status(400).json({ message: 'Token invalido o expirado' });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, rows[0].user_id]);
    await pool.execute('UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE token_hash = ?', [tokenHash]);
    return response.json({ message: 'Contrasena actualizada correctamente' });
  } catch (error) {
    return next(error);
  }
});

export default router;
