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
// /platform es el panel de los operadores del SaaS (no es de ninguna barbería).
const GLOBAL_PATHS = Object.freeze(['/recuperar-contrasena', '/platform']);

export function parseTenantPath(pathname) {
  const match = TENANT_PATH.exec(pathname ?? '');
  if (!match) return null;
  const path = (match[2] ?? '/').replace(/\/+$/, '') || '/';
  return { slug: match[1], path };
}

export function currentTenantSlug() {
  const location = globalThis.window?.location;
  const fromPath = parseTenantPath(location?.pathname)?.slug;
  if (fromPath) return fromPath;
  // En una ruta global (recuperar contraseña) la barbería de origen viaja como
  // ?t=slug para conservar su marca y volver a ella.
  if (GLOBAL_PATHS.includes(location?.pathname)) {
    const fromQuery = new URLSearchParams(location?.search ?? '').get('t');
    if (fromQuery && parseTenantPath(`/t/${fromQuery}`)) return fromQuery;
  }
  return DEFAULT_TENANT_SLUG;
}

// Enlace a la recuperación de contraseña que recuerda la barbería de origen.
export function passwordRecoveryHref() {
  return `/recuperar-contrasena?t=${currentTenantSlug()}`;
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

// --- Marca de la barbería ---------------------------------------------------
// Se carga una vez por página (App.jsx, con GET /api/t/:slug) antes de mostrar
// la barbería, así todas las páginas leen nombre, ciudad, logo y portada sin
// volver a pedirlos. Nunca se muestra la marca de otra barbería por defecto.
let currentBrand = null;

export function setTenantBrand({ tenant, brand } = {}) {
  currentBrand = {
    slug: tenant?.slug ?? currentTenantSlug(),
    name: brand?.name || tenant?.displayName || 'Barbería',
    city: brand?.city || '',
    logoUrl: brand?.logoUrl || null,
    coverUrl: brand?.coverUrl || null,
    theme: brand?.theme ?? null
  };
  if (globalThis.document) {
    globalThis.document.title = currentBrand.name;
    applyBrandTheme(currentBrand.theme, globalThis.document.documentElement);
    applyBrandIcon(currentBrand, globalThis.document);
  }
  return currentBrand;
}

// Icono de la pestaña: el logo de la barbería; sin logo, un monograma con sus
// iniciales en sus colores (SVG en data:, permitido por la CSP en img-src).
export function brandIconHref(brand) {
  if (brand?.logoUrl) return brand.logoUrl;
  const theme = brand?.theme ?? {};
  const background = HEX_COLOR.test(theme.text ?? '') ? theme.text : DEFAULT_THEME.text;
  const color = HEX_COLOR.test(theme.background ?? '') ? theme.background : DEFAULT_THEME.background;
  const initials = brandInitials(brand?.name ?? 'Barbería').replace(/[^\p{L}\p{N}]/gu, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${background}"/><text x="32" y="42" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="${color}">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function applyBrandIcon(brand, doc = globalThis.document) {
  if (!doc?.head) return null;
  let link = doc.head.querySelector('link[rel="icon"]');
  if (!link) {
    link = doc.createElement('link');
    link.setAttribute('rel', 'icon');
    doc.head.appendChild(link);
  }
  const href = brandIconHref(brand);
  link.setAttribute('href', href);
  if (brand?.logoUrl) link.removeAttribute('type');
  else link.setAttribute('type', 'image/svg+xml');
  return link;
}

// Colores por defecto del diseño (Empyrean Studio). Una barbería con colores
// propios reemplaza los que tenga definidos; el resto usa estos.
export const DEFAULT_THEME = { accent: '#3569EE', background: '#171717', text: '#F8F3EC' };
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Luminosidad HSL de un #RRGGBB mayor al 50 %: color claro.
export function isLightColor(hex) {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 > 0.5;
}

// Activa la capa de colores que genera brand-theme.js (data-brand-theme) solo
// si la barbería tiene al menos un color propio válido; si no, la página queda
// exactamente con el diseño original.
export function applyBrandTheme(theme, root) {
  if (!root) return false;
  const colors = Object.fromEntries(Object.keys(DEFAULT_THEME).map((key) => [key, HEX_COLOR.test(theme?.[key] ?? '') ? theme[key] : null]));
  const hasTheme = Object.values(colors).some(Boolean);
  for (const key of Object.keys(DEFAULT_THEME)) {
    if (hasTheme) root.style.setProperty(`--theme-${key}`, colors[key] ?? DEFAULT_THEME[key]);
    else root.style.removeProperty(`--theme-${key}`);
  }
  // Fondo claro → tema claro: brand-theme.js invierte los desplazamientos de
  // paneles y textos secundarios (ver DIRECTION allí).
  // Las superficies (fondos de tarjetas) siempre van hacia el blanco.
  if (hasTheme) {
    root.style.setProperty('--theme-dir', isLightColor(colors.background ?? DEFAULT_THEME.background) ? '-1' : '1');
    root.style.setProperty('--theme-surface-dir', '1');
  } else {
    root.style.removeProperty('--theme-dir');
    root.style.removeProperty('--theme-surface-dir');
  }
  if (hasTheme) root.setAttribute('data-brand-theme', '');
  else root.removeAttribute('data-brand-theme');
  // Tono claro: activa el encabezado negro de styles.css.
  if (hasTheme && isLightColor(colors.background ?? DEFAULT_THEME.background)) root.setAttribute('data-brand-tone', 'light');
  else root.removeAttribute('data-brand-tone');
  return hasTheme;
}

export function tenantBrand() {
  return currentBrand ?? { slug: currentTenantSlug(), name: 'Barbería', city: '', logoUrl: null, coverUrl: null };
}

// "Empyrean Studio" → { first: 'EMPYREAN', rest: 'STUDIO' } para el logotipo de
// dos tonos; un nombre de una sola palabra queda sin segunda parte.
export function brandWords(name = tenantBrand().name) {
  const [first = '', ...rest] = String(name).trim().toLocaleUpperCase('es').split(/\s+/);
  return { first, rest: rest.join(' ') };
}

// Iniciales para los monogramas ("Empyrean Studio" → "ES").
export function brandInitials(name = tenantBrand().name) {
  return String(name).trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? '').join('').toLocaleUpperCase('es') || 'B';
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
