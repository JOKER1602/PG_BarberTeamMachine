import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import sharp from 'sharp';

const uploadsDir = mkdtempSync(path.join(tmpdir(), 'webp-'));
process.env.UPLOADS_DIR = uploadsDir;
const { createImageUpload } = await import('../src/middleware/image-upload.js');
after(() => rmSync(uploadsDir, { recursive: true, force: true }));

const [, storeAsWebp] = createImageUpload({ folder: 'prueba', prefix: 'foto', label: 'prueba' }).single('foto');

async function store(buffer, mimetype = 'image/png') {
  const request = { file: { buffer, mimetype } };
  const error = await new Promise((resolve) => storeAsWebp(request, {}, resolve));
  return { request, error };
}

const pixels = Buffer.alloc(300 * 200 * 3);
for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 7) % 256;
const raw = { raw: { width: 300, height: 200, channels: 3 } };

test('guarda JPG, PNG y WEBP como .webp en calidad 70 y deja request.file listo para las rutas', async () => {
  const inputs = [await sharp(pixels, raw).png().toBuffer(), await sharp(pixels, raw).jpeg().toBuffer(), await sharp(pixels, raw).webp({ quality: 100 }).toBuffer()];
  for (const input of inputs) {
    const { request, error } = await store(input);
    assert.equal(error, undefined);
    assert.match(request.file.filename, /^foto-.+\.webp$/);
    assert.equal(request.file.mimetype, 'image/webp');
    assert.equal(request.file.buffer, undefined);
    const saved = readFileSync(path.join(request.file.destination, request.file.filename));
    assert.equal(request.file.size, saved.length);
    assert.equal((await sharp(saved).metadata()).format, 'webp');
    assert.deepEqual(saved, await sharp(input).webp({ quality: 70 }).toBuffer());
  }
});

test('aplica la orientación del celular y elimina los metadatos', async () => {
  const photo = await sharp(pixels, raw).withExif({ IFD0: { Copyright: 'dato-privado' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const { request } = await store(photo, 'image/jpeg');
  const saved = await sharp(readFileSync(path.join(request.file.destination, request.file.filename))).metadata();
  assert.equal(saved.width, 200);
  assert.equal(saved.height, 300);
  assert.equal(saved.exif, undefined);
  assert.equal(saved.orientation, undefined);
});

test('conserva la transparencia de los logos', async () => {
  const logo = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0 } } }).png().toBuffer();
  const { request } = await store(logo);
  assert.equal((await sharp(readFileSync(path.join(request.file.destination, request.file.filename))).metadata()).hasAlpha, true);
});

test('rechaza con 400 un archivo que dice ser imagen sin serlo y no guarda nada', async () => {
  const before = readdirSync(path.join(uploadsDir, 'prueba')).length;
  const { error } = await store(Buffer.from('<script>alert(1)</script>'));
  assert.equal(error.status, 400);
  assert.equal(readdirSync(path.join(uploadsDir, 'prueba')).length, before);
});

test('sin archivo deja que la ruta responda', async () => {
  const error = await new Promise((resolve) => storeAsWebp({}, {}, resolve));
  assert.equal(error, undefined);
});
