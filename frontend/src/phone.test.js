import { describe, expect, it } from 'vitest';
import { bolivianPhonePattern, cleanBolivianPhone } from './phone.js';

describe('celular boliviano', () => {
  it('conserva los 8 dígitos aunque se escriban guiones, espacios o el prefijo +591', () => {
    expect(cleanBolivianPhone('7123-4567')).toBe('71234567');
    expect(cleanBolivianPhone('7123 4567')).toBe('71234567');
    expect(cleanBolivianPhone('+591 71234567')).toBe('71234567');
    expect(cleanBolivianPhone('591-6123-4567')).toBe('61234567');
  });

  it('nunca devuelve más de 8 dígitos', () => {
    expect(cleanBolivianPhone('712345678999')).toBe('71234567');
    expect(cleanBolivianPhone('')).toBe('');
  });

  it('acepta solo móviles que empiezan con 6 o 7', () => {
    expect(bolivianPhonePattern.test('71234567')).toBe(true);
    expect(bolivianPhonePattern.test('61234567')).toBe(true);
    expect(bolivianPhonePattern.test('41234567')).toBe(false);
    expect(bolivianPhonePattern.test('7123456')).toBe(false);
  });
});
