import test from 'node:test';
import assert from 'node:assert/strict';
import { isSlotAvailable, isWithinWorkingHours, overlaps } from '../src/domain/availability.js';

const mondayHours = [{ weekday: 1, start_minutes: 9 * 60, end_minutes: 18 * 60 }];
const at = (time) => new Date(`2026-09-21T${time}:00-04:00`); // Monday in Cochabamba

test('interprets working hours in Cochabamba, not UTC', () => {
  assert.equal(isWithinWorkingHours(at('09:00'), at('09:45'), mondayHours), true);
  assert.equal(isWithinWorkingHours(at('08:45'), at('09:30'), mondayHours), false);
  assert.equal(isWithinWorkingHours(at('17:30'), at('18:15'), mondayHours), false);
});

test('rejects appointments that overlap even partially', () => {
  assert.equal(overlaps(at('15:00'), at('15:45'), at('15:30'), at('16:15')), true);
  assert.equal(overlaps(at('15:00'), at('15:45'), at('15:45'), at('16:15')), false);
  const result = isSlotAvailable({
    startAt: at('15:30'), endAt: at('16:15'), workingHours: mondayHours, blocks: [],
    appointments: [{ starts_at: at('15:00'), ends_at: at('15:45') }]
  });
  assert.deepEqual(result, { available: false, reason: 'El horario ya esta ocupado' });
});

test('rejects schedule blocks and services that cross closing time', () => {
  const blocked = isSlotAvailable({
    startAt: at('12:00'), endAt: at('12:30'), workingHours: mondayHours,
    blocks: [{ starts_at: at('11:45'), ends_at: at('12:15') }], appointments: []
  });
  assert.deepEqual(blocked, { available: false, reason: 'Horario bloqueado' });
  const closing = isSlotAvailable({ startAt: at('17:30'), endAt: at('18:30'), workingHours: mondayHours, blocks: [], appointments: [] });
  assert.deepEqual(closing, { available: false, reason: 'Fuera del horario laboral' });
});
