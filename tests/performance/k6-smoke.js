import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = __ENV.BASE_URL || 'http://localhost:3002';

export const options = {
  scenarios: {
    smoke: {
      executor: 'per-vu-iterations',
      vus: Number(__ENV.VUS || 1),
      iterations: Number(__ENV.ITERATIONS || 1),
      maxDuration: '30s'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<700'],
    checks: ['rate>0.99']
  }
};

function getJson(path, name) {
  const response = http.get(`${baseUrl}${path}`, {
    tags: { endpoint: name },
    headers: { Accept: 'application/json' }
  });
  check(response, {
    [`${name}: responde 200`]: (result) => result.status === 200,
    [`${name}: responde JSON`]: (result) => String(result.headers['Content-Type'] || '').includes('application/json')
  });
  return response;
}

export default function () {
  getJson('/api/health', 'health');
  const services = getJson('/api/services', 'services');
  const barbers = getJson('/api/barbers', 'barbers');
  getJson('/api/settings', 'settings');
  getJson('/api/reviews', 'reviews');

  const service = services.json('services.0');
  const barber = barbers.json('barbers.0');
  if (service && barber) {
    const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    getJson(
      `/api/appointments/availability?barberId=${barber.id}&serviceId=${service.id}&date=${date}`,
      'availability'
    );
  }

  sleep(1);
}

