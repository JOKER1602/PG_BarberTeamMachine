import path from 'node:path';

// Carpeta de archivos subidos (fotos, QR, logos y comprobantes privados).
// En producción debe apuntar a un volumen PERSISTENTE (UPLOADS_DIR): el disco
// del contenedor se borra en cada despliegue. Por defecto, backend/uploads.
export const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'));

// URL pública RELATIVA de un archivo subido (/uploads/carpeta/archivo). Se
// guarda sin dominio para que siga funcionando si cambia el dominio o se
// mueve la base a otro servidor.
export function publicUploadUrl(folder, filename) {
  return `/uploads/${folder}/${filename}`;
}

export function uploadsPath(...segments) {
  return path.join(UPLOADS_ROOT, ...segments);
}
