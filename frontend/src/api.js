import { currentTenantSlug, tenantHref, withTenantRole } from './tenant.js';

// Mantiene frontend y API en el mismo host. Así la aplicación funciona igual
// si se abre con localhost, 127.0.0.1 o la IP local de la computadora.
const browserLocation = globalThis.window?.location ?? { protocol: 'http:', hostname: 'localhost' };
const localApiUrl = `${browserLocation.protocol}//${browserLocation.hostname}:3002/api`;
// En desarrollo la API vive en el puerto 3002. En producción se usa /api
// para que un proxy HTTPS pueda servir frontend y backend en el mismo dominio.
// Si la API se publica en otro dominio, VITE_API_URL tiene prioridad.
const defaultApiUrl = import.meta.env.DEV ? localApiUrl : '/api';
const API_URL = import.meta.env.VITE_API_URL ?? defaultApiUrl;

// Módulos de negocio: se piden a la barbería de la URL (/api/t/:slug/...).
// Autenticación y salud son globales.
const TENANT_MODULE = /^\/(services|barbers|settings|admin|barber|appointments|payments|reviews|notifications|recommendations)(?=\/|\?|$)/;

export function apiUrl(path) {
  return TENANT_MODULE.test(path) ? `${API_URL}/t/${currentTenantSlug()}${path}` : `${API_URL}${path}`;
}

// El rol que usan las páginas es el de la persona en la barbería actual.
function withSessionRole(result) {
  return result?.user ? { ...result, user: withTenantRole(result.user) } : result;
}

function expireStoredSession(path) {
  if (path.startsWith('/auth/login') || path.startsWith('/auth/register') || path.startsWith('/auth/me')) return;
  clearSession();
  window.location.replace(tenantHref('/?login=1&session=expired'));
}

async function request(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (response.status === 401) expireStoredSession(path);
    // Si la API indica qué campo falló, se muestra ese motivo en vez de un
    // genérico "datos inválidos".
    const fieldError = Object.values(data?.errors?.fieldErrors ?? {}).flat()[0];
    throw new Error(fieldError ? `${data.message}: ${fieldError}` : (data?.message ?? 'No se pudo completar la solicitud'));
  }
  return data;
}

async function upload(path, file, field = 'photo') {
  const body = new FormData();
  body.append(field, file);
  const response = await fetch(apiUrl(path), { method: 'POST', credentials: 'include', body });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) expireStoredSession(path);
    throw new Error(data?.message ?? 'No se pudo subir la imagen');
  }
  return data;
}

export const api = {
  tenant: () => request(`/t/${currentTenantSlug()}`),
  businessSettings: () => request('/settings'),
  reviews: (barberId) => request(`/reviews${barberId ? `?barberId=${encodeURIComponent(barberId)}` : ''}`),
  createReview: (body) => request('/reviews', { method: 'POST', body: JSON.stringify(body) }),
  updateBusinessSettings: (body) => request('/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  uploadPaymentQr: (file) => upload('/settings/payment-qr', file, 'qr'),
  uploadBrandImage: (kind, file) => upload(`/settings/brand-image/${kind}`, file, 'image'),
  uploadPaymentProof: (file) => upload('/payments/proof', file, 'proof'),
  services: () => request('/services'),
  serviceCategories: () => request('/services/categories'),
  createServiceCategory: (body) => request('/services/categories', { method: 'POST', body: JSON.stringify(body) }),
  barbers: () => request('/barbers'),
  barberDashboard: () => request('/barber/dashboard'),
  completeBarberAppointment: (id) => request(`/barber/appointments/${id}/complete`, { method: 'PATCH' }),
  updateBarberAppointmentStatus: (id, body) => request(`/barber/appointments/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) }),
  undoBarberAppointment: (id) => request(`/barber/appointments/${id}/undo`, { method: 'PATCH' }),
  availability: (barberId, serviceIds, date) => request(`/appointments/availability?barberId=${barberId}&serviceIds=${Array.isArray(serviceIds) ? serviceIds.join(',') : serviceIds}&date=${date}`),
  recommendations: (serviceIds = [], days = 14) => {
    const query = new URLSearchParams({ days: String(days) });
    if (serviceIds.length) query.set('serviceIds', serviceIds.join(','));
    return request(`/recommendations?${query.toString()}`);
  },
  // tenantSlug: la API registra a los clientes como clientes de esta barbería.
  register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify({ ...body, tenantSlug: currentTenantSlug() || undefined }) }).then(withSessionRole),
  login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify({ ...body, tenantSlug: currentTenantSlug() || undefined }) }).then(withSessionRole),
  me: () => request('/auth/me').then(withSessionRole),
  logout: () => request('/auth/logout', { method: 'POST' }),
  // La barbería de origen da la marca del correo y el enlace de vuelta.
  requestPasswordReset: (email) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email, tenantSlug: currentTenantSlug() }) }),
  resetPassword: (body) => request('/auth/reset-password', { method: 'POST', body: JSON.stringify(body) }),
  appointments: () => request('/appointments/mine'),
  createAppointments: (body) => request('/appointments/multi', { method: 'POST', body: JSON.stringify(body) }),
  rescheduleAppointment: (id, startsAt) => request(`/appointments/${id}/reschedule`, { method: 'PATCH', body: JSON.stringify({ startsAt }) }),
  cancelAppointment: (id) => request(`/appointments/${id}/cancel`, { method: 'PATCH' }),
  updateProfile: (body) => request('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }).then(withSessionRole),
  updatePassword: (body) => request('/auth/me/password', { method: 'PATCH', body: JSON.stringify(body) }),
  adminAppointments: (query = '') => request(`/appointments/admin${query ? `?${query}` : ''}`),
  updateAppointmentAdminNotes: (id, adminNotes) => request(`/appointments/${id}/admin-notes`, { method: 'PATCH', body: JSON.stringify({ adminNotes }) }),
  updateAppointmentStatus: (id, body) => request(`/appointments/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) }),
  correctAppointmentStatus: (id, body) => request(`/appointments/${id}/correct-status`, { method: 'PATCH', body: JSON.stringify(body) }),
  appointmentStatusHistory: (id) => request(`/appointments/${id}/status-history`),
  adminServices: () => request('/services/admin'),
  createService: (body) => request('/services', { method: 'POST', body: JSON.stringify(body) }),
  updateService: (id, body) => request(`/services/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteService: (id) => request(`/services/${id}`, { method: 'DELETE' }),
  adminBarbers: () => request('/barbers/admin'),
  createBarber: (body) => request('/barbers', { method: 'POST', body: JSON.stringify(body) }),
  uploadBarberPhoto: (id, file) => upload(`/barbers/${id}/photo`, file),
  updateBarber: (id, body) => request(`/barbers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  setBarberServices: (id, serviceIds) => request(`/barbers/${id}/services`, { method: 'PUT', body: JSON.stringify({ serviceIds }) }),
  workingHours: (id) => request(`/barbers/${id}/working-hours`),
  createWorkingHour: (id, body) => request(`/barbers/${id}/working-hours`, { method: 'POST', body: JSON.stringify(body) }),
  deleteWorkingHour: (id, hourId) => request(`/barbers/${id}/working-hours/${hourId}`, { method: 'DELETE' }),
  blocks: (id) => request(`/barbers/${id}/blocks`),
  createBlock: (id, body) => request(`/barbers/${id}/blocks`, { method: 'POST', body: JSON.stringify(body) }),
  deleteBlock: (id, blockId) => request(`/barbers/${id}/blocks/${blockId}`, { method: 'DELETE' }),
  adminUsers: () => request('/admin/users'),
  adminDashboard: (query = '') => request(`/admin/dashboard${query ? `?${query}` : ''}`),
  createBarberAccount: (body) => request('/admin/barber-accounts', { method: 'POST', body: JSON.stringify(body) }),
  // Operadores de la plataforma (global, sin /t/:slug).
  platformTenants: () => request('/platform/tenants'),
  createTenant: (body) => request('/platform/tenants', { method: 'POST', body: JSON.stringify(body) }),
  addTenantOwner: (slug, body) => request(`/platform/tenants/${encodeURIComponent(slug)}/owners`, { method: 'POST', body: JSON.stringify(body) }),
  updateTenant: (slug, body) => request(`/platform/tenants/${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  setUserActive: (id, isActive) => request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive }) })
};

export function saveSession(session) {
  // El acceso se mantiene exclusivamente en la cookie HttpOnly. Este dato es
  // solo una caché visual de la identidad y nunca autoriza peticiones.
  localStorage.removeItem('btm_token');
  localStorage.removeItem('btm_user');
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('btm_user', JSON.stringify(session.user));
}

export function getStoredSession() {
  try {
    const user = typeof sessionStorage === 'undefined' ? null : JSON.parse(sessionStorage.getItem('btm_user') ?? 'null');
    // El rol se recalcula para la barbería de la URL actual: la misma persona
    // puede ser dueña en una barbería y cliente en otra.
    return user ? { user: withTenantRole(user) } : null;
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem('btm_token');
  localStorage.removeItem('btm_user');
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem('btm_token');
    sessionStorage.removeItem('btm_user');
  }
  // Elimina rastros de la implementación anterior. La cookie HttpOnly actual
  // solamente puede eliminarse mediante POST /auth/logout en el servidor.
  if (typeof document !== 'undefined') {
    for (const name of ['btm_token', 'btm_user']) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  }
}

export function logoutToHome() {
  api.logout().catch(() => undefined).finally(() => {
    clearSession();
    window.location.replace(tenantHref('/'));
  });
}
