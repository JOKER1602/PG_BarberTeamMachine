export const BARBER_TIME_ZONE = 'America/La_Paz';
// Bolivia no aplica horario de verano: el desfase es fijo.
const BARBER_UTC_OFFSET = '-04:00';

// Expresión SQL que convierte una columna TIMESTAMPTZ a la hora local de la barbería.
export function localSqlTime(column) {
  return `(${column} AT TIME ZONE '${BARBER_TIME_ZONE}')`;
}

function sqlUtc(date) {
  return date.toISOString();
}

// Convierte filtros de fecha local (YYYY-MM-DD) en límites UTC para SQL:
// desde el inicio de dateFrom hasta antes del inicio del día siguiente a dateTo.
export function localDateFilterBounds({ dateFrom, dateTo }) {
  return {
    from: dateFrom ? sqlUtc(barberDayRange(dateFrom).start) : null,
    toExclusive: dateTo ? sqlUtc(new Date(barberDayRange(dateTo).start.getTime() + 24 * 60 * 60_000)) : null
  };
}

export function zonedParts(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BARBER_TIME_ZONE,
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const weekdays = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { weekday: weekdays[get('weekday')], minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

// Cochabamba does not observe daylight saving time. Timestamps remain UTC;
// this only constructs a barber's local calendar-day boundaries.
export function barberDayRange(date) {
  return {
    start: new Date(`${date}T00:00:00${BARBER_UTC_OFFSET}`),
    end: new Date(`${date}T23:59:59.999${BARBER_UTC_OFFSET}`)
  };
}
