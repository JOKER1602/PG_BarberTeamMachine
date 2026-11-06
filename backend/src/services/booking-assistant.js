import { BARBER_TIME_ZONE } from '../config/time.js';

const weekdays = {
  lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4,
  viernes: 5, sabado: 6, sábado: 6, domingo: 0
};

export function normalizeText(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function barberToday(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: BARBER_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekdayFor(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function extractDate(text, today) {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const short = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
  if (short) return `${short[3] ?? today.slice(0, 4)}-${short[2].padStart(2, '0')}-${short[1].padStart(2, '0')}`;
  if (/pasado manana/.test(text)) return addDays(today, 2);
  if (/manana/.test(text)) return addDays(today, 1);
  if (/hoy/.test(text)) return today;
  const weekday = Object.entries(weekdays).find(([name]) => new RegExp(`\\b${name}\\b`).test(text));
  if (!weekday) return null;
  const target = weekday[1];
  const difference = (target - weekdayFor(today) + 7) % 7;
  return addDays(today, difference || 7);
}

function extractTime(text) {
  const result = text.match(/(?:a\s+las|desde|despues\s+de\s+las|después\s+de\s+las)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?\b/)
    ?? text.match(/\b(\d{1,2})(?::(\d{2}))\s*(a\.?\s*m\.?|p\.?\s*m\.?)\b/);
  if (!result) return null;
  let hour = Number(result[1]);
  const minute = Number(result[2] ?? 0);
  const meridiem = normalizeText(result[3] ?? '');
  if (minute > 59 || hour > 23) return null;
  if (meridiem.startsWith('p') && hour < 12) hour += 12;
  if (meridiem.startsWith('a') && hour === 12) hour = 0;
  if (!meridiem && hour < 8 && /tarde|noche/.test(text)) hour += 12;
  return (hour * 60) + minute;
}

function findService(text, services) {
  const matches = services.map((service) => ({ service, name: normalizeText(service.name) }))
    .filter(({ name }) => name.length >= 3 && text.includes(name));
  if (matches.length) return matches.sort((a, b) => b.name.length - a.name.length)[0].service;
  return services.find((service) => normalizeText(service.name).split(' ').some((word) => word.length >= 4 && text.includes(word))) ?? null;
}

function findBarber(text, barbers) {
  return barbers.find((barber) => {
    const name = normalizeText(barber.displayName);
    const firstName = name.split(' ')[0];
    return (name.length >= 3 && text.includes(name)) || (firstName.length >= 3 && text.includes(firstName));
  }) ?? null;
}

export function interpretBookingRequest(query, { services = [], barbers = [], now = new Date() } = {}) {
  const text = normalizeText(query);
  const today = barberToday(now);
  const service = findService(text, services);
  const barber = findBarber(text, barbers);
  return {
    service,
    barber,
    date: extractDate(text, today),
    preferredMinutes: extractTime(text),
    today
  };
}
