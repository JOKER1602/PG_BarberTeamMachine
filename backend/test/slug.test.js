import test from 'node:test';
import assert from 'node:assert/strict';
import { firstFreeSlug, slugify } from '../src/domain/slug.js';

test('el identificador se arma desde el nombre, sin acentos ni signos', () => {
  assert.equal(slugify('Coloración y mechas'), 'coloracion-y-mechas');
  assert.equal(slugify('Diseño de cejas'), 'diseno-de-cejas');
  assert.equal(slugify('  Cortes  '), 'cortes');
  assert.equal(slugify('Barba & Bigote!!'), 'barba-bigote');
  assert.equal(slugify('Combo N°1'), 'combo-n-1');
});

test('nombres sin letras ni números usan un identificador por defecto', () => {
  assert.equal(slugify('★★★'), 'categoria');
  assert.equal(slugify('A'), 'categoria');
});

test('el identificador no supera el largo máximo ni termina en guion', () => {
  const slug = slugify(`${'muy largo '.repeat(20)}final`);
  assert.ok(slug.length <= 70);
  assert.doesNotMatch(slug, /-$/);
});

test('si el identificador ya existe se usa el siguiente libre', () => {
  assert.equal(firstFreeSlug('cortes', []), 'cortes');
  assert.equal(firstFreeSlug('cortes', ['cortes']), 'cortes-2');
  assert.equal(firstFreeSlug('cortes', ['cortes', 'cortes-2', 'cortes-3']), 'cortes-4');
  assert.equal(firstFreeSlug('cortes', ['cortes-2']), 'cortes');
});
