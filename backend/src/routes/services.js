import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const serviceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  price: z.number().nonnegative(),
  durationMinutes: z.number().int().positive().max(480)
});

router.get('/', async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, description, price, duration_minutes AS durationMinutes
       FROM services WHERE is_active = TRUE ORDER BY name`
    );
    return response.json({ services: rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/admin', requireAuth, requireRole('ADMINISTRADOR'), async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, description, price, duration_minutes AS durationMinutes, is_active AS isActive
       FROM services ORDER BY name`
    );
    return response.json({ services: rows });
  } catch (error) { return next(error); }
});

router.post('/', requireAuth, requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const parsed = serviceSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ message: 'Datos del servicio invalidos', errors: parsed.error.flatten() });
  }

  try {
    const { name, description, price, durationMinutes } = parsed.data;
    const [result] = await pool.execute(
      `INSERT INTO services (name, description, price, duration_minutes) VALUES (?, ?, ?, ?)`,
      [name, description ?? null, price, durationMinutes]
    );
    return response.status(201).json({ id: result.insertId, message: 'Servicio creado' });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', requireAuth, requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  const parsed = serviceSchema.extend({ isActive: z.boolean().optional() }).partial().safeParse(request.body);
  if (!id.success || !parsed.success || Object.keys(parsed.data).length === 0) return response.status(400).json({ message: 'Datos del servicio invalidos' });
  const fields = { name: 'name', description: 'description', price: 'price', durationMinutes: 'duration_minutes', isActive: 'is_active' };
  const keys = Object.keys(parsed.data);
  try {
    const [result] = await pool.execute(
      `UPDATE services SET ${keys.map((key) => `${fields[key]} = ?`).join(', ')} WHERE id = ?`,
      [...keys.map((key) => parsed.data[key]), id.data]
    );
    if (!result.affectedRows) return response.status(404).json({ message: 'Servicio no encontrado' });
    return response.json({ message: 'Servicio actualizado' });
  } catch (error) { return next(error); }
});

export default router;
