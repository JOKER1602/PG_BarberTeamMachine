// Reglas de presentación del flujo de reserva, separadas de los componentes
// para poder probarlas sin navegador.

// Un profesional realiza un servicio si lo tiene en su lista de servicios
// (la API la envía como texto: "Corte normal, Barba").
function performs(barber, service) {
  return String(barber?.services ?? '').toLowerCase().includes(String(service?.name ?? '').toLowerCase());
}

// Profesionales que realizan TODOS los servicios elegidos.
export function barbersForServices(barbers, services) {
  return (barbers ?? []).filter((barber) => (services ?? []).every((service) => performs(barber, service)));
}

// Ids (texto) de los servicios que ningún profesional realiza: no se pueden
// reservar y se avisan antes de elegirlos.
export function servicesWithoutProfessionals(services, barbers) {
  return new Set((services ?? []).filter((service) => !(barbers ?? []).some((barber) => performs(barber, service))).map((service) => String(service.id)));
}

// Primer día con horarios libres según GET /availability/days.
export function firstAvailableDate(days) {
  return (days ?? []).find((day) => day.slots > 0)?.date ?? null;
}

export const WIZARD_STEPS = Object.freeze(['Servicios', 'Detalles', 'Confirma']);

// "Paso 2 de 3 · Detalles" para el indicador compacto del celular.
export function wizardStepLabel(step) {
  const index = Math.min(Math.max(Number(step) || 1, 1), WIZARD_STEPS.length);
  return `Paso ${index} de ${WIZARD_STEPS.length} · ${WIZARD_STEPS[index - 1]}`;
}
