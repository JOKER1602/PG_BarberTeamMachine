export function notFound(request, response) {
  response.status(404).json({ message: `Ruta no encontrada: ${request.method} ${request.originalUrl}` });
}

export function handleError(error, _request, response, _next) {
  if (error.code === 'LIMIT_FILE_SIZE') return response.status(400).json({ message: 'La foto no puede superar 5 MB' });
  if (error.status) return response.status(error.status).json({ message: error.message });
  console.error(error);
  response.status(500).json({ message: 'Error interno del servidor' });
}
