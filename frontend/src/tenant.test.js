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

describe('marca por barbería', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('arma el logotipo y las iniciales desde el nombre de la barbería', async () => {
    const { brandWords, brandInitials } = await import('./tenant.js');
    expect(brandWords('Empyrean Studio')).toEqual({ first: 'EMPYREAN', rest: 'STUDIO' });
    expect(brandWords('Barbería Norte del Sur')).toEqual({ first: 'BARBERÍA', rest: 'NORTE DEL SUR' });
    expect(brandWords('Navaja')).toEqual({ first: 'NAVAJA', rest: '' });
    expect(brandInitials('Empyrean Studio')).toBe('ES');
    expect(brandInitials('barbería norte')).toBe('BN');
    expect(brandInitials('')).toBe('B');
  });

  it('usa la marca de la barbería cargada y nunca la de otra por defecto', async () => {
    const { setTenantBrand, tenantBrand } = await import('./tenant.js');
    vi.stubGlobal('document', { title: '' });
    atPath('/t/barberia-norte');
    const brand = setTenantBrand({ tenant: { slug: 'barberia-norte', displayName: 'Norte S.R.L.' }, brand: { name: 'Barbería Norte', city: 'Cochabamba', logoUrl: null, coverUrl: null } });
    expect(brand).toEqual({ slug: 'barberia-norte', name: 'Barbería Norte', city: 'Cochabamba', logoUrl: null, coverUrl: null, theme: null });
    expect(document.title).toBe('Barbería Norte');
    expect(tenantBrand().name).toBe('Barbería Norte');
    // Sin datos de marca se usa el nombre registrado de la barbería.
    expect(setTenantBrand({ tenant: { slug: 'x', displayName: 'Otra' } }).name).toBe('Otra');
    expect(setTenantBrand().name).not.toMatch(/empyrean/i);
  });

  it('pone el logo de la barbería como icono de la pestaña', async () => {
    const { applyBrandIcon, brandIconHref } = await import('./tenant.js');
    const makeLink = () => { const attrs = new Map(); return { attrs, setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) }; };
    const children = [];
    const doc = {
      head: { querySelector: () => children[0] ?? null, appendChild: (node) => children.push(node) },
      createElement: () => makeLink()
    };
    const link = applyBrandIcon({ name: 'Esquece Barber', logoUrl: '/uploads/logo.webp' }, doc);
    expect(children).toHaveLength(1);
    expect(link.attrs.get('rel')).toBe('icon');
    expect(link.attrs.get('href')).toBe('/uploads/logo.webp');
    // Se reutiliza el mismo <link>; sin logo pasa a un monograma SVG.
    applyBrandIcon({ name: 'Barbería Norte', logoUrl: null, theme: { background: '#EFEFED', text: '#0D0D0D' } }, doc);
    expect(children).toHaveLength(1);
    expect(link.attrs.get('type')).toBe('image/svg+xml');
    const svg = decodeURIComponent(link.attrs.get('href').replace('data:image/svg+xml,', ''));
    expect(svg).toContain('>BN</text>');
    expect(svg).toContain('fill="#0D0D0D"');
    // Un nombre con caracteres de marcado no rompe el SVG.
    expect(decodeURIComponent(brandIconHref({ name: '<a> "b"' }))).not.toMatch(/<a>|"b"/);
  });

  it('activa los colores propios solo si la barbería los tiene', async () => {
    const { applyBrandTheme, DEFAULT_THEME } = await import('./tenant.js');
    const fakeRoot = () => {
      const styles = new Map(); const attributes = new Map();
      return {
        styles, attributes,
        style: { setProperty: (name, value) => styles.set(name, value), removeProperty: (name) => styles.delete(name) },
        setAttribute: (name, value) => attributes.set(name, value), removeAttribute: (name) => attributes.delete(name)
      };
    };
    const themed = fakeRoot();
    expect(applyBrandTheme({ accent: '#B3261E', background: '#1C1C1C', text: '#EDE6D8' }, themed)).toBe(true);
    expect(themed.attributes.has('data-brand-theme')).toBe(true);
    expect(themed.styles.get('--theme-accent')).toBe('#B3261E');
    expect(themed.styles.get('--theme-background')).toBe('#1C1C1C');
    expect(themed.styles.get('--theme-text')).toBe('#EDE6D8');
    expect(themed.styles.get('--theme-dir')).toBe('1'); // fondo oscuro
    const light = fakeRoot();
    applyBrandTheme({ accent: '#111111', background: '#FFFFFF', text: '#111111' }, light);
    expect(light.styles.get('--theme-dir')).toBe('-1'); // fondo claro → tema claro
    expect(light.attributes.get('data-brand-tone')).toBe('light'); // encabezado negro
    expect(themed.attributes.has('data-brand-tone')).toBe(false);

    // Un color faltante o inválido usa el de por defecto.
    const partial = fakeRoot();
    applyBrandTheme({ accent: '#B3261E', background: 'rojo', text: null }, partial);
    expect(partial.styles.get('--theme-background')).toBe(DEFAULT_THEME.background);
    expect(partial.styles.get('--theme-text')).toBe(DEFAULT_THEME.text);

    // Sin colores propios la página queda con el diseño original.
    expect(applyBrandTheme({ accent: null, background: null, text: null }, themed)).toBe(false);
    expect(themed.attributes.has('data-brand-theme')).toBe(false);
    expect(themed.styles.size).toBe(0);
    expect(applyBrandTheme(null, fakeRoot())).toBe(false);
  });

  it('la recuperación de contraseña recuerda la barbería de origen', async () => {
    const { passwordRecoveryHref } = await import('./tenant.js');
    atPath('/t/barberia-norte/reservar/cita');
    expect(passwordRecoveryHref()).toBe('/recuperar-contrasena?t=barberia-norte');
    vi.stubGlobal('window', { location: { pathname: '/recuperar-contrasena', search: '?token=abc&t=barberia-norte' } });
    expect(currentTenantSlug()).toBe('barberia-norte');
    expect(tenantHref('/?login=1')).toBe('/t/barberia-norte?login=1');
    vi.stubGlobal('window', { location: { pathname: '/recuperar-contrasena', search: '?t=No Valido' } });
    expect(currentTenantSlug()).toBe('empyrean-studio');
  });
});
