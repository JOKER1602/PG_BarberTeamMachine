import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, clearSession, getStoredSession, saveSession } from './api.js';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body)
  };
}

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    snapshot: () => Object.fromEntries(values)
  };
}

describe('cliente API del frontend', () => {
  let storage;
  let sessionStorageMock;
  let replace;

  beforeEach(() => {
    storage = createStorage();
    replace = vi.fn();
    vi.stubGlobal('localStorage', storage);
    sessionStorageMock = createStorage();
    vi.stubGlobal('sessionStorage', sessionStorageMock);
    vi.stubGlobal('window', { location: { replace } });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('guarda y elimina una sesión del cliente', () => {
    saveSession({ user: { id: 12, role: 'CLIENTE', firstName: 'Ana' } });

    expect(storage.snapshot()).toEqual({});
    expect(getStoredSession()).toEqual({ user: { id: 12, role: 'CLIENTE', firstName: 'Ana' } });

    clearSession();
    expect(storage.snapshot()).toEqual({});
  });

  it('envía credenciales como JSON y permite que el navegador reciba la cookie HttpOnly', async () => {
    fetch.mockResolvedValue(jsonResponse({ user: { role: 'CLIENTE' } }));

    await expect(api.login({ email: 'ana@example.com', password: 'Clave1234' })).resolves.toMatchObject({ user: { role: 'CLIENTE' } });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3002/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'ana@example.com', password: 'Clave1234' }),
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      })
    );
  });

  it('incluye credenciales de cookie y forma correctamente la consulta de disponibilidad', async () => {
    fetch.mockResolvedValue(jsonResponse({ slots: [] }));

    await api.availability(7, [2, 5], '2026-10-15');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3002/api/appointments/availability?barberId=7&serviceIds=2,5&date=2026-10-15',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' }, credentials: 'include' })
    );
  });

  it('propaga el mensaje del servidor cuando una solicitud falla', async () => {
    fetch.mockResolvedValue(jsonResponse({ message: 'El horario ya no está disponible.' }, 409));

    await expect(api.createAppointments({ barberId: 3 })).rejects.toThrow('El horario ya no está disponible.');
    expect(replace).not.toHaveBeenCalled();
  });

  it('cierra y redirige una sesión expirada en una ruta protegida', async () => {
    sessionStorageMock.setItem('btm_user', JSON.stringify({ id: 8, role: 'CLIENTE' }));
    fetch.mockResolvedValue(jsonResponse({ message: 'Sesión expirada' }, 401));

    await expect(api.appointments()).rejects.toThrow('Sesión expirada');

    expect(storage.snapshot()).toEqual({});
    expect(replace).toHaveBeenCalledWith('/?login=1&session=expired');
  });

  it('no redirige por una credencial inválida durante el inicio de sesión', async () => {
    sessionStorageMock.setItem('btm_user', JSON.stringify({ id: 8, role: 'CLIENTE' }));
    fetch.mockResolvedValue(jsonResponse({ message: 'Credenciales inválidas' }, 401));

    await expect(api.login({ email: 'ana@example.com', password: 'incorrecta' })).rejects.toThrow('Credenciales inválidas');

    expect(sessionStorageMock.getItem('btm_user')).toBe(JSON.stringify({ id: 8, role: 'CLIENTE' }));
    expect(replace).not.toHaveBeenCalled();
  });
});
