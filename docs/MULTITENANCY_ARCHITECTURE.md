# Arquitectura SaaS multiempresa

## Decisión de diseño

El sistema pasa de una barbería única a una plataforma que aloja varias barberías, llamadas **tenants**. Se conserva una cuenta global por persona: un cliente puede reservar en distintas barberías con el mismo correo, pero nunca verá datos de otra empresa.

El primer tenant migrado será `empyrean-studio` y conservará todos los datos actuales.

## Modelo de identidad y permisos

```text
users (cuenta global)
  ├─ tenant_memberships (personal de una barbería)
  │    ├─ OWNER       propietario de la barbería
  │    ├─ ADMIN       administrador de la barbería
  │    ├─ BARBER      profesional de la barbería
  │    └─ RECEPTIONIST (futuro)
  └─ platform_admins (operador interno de la plataforma SaaS)

tenants (barberías)
  ├─ tenant_settings
  ├─ services
  ├─ barbers
  ├─ appointments
  ├─ payments, files, notifications, reviews y reportes
  └─ plan / subscription (siguiente fase)
```

`PLATFORM_ADMIN` no administra por defecto las barberías de los clientes. Puede administrar la plataforma, soporte, planes y suspensiones. `OWNER` administra únicamente su tenant.

## Aislamiento obligatorio

1. Toda entidad de negocio tendrá `tenant_id`.
2. Cada consulta privada verificará una membresía activa de ese tenant antes de leer o escribir.
3. La API no confiará en un `tenant_id` enviado libremente desde el navegador.
4. Los archivos se guardarán con prefijo `tenant_id/...` y los comprobantes seguirán siendo privados.
5. Los índices únicos serán compuestos por tenant: por ejemplo, `UNIQUE(tenant_id, name)` en servicios.
6. Las reservas verificarán que servicio y barbero pertenezcan al mismo tenant antes de crearlas.

## Rutas propuestas

Para la primera versión SaaS se usan rutas por slug, que son fáciles de publicar y probar:

```text
/t/empyrean-studio                 página pública
/t/empyrean-studio/reservar        reservas
/t/empyrean-studio/admin           administración de esa barbería
/t/empyrean-studio/barbero         agenda del profesional
/platform                          operador de la plataforma
```

Más adelante, `slug.tudominio.com` podrá apuntar a las mismas rutas. El slug se resuelve en backend y se valida contra una barbería activa.

## Migración de Empyrean Studio

1. Respaldar MySQL y los archivos `uploads/`.
2. Crear `tenants`, `tenant_memberships`, `tenant_settings` y el tenant inicial `empyrean-studio`.
3. Agregar `tenant_id` a servicios, barberos, citas, bloqueos, reseñas, recordatorios, comprobantes y notificaciones.
4. Migrar todos los registros existentes a Empyrean Studio.
5. Reemplazar las consultas globales por consultas filtradas por tenant.
6. Activar restricciones `NOT NULL`, índices compuestos y llaves foráneas.
7. Publicar frontend con rutas `/t/:slug` y probar aislamiento cruzado antes de habilitar otro tenant.

No se ejecutará una migración parcial en la base activa: durante el cambio se desplegarán en conjunto base de datos, API y frontend.

## Incrementos de implementación

### Incremento 1 — Fundamentos ✅ (013 aplicada en la base local de desarrollo el 6 de noviembre de 2026; respaldo previo en `backups/`)

- tablas de tenants y membresías → `database/013_saas_foundation.sql` (solo agrega tablas, idempotente);
- tenant inicial Empyrean y membresías `OWNER`/`BARBER` desde los roles actuales;
- middleware de resolución de tenant y autorización → `backend/src/middleware/tenant.js` (`resolveTenant`, `requireTenantMembership`, `requirePlatformAdmin`, `tenantIdOf`);
- sesión sin rol fijo en JWT: el token solo lleva `sub`; el rol se lee de la base en cada petición.

Las columnas `tenant_id` se movieron a `database/014_tenant_isolation.sql`, que pertenece al Incremento 2.

### Incremento 2 — Datos operativos aislados (en curso)

Hecho: servicios, categorías, barberos, horarios, bloqueos, configuración y cuentas de barbero, publicados en `/api/t/:tenantSlug/...` y en `/api/...` para `DEFAULT_TENANT_SLUG`. Desarrollo sobre la base copia `barber_team_machine_saas` (013 + 014). Pendiente: citas, cobros, comprobantes, reseñas, notificaciones, recordatorios, analítica y portal del barbero. Detalle en `AI_PROJECT_HANDOFF.md`.

- servicios, barberos, horarios, bloqueos y citas con `tenant_id`;
- disponibilidad y prevención de cruces dentro de la barbería correcta;
- cobros, QR, comprobantes y recordatorios por tenant.

### Incremento 3 — Interfaz SaaS

- URLs con slug;
- panel de propietario de barbería;
- plataforma para crear, activar o suspender tenants;
- cliente conserva historial separado por barbería.

### Incremento 4 — Comercialización

- planes y suscripciones;
- límites por plan;
- facturación y periodos de prueba;
- almacenamiento y mensajería medidos por tenant.

## Criterios de salida antes de vender

- Prueba automatizada: un administrador de Tenant A no puede leer, cambiar ni descargar archivos de Tenant B.
- Prueba automatizada: un barbero solo ve citas de su tenant y asignadas a él.
- Prueba automatizada: una reserva no combina servicio, barbero u horario de dos tenants.
- Backup probado antes y después de la migración.
- Auditoría de accesos y pruebas manuales con al menos dos barberías de prueba.
