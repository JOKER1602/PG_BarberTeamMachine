import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretBookingRequest } from '../src/services/booking-assistant.js';

const services = [
  { id: 1, name: 'Corte normal' },
  { id: 2, name: 'Perfilado de barba' }
];
const barbers = [{ id: 3, displayName: 'Andy Flores' }, { id: 4, displayName: 'Diego Rojas' }];
const now = new Date('2026-10-13T15:00:00.000Z');

test('interpreta servicio, profesional, fecha y hora en español', () => {
  const result = interpretBookingRequest('Quiero un corte normal mañana con Andy después de las 4 pm', { services, barbers, now });
  assert.equal(result.service.id, 1);
  assert.equal(result.barber.id, 3);
  assert.equal(result.date, '2026-10-14');
  assert.equal(result.preferredMinutes, 16 * 60);
});

test('no interpreta una fecha como si fuera una hora', () => {
  const result = interpretBookingRequest('Perfilado de barba el 15/10/2026', { services, barbers, now });
  assert.equal(result.service.id, 2);
  assert.equal(result.date, '2026-10-15');
  assert.equal(result.preferredMinutes, null);
});

test('acepta una consulta sencilla sin fecha y conserva el servicio detectado', () => {
  const result = interpretBookingRequest('Necesito perfilado de barba', { services, barbers, now });
  assert.equal(result.service.id, 2);
  assert.equal(result.date, null);
  assert.equal(result.barber, null);
});
