import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { retentionDays } from '../src/services/payment-proof-retention.js';

const original = process.env.PAYMENT_PROOF_RETENTION_DAYS;
afterEach(() => {
  if (original === undefined) delete process.env.PAYMENT_PROOF_RETENTION_DAYS;
  else process.env.PAYMENT_PROOF_RETENTION_DAYS = original;
});

test('los comprobantes se conservan 20 días si no se configura otro plazo', () => {
  delete process.env.PAYMENT_PROOF_RETENTION_DAYS;
  assert.equal(retentionDays(), 20);
});

test('el plazo se puede cambiar con PAYMENT_PROOF_RETENTION_DAYS', () => {
  process.env.PAYMENT_PROOF_RETENTION_DAYS = '45';
  assert.equal(retentionDays(), 45);
});

test('un plazo inválido vuelve a 20 días en lugar de borrar todo', () => {
  for (const value of ['0', '-3', 'abc', '2.5', '']) {
    process.env.PAYMENT_PROOF_RETENTION_DAYS = value;
    assert.equal(retentionDays(), 20, `valor ${JSON.stringify(value)}`);
  }
});
