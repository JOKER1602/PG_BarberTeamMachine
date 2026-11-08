# Transferencia integral para otro asistente de IA

> **Propósito de este documento:** permitir que otra IA, desarrollador o revisor comprenda el proyecto sin conocer la conversación previa. Describe el estado real del repositorio al 5 de noviembre de 2026. No contiene secretos, contraseñas, tokens, correos privados ni datos de prueba sensibles.

## 1. Resumen ejecutivo

**Empyrean Studio** es un sistema web de reservas para barberías. Permite que clientes consulten servicios y profesionales, elijan una fecha/hora realmente disponible, paguen un anticipo mediante QR, suban un comprobante y reciban la confirmación después de una revisión administrativa. Incluye áreas diferenciadas para cliente, barbero y administrador, recordatorios, reseñas, recomendaciones deterministas, asistente de reservas, analítica y reportes.

El proyecto nació como caso de estudio para una barbería de Cochabamba, Bolivia. El nombre anterior era **Barber Team Machine**; el nombre vigente visible al usuario es **Empyrean Studio**.

**Estado funcional actual:** es una aplicación funcional de una sola barbería (*single tenant*) con base de datos MySQL local. La base SaaS multiempresa fue diseñada y tiene una migración preparada, pero **no está implementada ni aplicada todavía**. No se debe anunciar ni desplegar como SaaS multiempresa hasta completar esa conversión.

## 2. Problema que resuelve

La barbería gestionaba reservas por WhatsApp, llamadas y redes sociales. Eso generaba verificación manual de horarios, potenciales cruces de citas, dificultad de seguimiento, poca trazabilidad de pagos, falta de historial de clientes y baja visibilidad administrativa.

El sistema centraliza:

- catálogo de servicios, precio y duración;
- profesionales, servicios que realizan, horario laboral y permisos/bloqueos;
- reservas, reprogramaciones, cancelaciones, inasistencias y atención completada;
- pagos manuales por QR con comprobante;
- historial del cliente y agenda de cada barbero;
- métricas, reportes, recordatorios y reseñas verificadas.

## 3. Stack técnico y estructura

| Capa | Tecnología / ubicación |
|---|---|
| Frontend | React + Vite + CSS propio en `frontend/` |
| Backend | Node.js + Express en `backend/` |
| Base de datos | MySQL 8+; scripts en `database/` |
| Autenticación | JWT firmado, guardado exclusivamente en cookie `HttpOnly` |
| Archivos actuales | Disco local `backend/uploads/` (transitorio; no apto para SaaS escalable) |
| Correo | Nodemailer / SMTP para recuperación y recordatorios |
| WhatsApp | Meta WhatsApp Cloud API o Twilio, seleccionable por variables de entorno |
| Pruebas | Node test runner + Vitest; smoke test opcional con k6 |

Estructura principal:

```text
BARBER TEAM MACHINE_PG/
├─ frontend/
│  ├─ src/App.jsx                 enrutamiento simple basado en window.location
│  ├─ src/api.js                  cliente HTTP con cookies
│  ├─ src/pages/                  páginas de interfaz
│  └─ src/styles.css              estilos globales
├─ backend/
│  ├─ src/app.js                  Express, CORS, cabeceras y rutas
│  ├─ src/server.js               arranque y recordatorios
│  ├─ src/routes/                 endpoints REST
│  ├─ src/services/               correo, WhatsApp, IA/agenda
│  ├─ src/domain/availability.js  reglas de tiempo y cruces
│  └─ test/                       pruebas backend
├─ database/                      esquema y migraciones SQL
├─ docs/                          arquitectura, pruebas y despliegue
├─ scripts/                       smoke test y utilidades
└─ package.json                   workspaces y scripts raíz
```

## 4. Ejecución local

1. Crear `backend/.env` a partir de `backend/.env.example`.
2. Crear y poblar MySQL con los scripts indicados por `database/README.md`.
3. Desde la raíz ejecutar:

   ```bash
   npm install
   npm run dev
   ```

4. Frontend: `http://localhost:5173`.
5. API: `http://localhost:3002/api/health` en el entorno local actual.

Verificación completa:

```bash
npm run verify
```

La última ejecución conocida pasó: 23 pruebas backend aprobadas, 1 smoke test omitido por limitación de loopback del sandbox, 6 pruebas frontend aprobadas y build Vite exitoso.

## 5. Interfaz y rutas web actuales

No se usa React Router. `frontend/src/App.jsx` decide qué página mostrar mediante `window.location.pathname`. Cada barbería vive bajo `/t/:slug` (rama `saas/incremento-2`).

| Ruta | Página | Finalidad |
|---|---|---|
| `/t/:slug` | `HomePage.jsx` | Inicio público, servicios, información, login/registro modal |
| `/t/:slug/reservar` | `BookingPage.jsx` | Catálogo público, equipo, asistente y acceso a reserva |
| `/t/:slug/reservar/cita` | `ReservationWizard.jsx` | Flujo de reserva: servicio, profesional, fecha/hora, QR y confirmación |
| `/t/:slug/mi-cuenta?tab=historial` | `ClientArea.jsx` | Perfil, próximas citas, historial, reseñas y cambios permitidos |
| `/t/:slug/admin` | `AdminPortal.jsx` | Administración de esa barbería (OWNER/ADMIN) |
| `/t/:slug/barbero` | `BarberPortal.jsx` | Agenda y acciones del barbero (BARBER de esa barbería) |
| `/recuperar-contrasena` | `PasswordRecoveryPage.jsx` | Global: solicitud y restablecimiento de contraseña |

- Las rutas antiguas sin slug (`/`, `/reservar`, `/admin`, ...) redirigen a la misma ruta de `VITE_DEFAULT_TENANT_SLUG` (por defecto `empyrean-studio`), conservando consulta y ancla.
- Antes de mostrar una barbería se consulta `GET /api/t/:slug`: si no existe se muestra «No encontramos esta barbería»; si está suspendida, «no disponible temporalmente».
- `frontend/src/tenant.js` concentra el contexto: `tenantHref()` para todo enlace interno, `currentTenantSlug()`, y `accessRoleFor()`/`withTenantRole()`, que calculan el **rol efectivo en la barbería de la URL** a partir de las membresías que devuelve `/api/auth/me` (`OWNER`/`ADMIN` → `ADMINISTRADOR`, `BARBER` → `BARBERO`, si no → `CLIENTE` solo para cuentas de cliente). Las páginas siguen comparando esos tres nombres; `user.globalRole` guarda el rol de la cuenta.
- `frontend/src/api.js` antepone `/t/:slug` a las llamadas de negocio; `/api/auth` es global.
- Las rutas protegidas (`/mi-cuenta`, `/admin`, `/barbero`) validan la sesión con `/api/auth/me` y el rol efectivo en esa barbería. Al cerrar sesión se llama a `POST /api/auth/logout` y se vuelve al inicio de la misma barbería.
- **Despliegue:** el servidor del frontend debe devolver `index.html` para `/t/*` (SPA fallback); Vite lo hace en desarrollo.

## 6. Roles actuales (single tenant)

Los roles existentes son globales y se almacenan en `users.role_id`:

- `CLIENTE`: se registra, mantiene perfil, reserva, paga anticipo, consulta/cancela/reprograma citas futuras, ve historial y publica reseñas después de una cita atendida.
- `ADMINISTRADOR`: administra una única barbería: servicios, categorías, barberos, horarios, permisos, cuentas de barbero, agenda, pagos, configuración, reportes y usuarios.
- `BARBERO`: tiene cuenta creada por administración; ve exclusivamente su agenda y puede marcar una cita confirmada como atendida, cancelada o inasistente.

El JWT solo contiene la identidad (`sub`); `requireAuth` lee en cada petición el rol vigente y si la cuenta sigue activa. En SaaS, el rol del personal se resolverá por **membresía de tenant** (`requireTenantMembership`), no por `users.role_id`.

## 7. Flujo principal de reservas y pagos

1. El visitante entra a `/reservar`, consulta servicios y profesionales.
2. Selecciona uno o varios servicios, un barbero, día y horario.
3. El backend calcula disponibilidad real en zona horaria `America/La_Paz`.
4. El cliente inicia sesión o se registra.
5. Si aún no posee teléfono y consentimiento, se muestra una ventana para añadir el número y aceptar recordatorios de WhatsApp. Debe aparecer solo la primera vez mientras el perfil no tenga esa información.
6. En “Revisar y confirmar”, se muestra el QR y se cobra **50% del total** como anticipo.
7. El cliente sube un comprobante JPG, PNG o WEBP (máximo configurado en middleware).
8. La reserva se registra como pendiente de revisión de anticipo; no se confirma automáticamente.
9. Administración revisa el comprobante desde el módulo de pagos y aprueba o rechaza.
10. Si aprueba, la cita pasa a `CONFIRMED` y se programan recordatorios. Si rechaza/cancela, el cliente recibe el estado correspondiente y ve indicación de contacto.
11. El barbero solo opera citas `CONFIRMED` y puede marcarlas `COMPLETED`, `CANCELLED` o `NO_SHOW`.
12. Después de `COMPLETED`, el cliente puede dejar una reseña verificada, máximo una por cita.

Política visible actual: el anticipo confirma la reserva; si el cliente no asiste no hay devolución. El saldo se paga presencialmente. Debe revisarse con el negocio y legislación aplicable antes de producción comercial.

## 8. Estados importantes

### Citas

```text
PENDING     = anticipo/comprobante en revisión
CONFIRMED   = pago aprobado y cita activa
COMPLETED   = atención realizada
CANCELLED   = cancelada
NO_SHOW     = cliente no asistió
```

`PENDING` se comunica en interfaz como “Anticipo en revisión” o equivalente, no como una confirmación final.

### Recordatorios

```text
PENDING | SENT | FAILED | CANCELLED
```

Canales actuales: `EMAIL`, `IN_APP`, `WHATSAPP`; tipos: `24H` y `2H`. El recordatorio de WhatsApp se programa dos horas antes, exige consentimiento y cita confirmada. El worker aplica bloqueo MySQL (`GET_LOCK`) para impedir envíos duplicados si hay más de una instancia de API.

## 9. Reglas de negocio críticas

- Las fechas se almacenan en UTC y se muestran/calculan para Cochabamba (`America/La_Paz`).
- No hay doble reserva parcial o total para el mismo barbero: se valida solapamiento por intervalo, no solo igualdad de hora.
- El servicio no puede sobrepasar el fin del horario laboral ni cruzar al día siguiente.
- Se descartan bloques de descanso/permiso y horarios ya pasados del día actual.
- Horarios adyacentes son válidos; horarios superpuestos no.
- Reprogramar o cancelar por el cliente está restringido a citas futuras.
- Un barbero desactivado no aparece para nuevas reservas ni puede usar su acceso.
- Solo el administrador puede ver un comprobante privado.
- Cada comprobante de pago pertenece al cliente que lo subió y se usa una sola vez.
- Las recomendaciones y el asistente no crean citas ni evitan las validaciones reales del backend.

La lógica central de agenda está en:

- `backend/src/domain/availability.js`
- `backend/src/services/appointment-availability.js`

## 10. Funcionalidades implementadas

### Autenticación y perfil

- Registro de cliente con nombre, apellido, email único, celular boliviano de 8 dígitos y contraseña segura.
- Validaciones visuales de formularios, incluyendo error/éxito y ojo para mostrar contraseña.
- Login único; redirección por rol a área cliente, administración o barbero.
- Logout real por API; el botón Atrás no debe recuperar permisos porque la cookie se elimina y las rutas se revalidan.
- Recuperación por email con token aleatorio, hash SHA-256 en base de datos y expiración de 30 minutos.
- Cambio de contraseña en perfil y primer acceso de barbero con contraseña temporal.
- Perfil de cliente y preferencia de recordatorio WhatsApp.

### Servicios y categorías

- Crear, editar, desactivar/eliminar servicios.
- Precio, duración, descripción y categoría.
- Categorías dinámicas para no depender de nombres como “Corte” o “Barba”.
- Catálogo público y filtro por categoría.

### Barberos y agenda

- Crear/editar barbero, descripción, foto, servicios asociados.
- Creación de acceso de barbero mediante contraseña temporal.
- Horarios laborales por día de la semana.
- Permisos/descansos por intervalo, validando que no se elijan fechas pasadas.
- Activar/desactivar profesional con confirmación modal; desactivar bloquea su acceso y retiro de reservas públicas.
- Ficha administrativa por pestañas: perfil, servicios, horario, permisos y acceso.

### Citas

- Reserva de múltiples servicios mediante `POST /api/appointments/multi`.
- Disponibilidad por servicio(s), profesional y fecha.
- Historial, próxima cita, reprogramación, cancelación, repetir reserva.
- Administración de estado, motivos, notas internas y trazabilidad (`cancelled_at`, `completed_at`, `updated_by`).
- Agenda y acciones del barbero sobre sus propias citas.

### Pagos QR

- QR configurado por administración.
- Upload del comprobante.
- Revisión manual por administración.
- Un mismo pago puede agrupar servicios/citas relacionados por `payment_reference`.
- Comprobantes nuevos protegidos: tabla `payment_proofs`, relación con propietario, consumo único y endpoint administrativo autenticado.

### Reseñas

- Solo reseñas de clientes con cita completada.
- Una reseña por cita.
- Estrellas, comentario y visibilidad.
- Las reseñas públicas pueden mostrarse junto a profesionales/reservas.

### Recomendación y asistente

- Recomendación de servicios desde el historial del cliente o los más solicitados.
- Recomendación de horarios usando preferencias observables y disponibilidad real.
- Asistente basado en reglas/parseo determinista de lenguaje natural; identifica servicio, profesional, fecha y hora en consultas en español.
- **No hay modelo LLM, spaCy, Python, Pandas, NumPy ni scikit-learn implementados actualmente**, aunque el perfil académico los menciona como tecnologías posibles. No afirmar que existe machine learning entrenado.

### Analítica y reportes

- Dashboard con filtros por período, servicio y barbero.
- Indicadores de citas, atención, cancelación, inasistencia, ingresos, ocupación y recurrencia.
- Servicios y horas más demandadas, carga por profesional, evolución diaria.
- Exportación CSV con filtros, resumen y detalle.

## 11. API REST actual

Base local: `http://localhost:3002/api`.

| Grupo | Base | Operaciones destacadas |
|---|---|---|
| Auth | `/auth` | registro, login, logout, sesión, perfil, contraseña, recuperación |
| Servicios | `/services` | catálogo, categorías, CRUD administrativo |
| Barberos | `/barbers` | catálogo, CRUD, foto, servicios, horarios y permisos |
| Citas | `/appointments` | disponibilidad, reserva múltiple, historial, reprogramación, cancelación, agenda admin y estados |
| Barbero | `/barber` | dashboard y cambios de estado de sus propias citas |
| Admin | `/admin` | dashboard, usuarios y cuentas de barbero |
| Pagos | `/payments` | subir comprobante y ver comprobante protegido |
| Settings | `/settings` | datos de negocio y QR |
| Reviews | `/reviews` | listar y crear reseñas verificadas |
| Notifications | `/notifications` | bandeja y lectura |
| Recommendations | `/recommendations` | sugerencias personalizadas |
| Assistant | `/assistant/query` | consulta en lenguaje natural |

Los handlers están en `backend/src/routes/`. Para una lista exacta de verbos y rutas, revisar las declaraciones `router.get/post/patch/put/delete` de esos archivos.

## 12. Esquema de datos actual

Tablas principales de `database/001_initial_schema.sql`:

| Tabla | Uso |
|---|---|
| `roles` | Roles globales actuales |
| `users` | Cuenta, perfil, hash, teléfono, consentimiento y estado activo |
| `password_reset_tokens` | Tokens hash de recuperación con vencimiento/uso |
| `barbers` | Perfil de profesional y posible cuenta vinculada |
| `services` | Catálogo, precio, duración y estado |
| `barber_services` | Relación profesional-servicio |
| `barber_working_hours` | Jornada semanal |
| `schedule_blocks` | Permisos, descansos y bloqueos |
| `appointments` | Cita, estado, pago, notas y trazabilidad |
| `payment_proofs` | Archivo de comprobante privado, dueño y consumo |
| `reviews` | Reseña verificada |
| `business_settings` | Configuración global de una sola barbería |
| `notifications` | Notificaciones internas |
| `reminder_jobs` | Cola y estado de recordatorios |

Migraciones relevantes:

- `007_service_categories.sql`: categorías.
- `009_manual_qr_payments.sql`: cobro QR / pagos manuales.
- `010_whatsapp_reminder_consent.sql`: consentimiento de WhatsApp.
- `011_barber_temporary_password.sql`: primer acceso de barbero.
- `012_secure_payment_proofs.sql`: privacidad de comprobantes.
- `013_saas_foundation.sql`: tablas SaaS (tenants, membresías, operadores de plataforma, configuración por tenant). Solo agrega tablas; segura de aplicar con la API actual.
- `014_tenant_isolation.sql`: `tenant_id` obligatorio en datos operativos. **No aplicar** hasta completar el Incremento 2.

## 13. Seguridad implementada

- Contraseñas con `bcrypt` (factor 12).
- Sesión JWT en cookie `HttpOnly`; el frontend no usa tokens de `localStorage`.
- Cookie `Secure` con `NODE_ENV=production`, `SameSite=Lax` y vencimiento de 2 horas.
- CORS con origen permitido por `FRONTEND_URL`; en producción rechaza otros orígenes.
- Protección de cambios contra origen ajeno además de SameSite.
- Cabeceras: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` y HSTS en producción.
- Límite JSON de 1 MB.
- Validación Zod en rutas relevantes.
- Comprobantes protegidos: no se exponen como archivos estáticos; solo `ADMINISTRADOR` puede obtenerlos por `/api/payments/proofs/:proofId`.
- Validación de roles y propiedad para agenda/operaciones de barbero.
- `.env` debe permanecer fuera de Git.

### Riesgos/puntos pendientes de seguridad

1. Falta limitación de intentos distribuida para login, registro y recuperación de contraseña (usar Redis, proxy o proveedor).
2. Falta almacenamiento externo persistente y privado para archivos; `backend/uploads/` no es válido al escalar o redeplegar.
3. Falta monitoreo de errores, alertas y backups probados.
4. Faltan pruebas de penetración y revisión de privacidad/legal comercial.
5. Todo token de Meta, SMTP o credencial que se haya compartido por chat debe rotarse antes de producción.

## 14. Configuración y variables de entorno

Archivos de referencia:

- `backend/.env.example`: desarrollo.
- `backend/.env.production.example`: producción.
- `frontend/.env.production.example`: frontend desplegado con API separada.

Variables esenciales:

```text
NODE_ENV=production
PORT=3000
TRUST_PROXY=true                  # solo detrás de proxy HTTPS confiable
FRONTEND_URL=https://app.tudominio.com
JWT_SECRET=<aleatorio, mínimo 32 caracteres>
DATABASE_HOST / PORT / NAME / USER / PASSWORD
DATABASE_SSL=true                 # proveedor MySQL administrado con TLS
EMAIL_*                           # SMTP
WHATSAPP_PROVIDER=meta|twilio
META_* o TWILIO_*                 # solo en secretos del proveedor
```

`backend/src/config/environment.js` bloquea el arranque de producción si detecta JWT débil, usuario MySQL `root`, contraseña de DB vacía o `FRONTEND_URL` sin HTTPS.

`frontend/src/api.js` usa el puerto 3002 al ejecutar Vite en desarrollo. En build de producción usa `/api` por defecto, o `VITE_API_URL` si la API queda en otro dominio/subdominio.

## 15. Estado de producción

### Listo o verificado

- Build de frontend exitoso.
- Pruebas de autorización, agenda, asistente, recomendaciones y WhatsApp existentes.
- Sesiones con cookies seguras preparadas.
- Configuración de producción validada al arrancar.
- Migración local aplicada para `payment_proofs`.
- Auditoría offline de dependencias: sin vulnerabilidades conocidas al momento de la revisión.

### No listo aún para producción comercial

- No hay dominio, HTTPS real, nube ni configuración de DNS todavía.
- No hay base MySQL administrada ni backups automatizados.
- Archivos todavía pueden depender de disco local.
- No existe rate limiting distribuido ni observabilidad de producción.
- WhatsApp debe usar número real, plantilla aprobada, consentimiento y token de producción.
- El producto actual no es multiempresa todavía.

Ver también:

- `docs/PRODUCTION_READINESS_AUDIT.md`
- `docs/SAAS_DEPLOYMENT_FOUNDATION.md`
- `docs/MULTITENANCY_ARCHITECTURE.md`

## 16. SaaS multiempresa: estado y diseño objetivo

La decisión vigente es **convertir el producto a SaaS multiempresa antes de publicar**.

Modelo objetivo:

```text
users                         cuentas globales
tenants                       barberías/clientes SaaS
tenant_memberships            relación usuario + barbería + rol
platform_administrators       operadores internos de la plataforma
tenant_settings               configuración pública y cobros de cada barbería
tenant_id                     obligatorio en datos operativos
```

Roles SaaS objetivo:

- `PLATFORM_ADMIN`: operador interno; administra tenants, soporte, planes y suspensiones.
- `OWNER`: dueño de una barbería.
- `ADMIN`: administración de una barbería.
- `BARBER`: profesional de una barbería.
- `RECEPTIONIST`: posible rol futuro.
- Cliente: cuenta global; interactúa con una o más barberías sin mezclas de datos.

Rutas objetivo iniciales:

```text
/t/:slug
/t/:slug/reservar
/t/:slug/admin
/t/:slug/barbero
/platform
```

La migración se dividió en dos (ver `database/README.md`):

- `013_saas_foundation.sql` crea `tenants`, `tenant_memberships`, `platform_administrators`, `tenant_settings`, el tenant inicial `empyrean-studio` y las membresías iniciales. Solo agrega tablas e índices propios: **es segura de aplicar con la API actual** y es idempotente.
- `014_tenant_isolation.sql` añade `tenant_id` obligatorio a los datos operativos (incluidas `service_categories`), re-sincroniza configuración y membresías, y crea índices únicos por tenant. **No ejecutar `014` aún:** la API actual no envía `tenant_id`, así que dejaría de crear citas, servicios, etc. Se despliega junto con el código del Incremento 2, tras backup verificado y ensayo sobre una copia. No es atómica: ante un fallo, restaurar el respaldo.

### Estado del Incremento 1 (completado en código, 6 de noviembre de 2026)

- `backend/src/middleware/tenant.js`:
  - `resolveTenant`: toma el tenant **solo** del slug de la URL (`/api/t/:tenantSlug/...`), valida el formato antes de consultar, responde 404 si no existe o está `CANCELLED` y 403 (`TENANT_SUSPENDED`) si está suspendido. Ignora cualquier `tenant_id` del cuerpo, query o cabeceras.
  - `requireTenantMembership(...roles)`: exige membresía activa en ese tenant y, si se indican, uno de los roles. Sin jerarquía implícita; usar `TENANT_ADMIN_ROLES` (`OWNER`, `ADMIN`) para rutas de administración.
  - `requirePlatformAdmin`: operador interno; **no** concede acceso a datos de barberías.
  - `tenantIdOf(request)`: única fuente del `tenant_id` para consultas; lanza error si la ruta no resolvió el tenant.
- Sesión: el JWT ya **solo contiene `sub`**. `requireAuth` confirma en cada petición que la cuenta esté activa y toma el rol vigente de la base; desactivar un usuario o cambiar su rol tiene efecto inmediato.
- Pruebas en `backend/test/tenant-context.test.js`, incluidos cruces Tenant A → Tenant B.
- **Ninguna ruta usa todavía el middleware de tenant**: la API sigue siendo single-tenant hasta el Incremento 2.
- `013` está **aplicada en la base local de desarrollo** (6 de noviembre de 2026): tenant `empyrean-studio`, 1 `OWNER` y 5 `BARBER`. Respaldo previo con `mysqldump` en `backups/` (carpeta ignorada por Git: contiene datos personales). `tenant_settings` queda vacía hasta `014`, que copia la configuración vigente.

### Estado del Incremento 2 (backend completo, 6 de noviembre de 2026)

**Entorno de desarrollo:** `backend/.env` apunta a la base copia `barber_team_machine_saas`, que tiene `013` y `014` aplicadas. La base original `barber_team_machine` quedó intacta (solo con `013`) y **ya no es compatible con el código**: toda la API exige `tenant_id`. Rama Git: `saas/incremento-2` (main sigue siendo la versión single-tenant).

**Todo el backend está aislado.** Los 11 módulos de negocio (`services`, `barbers`, `settings`, `admin`, `barber`, `appointments`, `payments`, `reviews`, `notifications`, `recommendations`, `assistant`) filtran por `tenantIdOf(request)` y se publican en `/api/t/:tenantSlug/...`; las rutas antiguas `/api/...` atienden a `DEFAULT_TENANT_SLUG`. Solo `/api/auth` y `/api/health` son globales.

**Hecho (paso 4):**
- Citas: disponibilidad (también exige profesional activo), reserva, historial por barbería, agenda admin, reprogramar, cancelar, estados y notas.
- Pagos: el comprobante pertenece a la barbería y se guarda en `uploads/payments/<tenant_id>/`; solo lo abre OWNER/ADMIN de esa barbería. Un comprobante de B no sirve para reservar en A. Los comprobantes anteriores conservan su ruta plana.
- Reseñas, notificaciones (helper `services/notifications.js#notify`, exige tenant) y recordatorios (`schedule/cancelAppointmentReminders` exigen `tenantId`; el worker es global y cada trabajo hereda el tenant de su cita).
- Panel admin y usuarios: métricas por barbería; la lista muestra su personal y los clientes que reservaron ahí. Desactivar a un cliente que también usa otra barbería responde 409 (la cuenta es global); al personal se le desactiva la membresía.
- Portal del barbero: `requireTenantMembership('BARBER')` y sus citas dentro de la barbería.
- Administrar (reprogramar/cancelar cualquier cita, estados) se decide con `isTenantAdmin(request)` (OWNER/ADMIN de la barbería de la URL), no con el rol global.
- Guardia `test/tenant-isolation-routes.test.js`: ejecuta **las 45 rutas** de los 11 módulos con un `tenant_id` ajeno inyectado; falla si una consulta no filtra por el tenant de la URL, si se agrega una ruta o módulo sin cubrir. Encontró y obligó a corregir la cancelación de recordatorios sin filtro de tenant.
- Prueba real sobre la base copia (ciclo completo en una barbería B con accesos desde A): 31/31 — disponibilidad, asistente, comprobante, reserva, aprobación, recordatorios, notificaciones, portal del barbero, atención, reseña, panel, usuarios y recomendaciones aislados. La prueba del paso 3 sigue 20/20.

**Pendiente:**
- ✅ Paso 2 (7 de noviembre de 2026): API y panel de plataforma.
  - `/api/platform/tenants` (GET listar, POST crear, PATCH `/:slug` estado/nombre), solo para `platform_administrators` (`requireAuth` + `requirePlatformAdmin`). El operador **no** ve datos de ninguna barbería: sin membresía recibe 403.
  - Crear una barbería crea también su `tenant_settings` mínimo, 4 categorías por defecto y la membresía `OWNER`. Si el correo del dueño ya tiene cuenta se reutiliza; si no, se crea una cuenta de cliente con contraseña temporal obligatoria (el panel de administración ahora también exige cambiarla: `components/RequiredPasswordChange.jsx`).
  - Estados: `TRIAL`/`ACTIVE` disponibles; `SUSPENDED` → la página responde 403, el personal pierde el panel, desaparece de las membresías de la sesión y no se envían recordatorios; `CANCELLED` → responde como inexistente. Los datos se conservan.
  - Panel `/platform` en el frontend (ruta global): lista, alta con dueño y botones Activar/Suspender/Dar de baja con confirmación.
  - Primer operador: `node scripts/platform-admin.mjs agregar correo@dominio` (también `quitar` y `listar`); la persona debe tener cuenta. Se ejecuta en el servidor.
  - Verificado: pruebas `test/platform.test.js`, prueba real 24/24 (alta, primer acceso del dueño, suspensión, reactivación, baja, accesos ajenos) y el panel en el navegador.
- ~~Paso 5~~ ✅ hecho: frontend con rutas `/t/:slug` y acceso por membresía (ver sección 5). Verificado en el navegador con una segunda barbería: la dueña (cuenta de cliente) entra al panel de su barbería, es cliente en Empyrean y no ve su panel; cerrar sesión y «Atrás» no devuelven el acceso.
- ✅ Marca por barbería (7 de noviembre de 2026): ninguna página, correo ni WhatsApp muestra «Empyrean» fijo.
  - `GET /api/t/:slug` devuelve `brand` (nombre comercial, ciudad, `logoUrl`, `coverUrl`); `App.jsx` lo carga con `setTenantBrand` antes de mostrar la barbería y fija el título de la pestaña.
  - `components/BrandMark.jsx` dibuja el logotipo de dos tonos con el nombre de la barbería; `brandInitials()` da el monograma.
  - Logo y portada por barbería (migración `015_tenant_branding.sql`, columnas `tenant_settings.logo_url`/`cover_url`), subibles desde Administración → Configuración (`POST /settings/brand-image/logo|cover`, archivos en `uploads/brand/`). Sin imagen se muestra un monograma o una portada con el nombre; Empyrean conserva sus imágenes de `/brand/`.
  - Teléfono, dirección y ciudad salen de la configuración de cada barbería (ya no hay datos de Empyrean como respaldo).
  - Correos: recordatorios con el nombre de la barbería de la cita; recuperación de contraseña con la marca de la barbería de origen (`/recuperar-contrasena?t=slug`, y el enlace del correo vuelve a ella) o `PLATFORM_NAME`.
  - Verificado con una segunda barbería sin imágenes y luego con un logo subido desde el panel; Empyrean se ve igual que antes.
- `POST /appointments/multi` y `POST /payments/proof` aún exigen el rol global `CLIENTE`: personal de una barbería no puede reservar como cliente en otra.
- Fotos de barberos y QR siguen en carpetas públicas sin prefijo por tenant.

**Hecho antes (paso 3):**
- `services` (y categorías), `barbers` (servicios asignados, horarios, bloqueos, foto, activación) y `settings` (ahora en `tenant_settings`, incluido el QR) filtran **todas** sus consultas por `tenantIdOf(request)`.
- Se publican en `/api/t/:tenantSlug/...` y, durante la transición, en `/api/...` para la barbería por defecto `DEFAULT_TENANT_SLUG` (por eso el frontend no cambió).
- La administración usa `requireTenantMembership(OWNER, ADMIN)` en lugar del rol global.
- Desactivar un profesional desactiva su membresía; su cuenta global solo se bloquea si no trabaja en otra barbería.
- Crear la cuenta de un barbero crea también su membresía `BARBER`.
- Los recordatorios leen la configuración de `tenant_settings` de la barbería de la cita.
- Pruebas: `test/tenant-isolation-routes.test.js` ejecuta cada ruta de esos módulos y falla si alguna consulta no filtra por el tenant de la URL o usa un `tenant_id` del navegador; también falla si se agrega una ruta sin cubrirla. Se comprobó que detecta un filtro eliminado.
- Prueba real sobre la base copia con dos barberías y dos dueños: 20/20 (lecturas, ediciones, borrados y asignaciones cruzadas rechazados; `tenant_id` inyectado ignorado; suspendida → 403).

**Regla:** toda ruta o módulo nuevo de negocio debe filtrar por `tenantIdOf(request)` y agregarse a la guardia; la prueba falla si no.

### Orden obligatorio de implementación SaaS

1. ✅ Middleware `resolveTenant` y `requireTenantMembership`; sesiones sin rol global fijo.
2. ✅ API de plataforma para crear/activar/suspender tenants (panel `/platform` y `scripts/platform-admin.mjs`).
3. ✅ Aislar servicios, barberos, horarios y bloqueos por `tenant_id` (más configuración y cuentas de barbero).
4. ✅ Aislar citas, cobros, comprobantes, reseñas, notificaciones, recordatorios y analítica (más portal del barbero, asistente y recomendaciones).
5. ✅ Actualizar frontend a rutas `/t/:slug/...` (acceso por membresía; rutas antiguas redirigen a la barbería por defecto).
6. ✅ Añadir pruebas negativas de cruce Tenant A → Tenant B (guardia de 45 rutas + pruebas reales 20/20 y 31/31).
7. Aplicar `014` con backup y ventana de mantenimiento (`013` puede aplicarse antes).
8. Agregar planes, límites, suscripciones, prueba gratuita y facturación.

## 17. Qué NO se debe hacer

- No guardar secretos en código, archivos versionados ni documentación.
- No exponer `uploads/payments` públicamente.
- No confiar en el `tenant_id` enviado por el navegador en la futura API.
- No aplicar la migración 014 antes de que las consultas estén aisladas.
- No leer el rol desde el JWT: el token solo identifica; los permisos se resuelven en la base.
- No afirmar que existe IA entrenada, ML con Python o spaCy: hoy el asistente y recomendaciones son deterministas en Node.js.
- No desplegar con `npm run dev`; usar build de frontend y proceso Node administrado.
- No usar usuario MySQL `root` en producción.
- No reutilizar tokens, contraseñas de aplicación o JWT compartidos por chat.

## 18. Prioridad recomendada para el siguiente asistente

1. Mantener la aplicación single-tenant estable mientras se desarrolla una rama/migración SaaS.
2. ✅ Incremento 1 SaaS y sus pruebas (middleware de tenant, sesión sin rol, migración 013 de fundamentos).
3. Completar Incremento 2 y pruebas de aislamiento cruzado.
4. Hacer backup y simulación de migración sobre una copia de MySQL.
5. Aplicar migraciones 013 y 014 en entorno de staging.
6. Convertir frontend a rutas por tenant y comprobar los tres roles.
7. Solo entonces desplegar infraestructura: dominio, HTTPS, Railway/alternativa, Cloudflare, almacenamiento de objetos, backups y monitorización.

## 19. Preguntas que deben aclararse antes de comercializar

- Nombre y dominio de la plataforma SaaS (no usar una marca exclusiva de Empyrean si será multiservicio).
- Precio de planes, periodo de prueba, límites de barberos/reservas/almacenamiento y moneda de cobro.
- Quién puede crear una barbería: autoservicio, operador interno o ambos.
- Si cada barbería tendrá su propio número de WhatsApp y cuenta Meta, o si la plataforma central enviará recordatorios.
- Proveedor de almacenamiento de archivos y política de retención/borrado de comprobantes.
- Política comercial de anticipos, devoluciones, privacidad y soporte.
- Estrategia de facturación y obligaciones legales/tributarias en Bolivia.

## 20. Documentos complementarios del repositorio

- `docs/ARCHITECTURE.md`: alcance, fases académicas 1–8 y ejecución local.
- `docs/REQUIREMENTS_TRACEABILITY_MATRIX.md`: trazabilidad de requisitos.
- `docs/PHASE_8_TEST_PLAN.md`: pruebas funcionales, integración, rendimiento y usabilidad.
- `docs/PHASE_8_AUTOMATED_EVIDENCE.md`: evidencia de pruebas automáticas.
- `docs/TEST_EXECUTION_RECORD.md`: registro de ejecución de pruebas.
- `docs/WHATSAPP_REMINDERS.md`: configuración de recordatorios.
- `docs/PRODUCTION_READINESS_AUDIT.md`: checklist para producción.
- `docs/SAAS_DEPLOYMENT_FOUNDATION.md`: despliegue y consideraciones SaaS.
- `docs/MULTITENANCY_ARCHITECTURE.md`: decisión y ruta de conversión multiempresa.

---

### Preparación para producción (8 de noviembre de 2026)

Ver **[PRODUCTION_LAUNCH.md](PRODUCTION_LAUNCH.md)**: estado, decisiones del negocio, arquitectura (un servicio Node + MySQL 8 administrado + volumen) y puesta en marcha de las 4 primeras barberías. Resuelto en código: límite de intentos (`middleware/rate-limit.js`), `UPLOADS_DIR`, rutas relativas de archivos (migración 016), API sirviendo el frontend (`SERVE_FRONTEND`), CSP, `/api/health/ready`, cierre ordenado, `Dockerfile`, `npm run db:backup`, `npm run verify:fresh-install`, asignación de dueños a barberías existentes (`POST /api/platform/tenants/:slug/owners`) y dependencias sin vulnerabilidades (bcrypt 6, zod 4).

### Instrucción breve para la siguiente IA

> Continúa el proyecto Empyrean Studio desde el repositorio local. Es una aplicación React/Vite + Express/MySQL funcional para una barbería, con pagos QR manuales, roles, agenda, recordatorios y analítica. La decisión actual es **no publicar aún**: primero implementar SaaS multiempresa de forma segura. Lee `docs/AI_PROJECT_HANDOFF.md`, luego `docs/MULTITENANCY_ARCHITECTURE.md`, El Incremento 1 está hecho (`backend/src/middleware/tenant.js`, JWT solo con identidad, `database/013_saas_foundation.sql`); sigue el Incremento 2. No ejecutes `database/014_tenant_isolation.sql` hasta que backend y frontend filtren absolutamente todos los datos por `tenant_id`. Conserva los módulos ya funcionales y no expongas secretos ni comprobantes de pago.
