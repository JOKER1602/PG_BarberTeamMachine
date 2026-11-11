import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import { uploadsPath } from '../config/paths.js';

const ACCEPTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const WEBP_QUALITY = 70;
// Evita que una imagen muy comprimida (pocos MB, miles de megapíxeles) agote la
// memoria al descomprimirse.
const MAX_INPUT_PIXELS = 50_000_000;

// rotate() aplica la orientación EXIF antes de que sharp descarte los metadatos
// (incluida la ubicación GPS de las fotos de celular).
function convertToWebp(input) {
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().webp({ quality: WEBP_QUALITY }).toBuffer();
}

function invalidImage(label) {
  const error = new Error(`La imagen de ${label} está dañada, es demasiado grande o no es una imagen válida`);
  error.status = 400;
  return error;
}

export function createImageUpload({ folder, prefix, label }) {
  const uploadDirectory = uploadsPath(folder);
  mkdirSync(uploadDirectory, { recursive: true });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_request, file, done) => {
      if (ACCEPTED_MIME_TYPES.has(file.mimetype)) return done(null, true);
      const error = new Error(`La imagen de ${label} debe ser JPG, PNG o WEBP`);
      error.status = 400;
      return done(error);
    }
  });

  // Deja request.file como lo dejaba el guardado en disco, ya convertido.
  async function storeAsWebp(request, _response, next) {
    if (!request.file) return next();
    let webp;
    try {
      webp = await convertToWebp(request.file.buffer);
    } catch {
      return next(invalidImage(label));
    }
    try {
      const filename = `${prefix}-${Date.now()}-${randomUUID()}.webp`;
      const filePath = path.join(uploadDirectory, filename);
      await writeFile(filePath, webp);
      delete request.file.buffer;
      Object.assign(request.file, { filename, destination: uploadDirectory, path: filePath, mimetype: 'image/webp', size: webp.length });
      return next();
    } catch (error) {
      return next(error);
    }
  }

  return { single: (field) => [upload.single(field), storeAsWebp] };
}
