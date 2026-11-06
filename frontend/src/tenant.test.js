import { afterEach, describe, expect, it, vi } from 'vitest';
import { accessRoleFor, currentTenantSlug, legacyRedirectTarget, parseTenantPath, tenantHref, withTenantRole } from './tenant.js';
import { api, apiUrl, getStoredSession, saveSession } from './api.js';

function atPath(pathname) {
  vi.stubGlobal('window', { location: { pathname, replace: vi.fn() } });
}

function createStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}

describe('rutas por barbería', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reconoce /t/:slug y la ruta interna', () => {
    expect(parseTenantPath('/t/empyrean-studio')).toEqual({ slug: 'empyrean-studio', path: '/' });
    expect(parseTenantPath('/t/barberia-norte/reservar/cita')).toEqual({ slug: 'barberia-norte', path: '/reservar/cita' });
    expect(parseTenantPath('/t/barberia-norte/admin/')).toEqual({ slug: 'barberia-norte', path: '/admin' });
    for (const invalid of ['/reservar', '/t/', '/t/Mayus', '/t/-mal', '/t/mal-', '/x/empyrean-studio']) expect(parseTenantPath(invalid)).toBeNull();
  });

  it('construye enlaces internos dentro de la barbería actual', () => {
    atPath('/t/barberia-norte/mi-cuenta');
    expect(currentTenantSlug()).toBe('barberia-norte');
    expect(tenantHref('/')).toBe('/t/barberia-norte');
    expect(tenantHref('/reservar/cita?service=2&barber=4')).toBe('/t/barberia-norte/reservar/cita?service=2&barber=4');
    expect(tenantHref('/?login=1')).toBe('/t/barberia-norte?login=1');
    expect(tenantHref('/#ubicacion')).toBe('/t/barberia-norte#ubicacion');
    expect(tenantHref('/recuperar-contrasena')).toBe('/recuperar-contrasena');
    expect(tenantHref('/t/otra/reservar')).toBe('/t/otra/reservar');
  });

  it('redirige las rutas antiguas a la barbería por defecto conservando consulta y ancla', () => {
    expect(legacyRedirectTarget({ pathname: '/', search: '', hash: '' })).toBe('/t/empyrean-studio');
    expect(legacyRedirectTarget({ pathname: '/mi-cuenta', search: '?tab=historial', hash: '' })).toBe('/t/empyrean-studio/mi-cuenta?tab=historial');
    expect(legacyRedirectTarget({ pathname: '/reservar', search: '', hash: '#equipo' })).toBe('/t/empyrean-studio/reservar#equipo');
    expect(legacyRedirectTarget({ pathname: '/t/barberia-norte/admin' })).toBeNull();
    expect(legacyRedirectTarget({ pathname: '/recuperar-contrasena', search: '?token=x' })).toBeNull();
  });
});

describe('rol efectivo por barbería', () => {
  afterEach(() => vi.unstubAllGlobals());
  const owner = { role: 'CLIENTE', memberships: [{ tenantSlug: 'empyrean-studio', role: 'OWNER' }, { tenantSlug: 'barberia-norte', role: 'BARBER' }] };

  it('decide el panel según la membresía en ESA barbería', () => {
    expect(accessRoleFor(owner, 'empyrean-studio')).toBe('ADMINISTRADOR');
    expect(accessRoleFor(owner, 'barberia-norte')).toBe('BARBERO');
    expect(accessRoleFor(owner, 'barberia-sur')).toBe('CLIENTE');
    expect(accessRoleFor({ role: 'ADMINISTRADOR', memberships: [] }, 'barberia-sur')).toBe('SIN_ACCESO');
    expect(accessRoleFor({ role: 'BARBERO', memberships: [{ tenantSlug: 'empyrean-studio', role: 'ADMIN' }] }, 'empyrean-studio')).toBe('ADMINISTRADOR');
    expect(accessRoleFor(null)).toBeNull();
  });

  it('conserva el rol de la cuenta y recalcula al cambiar de barbería', () => {
    const inEmpyrean = withTenantRole(owner, 'empyrean-studio');
    expect(inEmpyrean).toMatchObject({ role: 'ADMINISTRADOR', globalRole: 'CLIENTE' });
    expect(withTenantRole(inEmpyrean, 'barberia-sur').role).toBe('CLIENTE');
  });

  it('la sesión guardada se interpreta según la barbería de la URL', () => {
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
    atPath('/t/empyrean-studio/admin');
    saveSession({ user: withTenantRole(owner, 'empyrean-studio') });
    expect(getStoredSession().user.role).toBe('ADMINISTRADOR');
    atPath('/t/barberia-norte/barbero');
    expect(getStoredSession().user.role).toBe('BARBERO');
  });
});

describe('cliente HTTP por barbería', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('envía los módulos de negocio a la barbería de la URL y deja global la autenticación', () => {
    atPath('/t/barberia-norte/reservar');
    expect(apiUrl('/services')).toBe('http://localhost:3002/api/t/barberia-norte/services');
    expect(apiUrl('/appointments/mine')).toBe('http://localhost:3002/api/t/barberia-norte/appointments/mine');
    expect(apiUrl('/admin/dashboard?dateFrom=2026-10-01')).toBe('http://localhost:3002/api/t/barberia-norte/admin/dashboard?dateFrom=2026-10-01');
    expect(apiUrl('/barber/dashboard')).toBe('http://localhost:3002/api/t/barberia-norte/barber/dashboard');
    expect(apiUrl('/auth/me')).toBe('http://localhost:3002/api/auth/me');
    expect(apiUrl('/barbershop')).toBe('http://localhost:3002/api/barbershop');
  });

  it('aplica el rol de la barbería a la respuesta de inicio de sesión', async () => {
    atPath('/t/barberia-norte');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ user: { role: 'CLIENTE', memberships: [{ tenantSlug: 'barberia-norte', role: 'OWNER' }] } }) }));
    const result = await api.login({ email: 'a@b.c', password: 'Clave1234' });
    expect(result.user).toMatchObject({ role: 'ADMINISTRADOR', globalRole: 'CLIENTE' });
  });
});
