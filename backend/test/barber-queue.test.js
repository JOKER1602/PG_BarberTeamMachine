import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BarberQueueTimeout, openQueues, withBarberQueue } from '../src/services/barber-queue.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('las tareas de un mismo barbero se ejecutan de a una y en orden de llegada', async () => {
  const order = [];
  let running = 0; let maxRunning = 0;
  await Promise.all([1, 2, 3, 4, 5].map((n) => withBarberQueue(7, async () => {
    running += 1; maxRunning = Math.max(maxRunning, running);
    await wait(5);
    order.push(n);
    running -= 1;
  })));
  assert.deepEqual(order, [1, 2, 3, 4, 5]);
  assert.equal(maxRunning, 1);
  assert.equal(openQueues(), 0);
});

test('barberos distintos no se esperan entre sí', async () => {
  const started = Date.now();
  await Promise.all([1, 2, 3, 4].map((barber) => withBarberQueue(barber, () => wait(40))));
  assert.ok(Date.now() - started < 120, 'deberían correr en paralelo');
});

test('un error en una tarea no bloquea a las siguientes', async () => {
  const failing = withBarberQueue(9, async () => { throw new Error('falló'); });
  const next = withBarberQueue(9, async () => 'siguió');
  await assert.rejects(failing, /falló/);
  assert.equal(await next, 'siguió');
});

test('quien espera demasiado se rinde sin romper el orden de los demás', async () => {
  const order = [];
  const slow = withBarberQueue(11, async () => { await wait(80); order.push('lenta'); });
  const impatient = withBarberQueue(11, async () => order.push('impaciente'), { timeoutMs: 20 });
  const patient = withBarberQueue(11, async () => order.push('paciente'));
  await assert.rejects(impatient, BarberQueueTimeout);
  await Promise.all([slow, patient]);
  assert.deepEqual(order, ['lenta', 'paciente']);
  assert.equal(openQueues(), 0);
});
