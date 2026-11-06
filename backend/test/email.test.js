import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../src/services/email.js';

test('escapa el HTML de los datos que se insertan en los correos', () => {
  assert.equal(escapeHtml('<a href="x">Ana & \'Luis\'</a>'), '&lt;a href=&quot;x&quot;&gt;Ana &amp; &#39;Luis&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml('José Pérez'), 'José Pérez');
});
