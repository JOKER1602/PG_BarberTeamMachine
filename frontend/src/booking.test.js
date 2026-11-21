import { describe, expect, it } from 'vitest';
import { barbersForServices, firstAvailableDate, servicesWithoutProfessionals, wizardStepLabel } from './booking.js';

const services = [{ id: 1, name: 'Corte a tijera' }, { id: 2, name: 'Corte normal' }, { id: 3, name: 'Barba' }];
const barbers = [{ id: 7, displayName: 'Marin', services: 'Corte normal, Barba' }, { id: 8, displayName: 'Leo', services: 'Barba' }];

describe('flujo de reserva', () => {
  it('detecta los servicios que ningún profesional realiza', () => {
    expect([...servicesWithoutProfessionals(services, barbers)]).toEqual(['1']);
    expect([...servicesWithoutProfessionals(services, [])]).toEqual(['1', '2', '3']);
  });

  it('filtra profesionales que realizan todos los servicios elegidos', () => {
    expect(barbersForServices(barbers, [services[2]]).map((b) => b.id)).toEqual([7, 8]);
    expect(barbersForServices(barbers, [services[1], services[2]]).map((b) => b.id)).toEqual([7]);
    expect(barbersForServices(barbers, [services[0]])).toEqual([]);
  });

  it('elige el primer día con horarios', () => {
    expect(firstAvailableDate([{ date: '2026-11-21', slots: 0 }, { date: '2026-11-22', slots: 0 }, { date: '2026-11-23', slots: 12 }])).toBe('2026-11-23');
    expect(firstAvailableDate([{ date: '2026-11-21', slots: 0 }])).toBeNull();
  });

  it('describe el paso actual para el celular', () => {
    expect(wizardStepLabel(1)).toBe('Paso 1 de 3 · Servicios');
    expect(wizardStepLabel(2)).toBe('Paso 2 de 3 · Detalles');
    expect(wizardStepLabel(9)).toBe('Paso 3 de 3 · Confirma');
  });
});
