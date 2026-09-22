export function overlaps(startA, endA, startB, endB) {
  return new Date(startA) < new Date(endB) && new Date(endA) > new Date(startB);
}

export function isWithinWorkingHours(startAt, endAt, workingHours) {
  const start = zonedParts(startAt);
  const end = zonedParts(endAt);
  if (start.weekday !== end.weekday) return false;

  return workingHours.some((schedule) => (
    schedule.weekday === start.weekday
    && start.minutes >= schedule.start_minutes
    && end.minutes <= schedule.end_minutes
  ));
}

export function isSlotAvailable({ startAt, endAt, workingHours, blocks, appointments }) {
  if (!isWithinWorkingHours(startAt, endAt, workingHours)) {
    return { available: false, reason: 'Fuera del horario laboral' };
  }
  if (blocks.some((block) => overlaps(startAt, endAt, block.starts_at, block.ends_at))) {
    return { available: false, reason: 'Horario bloqueado' };
  }
  if (appointments.some((appointment) => overlaps(startAt, endAt, appointment.starts_at, appointment.ends_at))) {
    return { available: false, reason: 'El horario ya esta ocupado' };
  }

  return { available: true };
}
import { zonedParts } from '../config/time.js';
