import { describe, expect, it, vi } from 'vitest';
import { closeOrGoToLogin } from './PasswordRecoveryPage.jsx';

function fakeWindow({ closes }) {
  const win = { closed: false, close: vi.fn(() => { if (closes) win.closed = true; }), location: { assign: vi.fn() }, setTimeout: (callback) => callback() };
  return win;
}

describe('cierre tras cambiar la contraseña', () => {
  it('cierra la pestaña si el navegador lo permite', () => {
    const win = fakeWindow({ closes: true });
    closeOrGoToLogin({ win, loginHref: '/t/barberia-norte?login=1' });
    expect(win.close).toHaveBeenCalled();
    expect(win.location.assign).not.toHaveBeenCalled();
  });

  it('si no puede cerrarla, lleva al inicio de sesión de la barbería', () => {
    const win = fakeWindow({ closes: false });
    closeOrGoToLogin({ win, loginHref: '/t/barberia-norte?login=1' });
    expect(win.location.assign).toHaveBeenCalledWith('/t/barberia-norte?login=1');
  });
});
