export const BARBER_TIME_ZONE = 'America/La_Paz';

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
    start: new Date(`${date}T00:00:00-04:00`),
    end: new Date(`${date}T23:59:59.999-04:00`)
  };
}
