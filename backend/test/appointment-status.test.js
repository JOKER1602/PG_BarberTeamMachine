import test from 'node:test';
import assert from 'node:assert/strict';
import { findUndoableChange, recordStatusChange } from '../src/services/appointment-status.js';

const TENANT = 'aaaaaaaa-0000-0000-0000-000000000001';
const executorReturning = (row) => ({ execute: async () => [row ? [row] : []] });
const lastChange = (overrides = {}) => ({ id: 1, fromStatus: 'CONFIRMED', toStatus: 'NO_SHOW', kind: 'CHANGE', changedBy: '7', withinWindow: true, ...overrides });
const find = (row, currentStatus = 'NO_SHOW', userId = 7) => findUndoableChange(executorReturning(row), { tenantId: TENANT, appointmentId: 3, userId, currentStatus });

test('el barbero puede deshacer su propio cambio reciente', async () => {
  assert.equal((await find(lastChange()))?.fromStatus, 'CONFIRMED');
  assert.ok(await find(lastChange({ toStatus: 'COMPLETED' }), 'COMPLETED'));
});

test('no se puede deshacer pasada la ventana de minutos', async () => {
  assert.equal(await find(lastChange({ withinWindow: false })), null);
});

test('no se puede deshacer el cambio de otra persona', async () => {
  assert.equal(await find(lastChange({ changedBy: '99' })), null);
});

test('no se puede deshacer si después hubo una corrección o ya se deshizo', async () => {
  assert.equal(await find(lastChange({ kind: 'CORRECTION' })), null);
  assert.equal(await find(lastChange({ kind: 'UNDO' })), null);
});

test('no se puede deshacer si la cita ya no está en ese estado', async () => {
  assert.equal(await find(lastChange(), 'COMPLETED'), null);
});

test('una cancelación no se deshace con este mecanismo', async () => {
  assert.equal(await find(lastChange({ toStatus: 'CANCELLED' }), 'CANCELLED'), null);
});

test('sin historial no hay nada que deshacer', async () => {
  assert.equal(await find(null), null);
});

test('el historial siempre guarda la barbería', async () => {
  const calls = [];
  await recordStatusChange({ execute: async (sql, values) => { calls.push({ sql, values }); return [[]]; } },
    { tenantId: TENANT, appointmentId: 3, fromStatus: 'CONFIRMED', toStatus: 'COMPLETED', changedBy: 7 });
  assert.match(calls[0].sql, /tenant_id/);
  assert.equal(calls[0].values[0], TENANT);
  await assert.rejects(() => recordStatusChange({ execute: async () => [[]] }, { appointmentId: 3, fromStatus: 'CONFIRMED', toStatus: 'COMPLETED', changedBy: 7 }));
});
