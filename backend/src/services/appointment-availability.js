import { isSlotAvailable } from '../domain/availability.js';
import { barberDayRange, zonedParts } from '../config/time.js';

const activeStatuses = ['PENDING', 'CONFIRMED'];

export function sqlDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export async function loadAvailability(connection, barberId, serviceId, startAt, endAt) {
  const weekday = zonedParts(startAt).weekday;
  const [serviceRows] = await connection.execute(
    `SELECT s.id, s.duration_minutes AS durationMinutes, s.price
     FROM services s JOIN barber_services bs ON bs.service_id = s.id
     WHERE s.id = ? AND s.is_active = TRUE AND bs.barber_id = ?`,
    [serviceId, barberId]
  );
  if (serviceRows.length === 0) return { service: null, workingHours: [], blocks: [], appointments: [] };

  const [workingHours] = await connection.execute(
    `SELECT weekday, TIME_TO_SEC(start_time) DIV 60 AS start_minutes,
            TIME_TO_SEC(end_time) DIV 60 AS end_minutes
     FROM barber_working_hours
     WHERE barber_id = ? AND weekday = ? AND is_active = TRUE`,
    [barberId, weekday]
  );
  const [blocks] = await connection.execute(
    `SELECT starts_at, ends_at FROM schedule_blocks
     WHERE barber_id = ? AND starts_at < ? AND ends_at > ?`,
    [barberId, sqlDateTime(endAt), sqlDateTime(startAt)]
  );
  const [appointments] = await connection.execute(
    `SELECT id, starts_at, ends_at FROM appointments
     WHERE barber_id = ? AND status IN (?, ?) AND starts_at < ? AND ends_at > ?`,
    [barberId, ...activeStatuses, sqlDateTime(endAt), sqlDateTime(startAt)]
  );
  return { service: serviceRows[0], workingHours, blocks, appointments };
}

export async function loadMultiAvailability(connection, barberId, serviceIds, startAt, endAt) {
  const uniqueServiceIds = [...new Set(serviceIds)];
  const base = await loadAvailability(connection, barberId, uniqueServiceIds[0], startAt, endAt);
  if (!base.service) return { ...base, services: null, durationMinutes: 0 };
  const placeholders = uniqueServiceIds.map(() => '?').join(', ');
  const [services] = await connection.execute(
    `SELECT s.id, s.duration_minutes AS durationMinutes, s.price
     FROM services s JOIN barber_services bs ON bs.service_id = s.id
     WHERE s.id IN (${placeholders}) AND s.is_active = TRUE AND bs.barber_id = ?`,
    [...uniqueServiceIds, barberId]
  );
  if (services.length !== uniqueServiceIds.length) return { ...base, services: null, durationMinutes: 0 };
  const byId = new Map(services.map((service) => [String(service.id), service]));
  const orderedServices = uniqueServiceIds.map((id) => byId.get(String(id)));
  return { ...base, services: orderedServices, durationMinutes: orderedServices.reduce((total, service) => total + service.durationMinutes, 0) };
}

// Shared by the booking endpoint and the recommender so a suggested time always
// goes through the same working-hour, block and overlap rules as a real booking.
export async function findAvailableSlotsForDate(connection, { barberId, serviceIds, date }) {
  const { start: dayStart, end: dayEnd } = barberDayRange(date);
  const availability = await loadMultiAvailability(connection, barberId, serviceIds, dayStart, dayEnd);
  if (!availability.services) return null;

  const slots = [];
  for (let minute = 0; minute < 24 * 60; minute += 15) {
    const startAt = new Date(dayStart.getTime() + minute * 60_000);
    const endAt = new Date(startAt.getTime() + availability.durationMinutes * 60_000);
    if (isSlotAvailable({ ...availability, startAt, endAt }).available) {
      slots.push({ startsAt: startAt.toISOString(), endsAt: endAt.toISOString() });
    }
  }
  return slots;
}
