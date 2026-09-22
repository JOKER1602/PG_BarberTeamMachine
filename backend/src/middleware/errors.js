export function notFound(request, response) {
  response.status(404).json({ message: `Ruta no encontrada: ${request.method} ${request.originalUrl}` });
}

export function handleError(error, _request, response, _next) {
  console.error(error);
  response.status(500).json({ message: 'Error interno del servidor' });
}
