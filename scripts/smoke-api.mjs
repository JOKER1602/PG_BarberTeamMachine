const baseUrl = (process.env.API_URL ?? 'http://localhost:3002/api').replace(/\/$/, '');

const checks = [
  {
    name: 'la API responde en salud',
    path: '/health',
    expectedStatus: 200,
    validate: (body) => body?.ok === true
  },
  {
    name: 'las rutas inexistentes responden 404',
    path: '/ruta-que-no-existe',
    expectedStatus: 404,
    validate: (body) => typeof body?.message === 'string'
  },
  {
    name: 'el panel administrativo exige autenticación',
    path: '/admin/dashboard',
    expectedStatus: 401,
    validate: (body) => body?.message === 'Autenticacion requerida'
  }
];

let failures = 0;
for (const check of checks) {
  try {
    const response = await fetch(`${baseUrl}${check.path}`, {
      method: check.method ?? 'GET',
      headers: check.body ? { 'Content-Type': 'application/json' } : undefined,
      body: check.body ? JSON.stringify(check.body) : undefined
    });
    const body = await response.json();
    if (response.status !== check.expectedStatus || !check.validate(body)) {
      failures += 1;
      console.error(`✗ ${check.name}: se esperaba ${check.expectedStatus}, se recibió ${response.status}`);
    } else {
      console.log(`✓ ${check.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`✗ ${check.name}: no se pudo conectar a ${baseUrl} (${error.message})`);
  }
}

if (failures) {
  console.error(`\nSmoke test finalizó con ${failures} fallo(s). Asegúrate de ejecutar npm run dev antes de probar.`);
  process.exitCode = 1;
} else {
  console.log(`\nSmoke test aprobado: ${checks.length}/${checks.length} verificaciones correctas.`);
}
