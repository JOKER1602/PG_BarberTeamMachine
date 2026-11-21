import test from 'node:test';
import assert from 'node:assert/strict';
import { findAvailableDays } from '../src/services/appointment-availability.js';

// Conexión falsa: el barbero atiende de 10:00 a 12:00 todos los días menos el
// domingo (weekday 7) y no tiene bloqueos ni citas.
function fakeConnection({ performsService = true } = {}) {
  return {
    async execute(sql, values = []) {
      if (sql.includes('FROM services s') && sql.includes('JOIN barbers b')) return [performsService ? [{ id: 1, durationMinutes: 30, price: 50 }] : []];
      if (sql.includes('FROM services s')) return [[{ id: 1, durationMinutes: 30, price: 50 }]];
      if (sql.includes('FROM barber_working_hours')) return [values[2] === 7 ? [] : [{ weekday: values[2], start_minutes: 600, end_minutes: 720 }]];
      return [[]];
    }
  };
}

test('cuenta los horarios libres por día y deja en cero los días cerrados', async () => {
  // 2030-03-16 es sábado; 17 domingo; 18 lunes.
  const days = await findAvailableDays(fakeConnection(), { tenantId: 't', barberId: 2, serviceIds: [1], from: '2030-03-16', days: 3 });
  assert.deepEqual(days.map((day) => day.date), ['2030-03-16', '2030-03-17', '2030-03-18']);
  assert.ok(days[0].slots > 0);
  assert.equal(days[1].slots, 0);
  assert.ok(days[2].slots > 0);
});

test('devuelve null si el barbero no realiza el servicio', async () => {
  const days = await findAvailableDays(fakeConnection({ performsService: false }), { tenantId: 't', barberId: 2, serviceIds: [1], from: '2030-03-16', days: 2 });
  assert.equal(days, null);
});
