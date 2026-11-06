// Contexto de barbería (tenant) en el frontend.
//
// Cada barbería vive en /t/:slug/... (por ejemplo /t/empyrean-studio/reservar).
// El slug de la URL es la única fuente: el cliente HTTP lo antepone a las
// llamadas de negocio y los enlaces internos se construyen con tenantHref.
// La API vuelve a validar el slug y la membresía en cada petición.

export const DEFAULT_TENANT_SLUG = import.meta.env?.VITE_DEFAULT_TENANT_SLUG ?? 'empyrean-studio';

// Igual que la validación del backend y la base: minúsculas, números y guiones internos.
const TENANT_PATH = /^\/t\/([a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?)(\/.*)?$/;

// Rutas globales: no pertenecen a una barbería (el enlace del correo de
// recuperación de contraseña apunta aquí).
export const GLOBAL_PATHS = Object.freeze(['/recuperar-contrasena']);

export function parseTenantPath(pathname) {
  const match = TENANT_PATH.exec(pathname ?? '');
  if (!match) return null;
  const path = (match[2] ?? '/').replace(/\/+$/, '') || '/';
  return { slug: match[1], path };
}

export function currentTenantSlug() {
  return parseTenantPath(globalThis.window?.location?.pathname)?.slug ?? DEFAULT_TENANT_SLUG;
}

// Convierte una ruta interna ('/reservar', '/?login=1', '/#ubicacion') en la
// ruta de la barbería actual. Las rutas globales no se tocan.
export function tenantHref(target, slug = currentTenantSlug()) {
  const value = String(target ?? '/');
  if (!value.startsWith('/') || value.startsWith('/t/')) return value;
  const [, path = '/', rest = ''] = /^([^?#]*)(.*)$/.exec(value);
  if (GLOBAL_PATHS.includes(path)) return value;
  return `/t/${slug}${path === '/' ? '' : path}${rest}`;
}

// Ruta antigua sin slug → misma ruta en la barbería por defecto, conservando
// consulta y ancla, para que los enlaces y marcadores previos sigan funcionando.
export function legacyRedirectTarget({ pathname, search = '', hash = '' }) {
  if (parseTenantPath(pathname) || GLOBAL_PATHS.includes(pathname)) return null;
  return tenantHref(`${pathname}${search}${hash}`, DEFAULT_TENANT_SLUG);
}

const TENANT_ADMIN_ROLES = ['OWNER', 'ADMIN'];

// Rol efectivo de la persona en ESTA barbería, con los nombres que ya usan las
// páginas: personal según su membresía; si no es personal, cliente solo si su
// cuenta es de cliente (la API exige ese rol para reservar).
export function accessRoleFor(user, slug = currentTenantSlug()) {
  if (!user) return null;
  const membership = (user.memberships ?? []).find((item) => item.tenantSlug === slug);
  if (membership && TENANT_ADMIN_ROLES.includes(membership.role)) return 'ADMINISTRADOR';
  if (membership?.role === 'BARBER') return 'BARBERO';
  const globalRole = user.globalRole ?? user.role;
  return globalRole === 'CLIENTE' ? 'CLIENTE' : 'SIN_ACCESO';
}

// Devuelve el usuario con `role` = rol efectivo en la barbería actual y el rol
// de la cuenta guardado en `globalRole`. Así las páginas siguen comparando
// role === 'ADMINISTRADOR' | 'BARBERO' | 'CLIENTE' sin conocer los tenants.
export function withTenantRole(user, slug = currentTenantSlug()) {
  if (!user) return user;
  const globalRole = user.globalRole ?? user.role;
  return { ...user, globalRole, role: accessRoleFor({ ...user, globalRole }, slug) };
}
