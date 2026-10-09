import { Router } from 'express';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const uploadDirectory = path.resolve(process.cwd(), 'uploads', 'payments');
mkdirSync(uploadDirectory, { recursive: true });
const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const proofUpload = multer({
  storage: multer.diskStorage({ destination: (_request, _file, done) => done(null, uploadDirectory), filename: (_request, file, done) => done(null, `proof-${Date.now()}-${randomUUID()}${extensions[file.mimetype]}`) }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_request, file, done) => extensions[file.mimetype] ? done(null, true) : done(Object.assign(new Error('El comprobante debe ser JPG, PNG o WEBP'), { status: 400 }))
});

router.post('/proof', requireAuth, proofUpload.single('proof'), (request, response) => {
  if (!request.file) return response.status(400).json({ message: 'Selecciona una imagen de comprobante.' });
  const proofUrl = `${request.protocol}://${request.get('host')}/uploads/payments/${request.file.filename}`;
  return response.status(201).json({ proofUrl, message: 'Comprobante cargado.' });
});

export default router;
