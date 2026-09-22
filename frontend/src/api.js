const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3002/api';

async function request(path, options = {}) {
  const token = localStorage.getItem('btm_token');
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw new Error(data?.message ?? 'No se pudo completar la solicitud');
  }
  return data;
}

export const api = {
  health: () => request('/health'),
  services: () => request('/services'),
  barbers: () => request('/barbers'),
  barberDashboard: () => request('/barber/dashboard'),
  availability: (barberId, serviceIds, date) => request(`/appointments/availability?barberId=${barberId}&serviceIds=${Array.isArray(serviceIds) ? serviceIds.join(',') : serviceIds}&date=${date}`),
  register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  requestPasswordReset: (email) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (body) => request('/auth/reset-password', { method: 'POST', body: JSON.stringify(body) }),
  appointments: () => request('/appointments/mine'),
  createAppointment: (body) => request('/appointments', { method: 'POST', body: JSON.stringify(body) }),
  createAppointments: (body) => request('/appointments/multi', { method: 'POST', body: JSON.stringify(body) }),
  rescheduleAppointment: (id, startsAt) => request(`/appointments/${id}/reschedule`, { method: 'PATCH', body: JSON.stringify({ startsAt }) }),
  cancelAppointment: (id) => request(`/appointments/${id}/cancel`, { method: 'PATCH' }),
  notifications: () => request('/notifications'),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: 'PATCH' }),
  updateProfile: (body) => request('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),
  adminAppointments: (query = '') => request(`/appointments/admin${query ? `?${query}` : ''}`),
  updateAppointmentStatus: (id, body) => request(`/appointments/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) }),
  adminServices: () => request('/services/admin'),
  createService: (body) => request('/services', { method: 'POST', body: JSON.stringify(body) }),
  updateService: (id, body) => request(`/services/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  adminBarbers: () => request('/barbers/admin'),
  createBarber: (body) => request('/barbers', { method: 'POST', body: JSON.stringify(body) }),
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
  setUserActive: (id, isActive) => request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive }) })
};

export function saveSession(session) {
  localStorage.setItem('btm_token', session.token);
  localStorage.setItem('btm_user', JSON.stringify(session.user));
}

export function clearSession() {
  localStorage.removeItem('btm_token');
  localStorage.removeItem('btm_user');
}
