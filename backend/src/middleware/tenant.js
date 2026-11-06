import pool from '../config/database.js';

// Contexto multiempresa (SaaS · Incremento 1).
//
// La barbería (tenant) se identifica SIEMPRE por el slug de la URL
// (/api/t/:tenantSlug/...) y se resuelve aquí contra la base. Nunca se acepta
// un tenant_id enviado por el navegador en el cuerpo, la query o cabeceras.
//
// Uso previsto en el Incremento 2:
//   const router = Router({ mergeParams: true });
//   app.use('/api/t/:tenantSlug/admin', resolveTenant, requireAuth,
//     requireTenantMembership(...TENANT_ADMIN_ROLES), router);
// y cada consulta filtra con tenantIdOf(request).
//
// Requiere las tablas de 013_saas_foundation.sql y las columnas de 014.

export const TENANT_ROLES = Object.freeze(['OWNER', 'ADMIN', 'BARBER', 'RECEPTIONIST']);
// No hay jerarquía implícita: cada ruta enumera los roles que acepta.
export const TENANT_ADMIN_ROLES = Object.freeze(['OWNER', 'ADMIN']);

// Igual que chk_tenants_slug en la base: minúsculas, números y guiones internos.
const TENANT_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

export function isValidTenantSlug(slug) {
  return typeof slug === 'string' && TENANT_SLUG.test(slug);
}

function tenantNotFound(response) {
  return response.status(404).json({ message: 'Barbería no encontrada' });
}

export function resolveTenant(request, response, next) {
  return loadTenant(request.params?.tenantSlug, request, response, next);
}

// Transición: las rutas antiguas /api/... (sin slug) atienden a una barbería
// fija configurada en el servidor (DEFAULT_TENANT_SLUG). El navegador no puede
// elegirla. Se retirará cuando el frontend use /t/:slug.
export function resolveDefaultTenant(request, response, next) {
  return loadTenant(process.env.DEFAULT_TENANT_SLUG ?? 'empyrean-studio', request, response, next);
}

async function loadTenant(slug, request, response, next) {
  if (!isValidTenantSlug(slug)) return tenantNotFound(response);

  try {
    const [rows] = await pool.execute(
      'SELECT id, slug, display_name AS displayName, status FROM tenants WHERE slug = ?',
      [slug]
    );
    const tenant = rows[0];
    // Una barbería dada de baja se comporta como inexistente.
    if (!tenant || tenant.status === 'CANCELLED') return tenantNotFound(response);
    if (tenant.status === 'SUSPENDED') {
      return response.status(403).json({ message: 'Esta barbería no está disponible temporalmente', code: 'TENANT_SUSPENDED' });
    }
    request.tenant = Object.freeze({ id: tenant.id, slug: tenant.slug, displayName: tenant.displayName, status: tenant.status });
    return next();
  } catch (error) {
    return next(error);
  }
}

// Exige que el usuario autenticado tenga una membresía activa en el tenant de
// la URL y, si se indican, uno de los roles permitidos. El rol de personal se
// decide por tenant: ser OWNER de una barbería no da acceso a otra.
export function requireTenantMembership(...allowedRoles) {
  const unknown = allowedRoles.filter((role) => !TENANT_ROLES.includes(role));
  if (unknown.length) throw new Error(`Roles de tenant desconocidos: ${unknown.join(', ')}`);

  return async (request, response, next) => {
    // Error de configuración de la ruta, no del usuario: se corta en vez de
    // continuar sin aislamiento.
    if (!request.tenant?.id) return next(new Error('requireTenantMembership requiere resolveTenant antes'));
    if (!request.auth?.sub) return response.status(401).json({ message: 'Autenticacion requerida' });

    try {
      const [rows] = await pool.execute(
        'SELECT role FROM tenant_memberships WHERE tenant_id = ? AND user_id = ? AND is_active = TRUE',
        [request.tenant.id, request.auth.sub]
      );
      const membership = rows[0];
      if (!membership) return response.status(403).json({ message: 'No tienes acceso a esta barbería' });
      if (allowedRoles.length && !allowedRoles.includes(membership.role)) {
        return response.status(403).json({ message: 'Permisos insuficientes' });
      }
      request.membership = Object.freeze({ tenantId: request.tenant.id, role: membership.role });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

// Para rutas que usan tanto clientes como personal (cancelar, reprogramar):
// carga la membresía si existe, sin exigirla. Un cliente queda con null.
export async function loadOptionalTenantMembership(request, _response, next) {
  if (!request.tenant?.id) return next(new Error('loadOptionalTenantMembership requiere resolveTenant antes'));
  if (!request.auth?.sub) return next();
  try {
    const [rows] = await pool.execute(
      'SELECT role FROM tenant_memberships WHERE tenant_id = ? AND user_id = ? AND is_active = TRUE',
      [request.tenant.id, request.auth.sub]
    );
    request.membership = rows[0] ? Object.freeze({ tenantId: request.tenant.id, role: rows[0].role }) : null;
    return next();
  } catch (error) {
    return next(error);
  }
}

// Administra la barbería de la URL (no la de otra): OWNER o ADMIN activos.
export function isTenantAdmin(request) {
  return Boolean(request.membership && request.membership.tenantId === request.tenant?.id
    && TENANT_ADMIN_ROLES.includes(request.membership.role));
}

// Operador interno de la plataforma (crear, suspender o reactivar barberías).
// No concede acceso a los datos operativos de ningún tenant.
export async function requirePlatformAdmin(request, response, next) {
  if (!request.auth?.sub) return response.status(401).json({ message: 'Autenticacion requerida' });
  try {
    const [rows] = await pool.execute('SELECT user_id FROM platform_administrators WHERE user_id = ?', [request.auth.sub]);
    if (!rows.length) return response.status(403).json({ message: 'Permisos insuficientes' });
    request.platformAdmin = true;
    return next();
  } catch (error) {
    return next(error);
  }
}

// Única fuente del tenant_id para las consultas: falla si la ruta no pasó por
// resolveTenant, en lugar de ejecutar una consulta sin filtro.
export function tenantIdOf(request) {
  const tenantId = request.tenant?.id;
  if (!tenantId) throw new Error('La ruta no resolvió el tenant antes de consultar datos aislados');
  return tenantId;
}
