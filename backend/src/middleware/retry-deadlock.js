// Reintenta una ruta transaccional cuando PostgreSQL la elige como víctima de un
// deadlock (código 40P01). La transacción ya quedó anulada, así que repetirla
// es seguro: la alternativa sería responder un error 500 por un choque pasajero.
//
// Solo para rutas cuyo trabajo ocurre entero dentro de una transacción y que
// no envían respuesta antes de confirmar.
const isDeadlock = (error) => error?.code === '40P01';

export function retryOnDeadlock(handler, { attempts = 3, baseDelayMs = 25 } = {}) {
  return async function retryingHandler(request, response, next) {
    for (let attempt = 1; ; attempt += 1) {
      let forwarded = false;
      let failure;
      try {
        await handler(request, response, (error) => { forwarded = true; failure = error; });
      } catch (error) {
        forwarded = true;
        failure = error;
      }
      if (!forwarded) return undefined;
      if (isDeadlock(failure) && attempt < attempts && !response.headersSent) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt + Math.random() * baseDelayMs));
        continue;
      }
      return next(failure);
    }
  };
}
