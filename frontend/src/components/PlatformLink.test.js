import { describe, expect, it } from 'vitest';
import PlatformLink from './PlatformLink.jsx';

describe('acceso al panel de la plataforma', () => {
  it('solo aparece para los operadores (super admins)', () => {
    for (const user of [null, undefined, { role: 'CLIENTE' }, { role: 'ADMINISTRADOR', isPlatformAdmin: false }]) expect(PlatformLink({ user })).toBeNull();
    const link = PlatformLink({ user: { role: 'CLIENTE', isPlatformAdmin: true } });
    expect(link.props.href).toBe('/platform');
    expect(link.props.className).toBe('platform-shortcut');
  });
});
