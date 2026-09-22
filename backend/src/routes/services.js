import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const serviceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  price: z.number().nonnegative(),
  durationMinutes: z.number().int().positive().max(480),
  categoryId: z.coerce.number().int().positive()
});

const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,80}$/),
  description: z.string().trim().max(255).nullable().optional()
});

async function categoryExists(categoryId) {
  const [rows] = await pool.execute('SELECT id FROM service_categories WHERE id = ? AND is_active = TRUE', [categoryId]);
  return rows.length > 0;
}

router.get('/categories', async (_request, response, next) => {
  try {
    const [rows] = await pool.execute('SELECT id, name, slug, description, sort_order AS sortOrder FROM service_categories WHERE is_active = TRUE ORDER BY sort_order, name');
    return response.json({ categories: rows });
  } catch (error) { return next(error); }
});

router.post('/categories', requireAuth, requireRole('ADMINISTRADOR'), async (request, response, next) => {
  const parsed = categorySchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: 'Datos de categoría inválidos' });
  try {
    const [result] = await pool.execute('INSERT INTO service_categories (name, slug, description) VALUES (?, ?, ?)', [parsed.data.name, parsed.data.slug, parsed.data.description ?? null]);
    return response.status(201).json({ id: result.insertId, message: 'Categoría creada' });
  } catch (error) { return next(error); }
});

router.get('/', async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT s.id, s.category_id AS categoryId, c.name AS categoryName, c.slug AS categorySlug,
       s.name, s.description, s.price, s.duration_minutes AS durationMinutes
       FROM services s JOIN service_categories c ON c.id = s.category_id
       WHERE s.is_active = TRUE ORDER BY c.sort_order, s.name`
    );
    return response.json({ services: rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/admin', requireAuth, requireRole('ADMINISTRADOR'), async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT s.id, s.category_id AS categoryId, c.name AS categoryName, c.slug AS categorySlug,
       s.name, s.description, s.price, s.duration_minutes AS durationMinutes, s.is_active AS isActive
       FROM services s JOIN service_categories c ON c.id = s.category_id ORDER BY c.sort_order, s.name`
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
    const { name, description, price, durationMinutes, categoryId } = parsed.data;
    if (!await categoryExists(categoryId)) return response.status(400).json({ message: 'La categoría seleccionada no está disponible' });
    const [result] = await pool.execute(
      `INSERT INTO services (category_id, name, description, price, duration_minutes) VALUES (?, ?, ?, ?, ?)`,
      [categoryId, name, description ?? null, price, durationMinutes]
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
  if (parsed.data.categoryId && !await categoryExists(parsed.data.categoryId)) return response.status(400).json({ message: 'La categoría seleccionada no está disponible' });
  const fields = { categoryId: 'category_id', name: 'name', description: 'description', price: 'price', durationMinutes: 'duration_minutes', isActive: 'is_active' };
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
