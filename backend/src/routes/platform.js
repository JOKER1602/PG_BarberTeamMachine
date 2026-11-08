import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidTenantSlug, requirePlatformAdmin } from '../middleware/tenant.js';

// API de plataforma (operadores internos del SaaS): alta de barberías y cambio
// de estado. Es global (no lleva /t/:slug) y NO da acceso a los datos
// operativos de ninguna barbería: para eso hace falta una membresía.
const router = Router();
router.use(requireAuth, requirePlatformAdmin);

const TENANT_STATUSES = ['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED'];
const DEFAULT_CATEGORIES = [['Cortes', 'cortes', 10], ['Barba', 'barba', 20], ['Cejas', 'cejas', 30], ['Otros servicios', 'otros', 90]];
const personName = z.string().trim().min(2).max(80).regex(/^[\p{L}]+(?:[ '-][\p{L}]+)*$/u, 'Ingresa solo letras en el nombre');
const securePassword = z.string().min(8).max(120)
  .regex(/[a-z]/, 'Incluye una letra minúscula').regex(/[A-Z]/, 'Incluye una letra mayúscula').regex(/\d/, 'Incluye al menos un número');
const slugSchema = z.string().trim().toLowerCase().refine(isValidTenantSlug, 'El identificador solo admite minúsculas, números y guiones internos (máx. 80)');

const createTenantSchema = z.object({
  slug: slugSchema,
  displayName: z.string().trim().min(2).max(160),
  legalName: z.string().trim().min(2).max(160).optional(),
  status: z.enum(['TRIAL', 'ACTIVE']).default('TRIAL'),
  city: z.string().trim().min(2).max(120),
  country: z.string().trim().min(2).max(120).default('Bolivia'),
  phone: z.string().trim().min(6).max(30),
  address: z.string().trim().max(255).optional(),
  owner: z.object({
    email: z.string().email().transform((value) => value.toLowerCase().trim()),
    firstName: personName.optional(),
    lastName: personName.optional(),
    // Solo para cuentas nuevas: contraseña temporal que el dueño debe cambiar.
    temporaryPassword: securePassword.optional()
  })
});

const updateTenantSchema = z.object({
  status: z.enum(TENANT_STATUSES).optional(),
  displayName: z.string().trim().min(2).max(160).optional(),
  legalName: z.string().trim().min(2).max(160).optional()
}).refine((value) => Object.keys(value).length > 0, 'Indica al menos un cambio');

function invalid(response, parsed, message) {
  return response.status(400).json({ message: parsed.error.issues[0]?.message ?? message, errors: parsed.error.flatten() });
}

// Resumen para operar la plataforma: estado, dueños y volumen. No incluye
// datos de clientes ni detalle de citas.
router.get('/tenants', async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT t.slug, t.display_name AS displayName, t.legal_name AS legalName, t.status, t.created_at AS createdAt,
              ts.city,
              (SELECT GROUP_CONCAT(u.email ORDER BY u.email SEPARATOR ', ')
                 FROM tenant_memberships m JOIN users u ON u.id = m.user_id
                WHERE m.tenant_id = t.id AND m.role = 'OWNER' AND m.is_active = TRUE) AS owners,
              (SELECT COUNT(*) FROM barbers b WHERE b.tenant_id = t.id AND b.is_active = TRUE) AS activeBarbers,
              (SELECT COUNT(*) FROM appointments a WHERE a.tenant_id = t.id) AS appointments
       FROM tenants t LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
       ORDER BY t.created_at DESC`
    );
    return response.json({ tenants: rows.map((row) => ({ ...row, activeBarbers: Number(row.activeBarbers), appointments: Number(row.appointments) })) });
  } catch (error) { return next(error); }
});

router.post('/tenants', async (request, response, next) => {
  const parsed = createTenantSchema.safeParse(request.body);
  if (!parsed.success) return invalid(response, parsed, 'Datos de la barbería inválidos');
  const data = parsed.data;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute('SELECT id FROM tenants WHERE slug = ? FOR UPDATE', [data.slug]);
    if (existing.length) { await connection.rollback(); return response.status(409).json({ message: 'Ya existe una barbería con ese identificador' }); }

    // Dueño: si la persona ya tiene cuenta se reutiliza (las cuentas son
    // globales); si no, se crea con una contraseña temporal obligatoria.
    const [users] = await connection.execute('SELECT id, is_active AS isActive FROM users WHERE email = ? FOR UPDATE', [data.owner.email]);
    let ownerId = users[0]?.id;
    let ownerCreated = false;
    if (ownerId && !users[0].isActive) { await connection.rollback(); return response.status(409).json({ message: 'La cuenta del dueño está desactivada' }); }
    if (!ownerId) {
      if (!data.owner.temporaryPassword || !data.owner.firstName || !data.owner.lastName) {
        await connection.rollback();
        return response.status(400).json({ message: 'El dueño no tiene cuenta: indica nombre, apellido y una contraseña temporal' });
      }
      const [created] = await connection.execute(
        `INSERT INTO users (role_id, first_name, last_name, email, password_hash, must_change_password)
         SELECT id, ?, ?, ?, ?, TRUE FROM roles WHERE name = 'CLIENTE'`,
        [data.owner.firstName, data.owner.lastName, data.owner.email, await bcrypt.hash(data.owner.temporaryPassword, 12)]
      );
      ownerId = created.insertId;
      ownerCreated = true;
    }

    const tenantId = randomUUID();
    await connection.execute(
      'INSERT INTO tenants (id, slug, legal_name, display_name, status) VALUES (?, ?, ?, ?, ?)',
      [tenantId, data.slug, data.legalName ?? data.displayName, data.displayName, data.status]
    );
    // Configuración mínima: el dueño completa dirección, horario, QR y marca
    // desde su panel. El WhatsApp parte igual al teléfono.
    await connection.execute(
      `INSERT INTO tenant_settings (tenant_id, business_name, address, city, country, phone, whatsapp, hours_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, data.displayName, data.address ?? '', data.city, data.country, data.phone, data.phone, 'Horario por confirmar']
    );
    for (const [name, slug, sortOrder] of DEFAULT_CATEGORIES) {
      await connection.execute('INSERT INTO service_categories (tenant_id, name, slug, sort_order) VALUES (?, ?, ?, ?)', [tenantId, name, slug, sortOrder]);
    }
    await connection.execute("INSERT INTO tenant_memberships (tenant_id, user_id, role, is_active) VALUES (?, ?, 'OWNER', TRUE)", [tenantId, ownerId]);
    await connection.commit();
    return response.status(201).json({
      tenant: { slug: data.slug, displayName: data.displayName, status: data.status },
      owner: { email: data.owner.email, accountCreated: ownerCreated, mustChangePassword: ownerCreated },
      message: 'Barbería creada'
    });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ message: 'Ya existe una barbería con ese identificador' });
    return next(error);
  } finally { connection.release(); }
});

router.patch('/tenants/:slug', async (request, response, next) => {
  const slug = slugSchema.safeParse(request.params.slug);
  const parsed = updateTenantSchema.safeParse(request.body);
  if (!slug.success) return response.status(404).json({ message: 'Barbería no encontrada' });
  if (!parsed.success) return invalid(response, parsed, 'Cambio inválido');
  const fields = { status: 'status', displayName: 'display_name', legalName: 'legal_name' };
  const keys = Object.keys(parsed.data);
  try {
    const [result] = await pool.execute(
      `UPDATE tenants SET ${keys.map((key) => `${fields[key]} = ?`).join(', ')} WHERE slug = ?`,
      [...keys.map((key) => parsed.data[key]), slug.data]
    );
    if (!result.affectedRows) return response.status(404).json({ message: 'Barbería no encontrada' });
    const [[tenant]] = await pool.execute('SELECT slug, display_name AS displayName, legal_name AS legalName, status FROM tenants WHERE slug = ?', [slug.data]);
    return response.json({ tenant, message: 'Barbería actualizada' });
  } catch (error) { return next(error); }
});

export default router;
