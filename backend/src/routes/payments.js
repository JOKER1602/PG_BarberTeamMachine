import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createImageUpload } from '../middleware/image-upload.js';

const router = Router();
const proofUpload = createImageUpload({ folder: 'payments', prefix: 'proof', label: 'comprobante' });

router.post('/proof', requireAuth, proofUpload.single('proof'), (request, response) => {
  if (!request.file) return response.status(400).json({ message: 'Selecciona una imagen de comprobante.' });
  const proofUrl = `${request.protocol}://${request.get('host')}/uploads/payments/${request.file.filename}`;
  return response.status(201).json({ proofUrl, message: 'Comprobante cargado.' });
});

export default router;
