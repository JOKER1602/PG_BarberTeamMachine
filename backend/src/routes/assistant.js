import { Router } from 'express';
import { z } from 'zod';
import pool from '../config/database.js';
import { zonedParts } from '../config/time.js';
import { findAvailableSlotsForDate } from '../services/appointment-availability.js';
import { interpretBookingRequest } from '../services/booking-assistant.js';
import { tenantIdOf } from '../middleware/tenant.js';
import { assistantLimiter } from '../middleware/rate-limit.js';

const router = Router();
const requestSchema = z.object({ query: z.string().trim().min(3).max(400) });

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

router.post('/query', assistantLimiter, async (request, response, next) => {
  const parsed = requestSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: 'Escribe una consulta de al menos tres caracteres.' });
  const tenantId = tenantIdOf(request);
  const connection = await pool.getConnection();
  try {
    // Solo servicios y profesionales de la barbería consultada.
    const [services] = await connection.execute('SELECT id, name, price, duration_minutes AS durationMinutes FROM services WHERE tenant_id = ? AND is_active = TRUE ORDER BY name', [tenantId]);
    const [barbers] = await connection.execute('SELECT id, display_name AS displayName FROM barbers WHERE tenant_id = ? AND is_active = TRUE ORDER BY display_name', [tenantId]);
    const interpretation = interpretBookingRequest(parsed.data.query, { services, barbers });
    if (!interpretation.service) {
      return response.json({
        message: 'Puedo ayudarte a encontrar un horario. Indícame el servicio que deseas, por ejemplo: “corte mañana después de las 4”.',
        interpretation: { serviceName: null, barberName: interpretation.barber?.displayName ?? null, date: interpretation.date, preferredMinutes: interpretation.preferredMinutes },
        suggestions: [],
        services: services.slice(0, 6).map((service) => ({ id: service.id, name: service.name }))
      });
    }

    const compatibleBarbers = interpretation.barber ? [interpretation.barber] : barbers;
    const dates = interpretation.date ? [interpretation.date] : Array.from({ length: 7 }, (_, index) => addDays(interpretation.today, index));
    const candidates = [];
    for (const date of dates) {
      for (const barber of compatibleBarbers) {
        const slots = await findAvailableSlotsForDate(connection, { tenantId, barberId: barber.id, serviceIds: [interpretation.service.id], date });
        for (const slot of slots ?? []) {
          const localMinutes = zonedParts(slot.startsAt).minutes;
          const difference = interpretation.preferredMinutes === null ? 0 : Math.abs(localMinutes - interpretation.preferredMinutes);
          const afterRequested = interpretation.preferredMinutes === null || localMinutes >= interpretation.preferredMinutes;
          candidates.push({ ...slot, barberId: barber.id, barberName: barber.displayName, difference, afterRequested });
        }
      }
    }
    const suggestions = candidates
      .sort((left, right) => Number(right.afterRequested) - Number(left.afterRequested) || left.difference - right.difference || new Date(left.startsAt) - new Date(right.startsAt))
      .slice(0, 3)
      .map(({ difference, afterRequested, ...slot }) => ({
        ...slot,
        serviceId: interpretation.service.id,
        serviceName: interpretation.service.name,
        reason: interpretation.barber
          ? `Con ${interpretation.barber.displayName}`
          : 'Horario disponible con un profesional compatible'
      }));
    const requestedDateText = interpretation.date ? 'para la fecha solicitada' : 'durante los próximos días';
    return response.json({
      message: suggestions.length
        ? `Encontré ${suggestions.length} alternativa(s) ${requestedDateText} para ${interpretation.service.name}.`
        : `No encontré horarios disponibles ${requestedDateText} para ${interpretation.service.name}. Prueba otra fecha, hora o profesional.`,
      interpretation: { serviceName: interpretation.service.name, barberName: interpretation.barber?.displayName ?? null, date: interpretation.date, preferredMinutes: interpretation.preferredMinutes },
      suggestions,
      services: []
    });
  } catch (error) {
    return next(error);
  } finally {
    connection.release();
  }
});

export default router;
