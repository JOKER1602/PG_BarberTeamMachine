import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { uploadsPath } from '../config/paths.js';

const extensionsByMimeType = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

export function createImageUpload({ folder, prefix, label }) {
  const uploadDirectory = uploadsPath(folder);
  mkdirSync(uploadDirectory, { recursive: true });

  return multer({
    storage: multer.diskStorage({
      destination: (_request, _file, done) => done(null, uploadDirectory),
      filename: (_request, file, done) => done(null, `${prefix}-${Date.now()}-${randomUUID()}${extensionsByMimeType[file.mimetype]}`)
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_request, file, done) => {
      if (extensionsByMimeType[file.mimetype]) return done(null, true);
      const error = new Error(`La imagen de ${label} debe ser JPG, PNG o WEBP`);
      error.status = 400;
      return done(error);
    }
  });
}
