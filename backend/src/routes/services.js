import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import { TENANT_ADMIN_ROLES, requireTenantMembership, tenantIdOf } from '../middleware/tenant.js';

// Aislado por tenant: toda consulta filtra por tenantIdOf(request), que viene
// de la URL (o de la barbería por defecto), nunca del navegador.
const router = Router();
const requireTenantAdmin = [requireAuth, requireTenantMembership(...TENANT_ADMIN_ROLES)];

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

async function categoryExists(tenantId, categoryId) {
  const [rows] = await pool.execute('SELECT id FROM service_categories WHERE id = ? AND tenant_id = ? AND is_active = TRUE', [categoryId, tenantId]);
  return rows.length > 0;
}

function duplicateNameResponse(error, response, label) {
  if (error.code !== '23505') return false;
  response.status(409).json({ message: `Ya existe ${label} con ese nombre en esta barbería` });
  return true;
}

router.get('/categories', async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, slug, description, sort_order AS "sortOrder" FROM service_categories WHERE tenant_id = ? AND is_active = TRUE ORDER BY sort_order, name',
      [tenantIdOf(request)]
    );
    return response.json({ categories: rows });
  } catch (error) { return next(error); }
});

router.post('/categories', ...requireTenantAdmin, async (request, response, next) => {
  const parsed = categorySchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: 'Datos de categoría inválidos' });
  try {
    const [result] = await pool.execute(
      'INSERT INTO service_categories (tenant_id, name, slug, description) VALUES (?, ?, ?, ?) RETURNING id',
      [tenantIdOf(request), parsed.data.name, parsed.data.slug, parsed.data.description ?? null]
    );
    return response.status(201).json({ id: result.insertId, message: 'Categoría creada' });
  } catch (error) {
    if (duplicateNameResponse(error, response, 'una categoría')) return undefined;
    return next(error);
  }
});

router.get('/', async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT s.id, s.category_id AS "categoryId", c.name AS "categoryName", c.slug AS "categorySlug",
       s.name, s.description, s.price, s.duration_minutes AS "durationMinutes"
       FROM services s JOIN service_categories c ON c.id = s.category_id AND c.tenant_id = s.tenant_id
       WHERE s.tenant_id = ? AND s.is_active = TRUE ORDER BY c.sort_order, s.name`,
      [tenantIdOf(request)]
    );
    return response.json({ services: rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/admin', ...requireTenantAdmin, async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT s.id, s.category_id AS "categoryId", c.name AS "categoryName", c.slug AS "categorySlug",
       s.name, s.description, s.price, s.duration_minutes AS "durationMinutes", s.is_active AS "isActive"
       FROM services s JOIN service_categories c ON c.id = s.category_id AND c.tenant_id = s.tenant_id
       WHERE s.tenant_id = ? ORDER BY c.sort_order, s.name`,
      [tenantIdOf(request)]
    );
    return response.json({ services: rows });
  } catch (error) { return next(error); }
});

router.post('/', ...requireTenantAdmin, async (request, response, next) => {
  const parsed = serviceSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ message: 'Datos del servicio invalidos', errors: parsed.error.flatten() });
  }

  try {
    const tenantId = tenantIdOf(request);
    const { name, description, price, durationMinutes, categoryId } = parsed.data;
    if (!await categoryExists(tenantId, categoryId)) return response.status(400).json({ message: 'La categoría seleccionada no está disponible' });
    const [result] = await pool.execute(
      `INSERT INTO services (tenant_id, category_id, name, description, price, duration_minutes) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [tenantId, categoryId, name, description ?? null, price, durationMinutes]
    );
    return response.status(201).json({ id: result.insertId, message: 'Servicio creado' });
  } catch (error) {
    if (duplicateNameResponse(error, response, 'un servicio')) return undefined;
    return next(error);
  }
});

router.patch('/:id', ...requireTenantAdmin, async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  const parsed = serviceSchema.extend({ isActive: z.boolean().optional() }).partial().safeParse(request.body);
  if (!id.success || !parsed.success || Object.keys(parsed.data).length === 0) return response.status(400).json({ message: 'Datos del servicio invalidos' });
  const fields = { categoryId: 'category_id', name: 'name', description: 'description', price: 'price', durationMinutes: 'duration_minutes', isActive: 'is_active' };
  const keys = Object.keys(parsed.data);
  try {
    const tenantId = tenantIdOf(request);
    if (parsed.data.categoryId && !await categoryExists(tenantId, parsed.data.categoryId)) return response.status(400).json({ message: 'La categoría seleccionada no está disponible' });
    const [result] = await pool.execute(
      `UPDATE services SET ${keys.map((key) => `${fields[key]} = ?`).join(', ')} WHERE id = ? AND tenant_id = ?`,
      [...keys.map((key) => parsed.data[key]), id.data, tenantId]
    );
    if (!result.affectedRows) return response.status(404).json({ message: 'Servicio no encontrado' });
    return response.json({ message: 'Servicio actualizado' });
  } catch (error) {
    if (duplicateNameResponse(error, response, 'un servicio')) return undefined;
    return next(error);
  }
});

router.delete('/:id', ...requireTenantAdmin, async (request, response, next) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id);
  if (!id.success) return response.status(400).json({ message: 'Servicio inválido' });
  const tenantId = tenantIdOf(request);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Primero se confirma que el servicio es de esta barbería: así no se toca
    // ninguna fila (ni siquiera sus asignaciones) de otro tenant.
    const [services] = await connection.execute('SELECT id FROM services WHERE id = ? AND tenant_id = ? FOR UPDATE', [id.data, tenantId]);
    if (!services.length) {
      await connection.rollback();
      return response.status(404).json({ message: 'Servicio no encontrado' });
    }
    const [appointments] = await connection.execute('SELECT id FROM appointments WHERE service_id = ? AND tenant_id = ? LIMIT 1', [id.data, tenantId]);
    if (appointments.length) {
      await connection.rollback();
      return response.status(409).json({ message: 'Este servicio tiene citas registradas. Para conservar el historial, desactívalo en lugar de eliminarlo.' });
    }
    await connection.execute('DELETE FROM barber_services WHERE service_id = ? AND tenant_id = ?', [id.data, tenantId]);
    await connection.execute('DELETE FROM services WHERE id = ? AND tenant_id = ?', [id.data, tenantId]);
    await connection.commit();
    return response.json({ message: 'Servicio eliminado' });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

export default router;
