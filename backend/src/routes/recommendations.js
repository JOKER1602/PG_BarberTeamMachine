import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { BARBER_TIME_ZONE, zonedParts } from '../config/time.js';
import { requireAuth } from '../middleware/auth.js';
import { findAvailableSlotsForDate } from '../services/appointment-availability.js';

const router = Router();
const querySchema = z.object({
  serviceIds: z.string().regex(/^\d+(,\d+)*$/).optional(),
  days: z.coerce.number().int().min(1).max(21).default(14)
});

function barberDateAfter(offset) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BARBER_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offset)).toISOString().slice(0, 10);
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = String(key(item));
    counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  }, new Map());
}

router.get('/', requireAuth, async (request, response, next) => {
  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) return response.status(400).json({ message: 'Parámetros de recomendación inválidos' });

  const serviceIds = parsed.data.serviceIds ? [...new Set(parsed.data.serviceIds.split(',').map(Number))] : [];
  const connection = await pool.getConnection();
  try {
    const [history] = await connection.execute(
      `SELECT a.service_id AS serviceId, a.barber_id AS barberId, a.starts_at AS startsAt,
              s.name AS serviceName, s.price, s.duration_minutes AS durationMinutes,
              b.display_name AS barberName
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN barbers b ON b.id = a.barber_id
       WHERE a.client_id = ? AND a.status = 'COMPLETED'
       ORDER BY a.starts_at DESC LIMIT 100`,
      [request.auth.sub]
    );

    const historyServiceCounts = countBy(history, (item) => item.serviceId);
    const historyServices = [...new Map(history.map((item) => [String(item.serviceId), item])).values()]
      .sort((left, right) => (historyServiceCounts.get(String(right.serviceId)) ?? 0) - (historyServiceCounts.get(String(left.serviceId)) ?? 0))
      .filter((item) => !serviceIds.includes(Number(item.serviceId)))
      .slice(0, 3)
      .map((item) => ({
        id: item.serviceId,
        name: item.serviceName,
        price: Number(item.price),
        durationMinutes: item.durationMinutes,
        reason: `Lo elegiste ${historyServiceCounts.get(String(item.serviceId))} ${historyServiceCounts.get(String(item.serviceId)) === 1 ? 'vez' : 'veces'}`
      }));

    let serviceSuggestions = historyServices;
    if (serviceSuggestions.length < 3) {
      const excluded = [...serviceIds, ...serviceSuggestions.map((item) => Number(item.id))];
      const clause = excluded.length ? `AND s.id NOT IN (${excluded.map(() => '?').join(', ')})` : '';
      const [popular] = await connection.execute(
        `SELECT s.id, s.name, s.price, s.duration_minutes AS durationMinutes, COUNT(a.id) AS bookings
         FROM services s
         LEFT JOIN appointments a ON a.service_id = s.id AND a.status = 'COMPLETED'
         WHERE s.is_active = TRUE ${clause}
         GROUP BY s.id ORDER BY bookings DESC, s.name LIMIT ${Number(3 - serviceSuggestions.length)}`,
        // LIMIT va como entero literal: algunas versiones de MySQL 8 rechazan
        // un LIMIT parametrizado en sentencias preparadas (pool.execute).
        excluded
      );
      serviceSuggestions = [...serviceSuggestions, ...popular.map((item) => ({
        id: item.id, name: item.name, price: Number(item.price), durationMinutes: item.durationMinutes,
        reason: 'Servicio popular entre nuestros clientes'
      }))];
    }

    if (!serviceIds.length) return response.json({ serviceSuggestions, timeSuggestions: [], basedOnHistory: history.length > 0 });

    const servicePlaceholders = serviceIds.map(() => '?').join(', ');
    const [compatibleBarbers] = await connection.execute(
      `SELECT b.id, b.display_name AS displayName
       FROM barbers b JOIN barber_services bs ON bs.barber_id = b.id
       WHERE b.is_active = TRUE AND bs.service_id IN (${servicePlaceholders})
       GROUP BY b.id HAVING COUNT(DISTINCT bs.service_id) = ?
       ORDER BY b.display_name`,
      [...serviceIds, serviceIds.length]
    );

    const barberCounts = countBy(history, (item) => item.barberId);
    const weekdayCounts = countBy(history, (item) => zonedParts(item.startsAt).weekday);
    const hourCounts = countBy(history, (item) => Math.floor(zonedParts(item.startsAt).minutes / 60));
    const candidates = [];
    for (let dayOffset = 0; dayOffset < parsed.data.days; dayOffset += 1) {
      const date = barberDateAfter(dayOffset);
      for (const barber of compatibleBarbers) {
        const slots = await findAvailableSlotsForDate(connection, { barberId: barber.id, serviceIds, date });
        for (const slot of (slots ?? []).slice(0, 8)) {
          const timing = zonedParts(slot.startsAt);
          const barberVisits = barberCounts.get(String(barber.id)) ?? 0;
          const weekdayVisits = weekdayCounts.get(String(timing.weekday)) ?? 0;
          const hourVisits = hourCounts.get(String(Math.floor(timing.minutes / 60))) ?? 0;
          const score = (barberVisits * 40) + (weekdayVisits * 12) + (hourVisits * 8) - (dayOffset * 3);
          const reason = barberVisits
            ? `Con ${barber.displayName}, uno de tus profesionales frecuentes`
            : (weekdayVisits || hourVisits) ? 'Cercano a tu día u horario habitual' : 'Próxima disponibilidad real';
          candidates.push({ ...slot, barberId: barber.id, barberName: barber.displayName, score, reason });
        }
      }
    }

    const timeSuggestions = candidates
      .sort((left, right) => right.score - left.score || new Date(left.startsAt) - new Date(right.startsAt))
      .slice(0, 4)
      .map(({ score, ...suggestion }) => suggestion);
    return response.json({ serviceSuggestions, timeSuggestions, basedOnHistory: history.length > 0 });
  } catch (error) {
    return next(error);
  } finally {
    connection.release();
  }
});

export default router;
