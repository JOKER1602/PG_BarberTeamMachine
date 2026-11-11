# Guía de lanzamiento a producción (SaaS, primeras 4 barberías)

Revisión: 8 de noviembre de 2026, rama `saas/incremento-2`.

**Proveedores elegidos: Railway + Supabase (PostgreSQL) → seguir [DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md)** (pasos exactos, variables y ajustes del panel). Esta guía general explica el porqué y la operación.

Esta guía lleva la plataforma de un entorno local a producción con **4 barberías** (Empyrean Studio + 3). Indica qué ya está resuelto en el código, qué decisiones son del negocio y el orden exacto de puesta en marcha.

## 1. Estado del código

### Listo y verificado

| Área | Estado | Cómo se verificó |
|---|---|---|
| Aislamiento entre barberías | Todas las consultas de los 11 módulos filtran por `tenant_id` | Guardia automática de 46 rutas + pruebas reales con dos barberías (31/31, 20/20) |
| Plataforma | Alta, suspensión, baja y asignación de dueños desde `/platform` | Prueba real 24/24 y navegador |
| Instalación desde cero | Esquema PostgreSQL + puesta en marcha completa | `npm run verify:fresh-install` (18/18) |
| Seguridad de sesión | JWT en cookie `HttpOnly`/`Secure`/`SameSite=Lax`, rol leído de la base en cada petición | Pruebas de autorización |
| Fuerza bruta | Límite de intentos en login, registro, recuperación, cambio de contraseña y subidas | Prueba de instalación (11.º intento → 429) |
| Cabeceras | CSP estricta, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, HSTS, `Permissions-Policy` | Navegador con el build de producción, sin bloqueos indebidos |
| Dependencias | `npm audit --omit=dev`: **0 vulnerabilidades** (bcrypt 6, zod 4, multer/nodemailer actualizados) | 95 pruebas de backend tras actualizar |
| Archivos | Rutas relativas (`/uploads/...`), carpeta configurable `UPLOADS_DIR`, comprobantes privados por barbería, imágenes convertidas a WebP al 70 % sin metadatos (`sharp`); comprobantes borrados a los 20 días (`PAYMENT_PROOF_RETENTION_DAYS`), salvo los pendientes de revisión | Migración 016 + navegador |
| Despliegue | Un solo servicio Node sirve API y frontend (`SERVE_FRONTEND=true`), `Dockerfile`, cierre ordenado con SIGTERM | Servicio único probado localmente |
| Salud | `/api/health` (proceso) y `/api/health/ready` (base + migraciones) | Probado |
| Respaldos | `npm run db:backup` (+ `--con-archivos`) | Respaldo restaurado en una base temporal con los mismos datos |
| Migraciones | `npm run db:migrate`: aplica solo lo pendiente, registra en `schema_migrations`, crea el usuario de la app y los operadores (`PLATFORM_ADMIN_EMAILS`) | Base vacía y repetición, sobre PostgreSQL 18 local |
| Correo | Resend o Brevo (API HTTPS) o SMTP, elegido por variables | Pruebas con API simulada |
| Configuración | El servidor no arranca con secretos débiles, usuario administrador de PostgreSQL, contraseña vacía o dominio sin HTTPS | Probado |

### Limitaciones conocidas (aceptables para 4 barberías)

- **Una sola instancia de API.** El límite de intentos vive en memoria. Para escalar a varias instancias, mover el límite a Redis o al proxy.
- **Zona horaria única** `America/La_Paz` para todas las barberías (todas en Bolivia).
- **Un remitente de correo** de la plataforma envía por todas las barberías (el mensaje lleva el nombre de cada una). Los recordatorios son por correo y dentro de la plataforma; no hay recordatorios por WhatsApp.
- **Reservar como cliente exige una cuenta de cliente.** El personal de una barbería no puede reservar en otra con la misma cuenta.
- **Archivos en disco** (volumen persistente), no en almacenamiento de objetos. Suficiente con una instancia; migrar a S3/R2 si se escala.
- **Sin cobro automático a las barberías** (planes y facturación son la fase 8). Con 4 barberías se puede facturar manualmente.
- **Dockerfile no probado en esta máquina** (Docker Desktop estaba detenido). Probarlo con `docker build -t reservas .` antes del primer despliegue.

## 2. Decisiones del negocio (necesarias antes de lanzar)

1. **Nombre y dominio de la plataforma** (p. ej. `reservas.tudominio.com`). No usar el dominio de una barbería concreta.
2. **Proveedor de hosting.** Ver sección 3.
3. **Datos iniciales.** Opción recomendada: **instalación limpia** (la base local tiene datos de prueba). Alternativa: copiar la base local con `npm run db:import-mysql`.
4. **Correo transaccional**: **Resend o Brevo por API HTTPS** (`RESEND_API_KEY`/`BREVO_API_KEY`) con dominio verificado (SPF/DKIM). En Railway es obligatorio salvo plan Pro, porque bloquea el SMTP saliente; SMTP sigue disponible en otros proveedores.
5. **Textos legales**: términos de uso, política de privacidad y **política de anticipos y devoluciones** (hoy: el anticipo del 50 % no se devuelve si el cliente no asiste). Revisarlos con un profesional según la normativa boliviana.
6. **Contrato y precio con las barberías** (fase 8 pendiente): mensualidad manual, periodo de prueba (`TRIAL`) y qué pasa al suspender.
7. **Quién opera la plataforma** (operadores) y quién es dueño de cada barbería, con su correo.

## 3. Arquitectura recomendada

```text
clientes ─HTTPS─> app.tudominio.com ─> 1 servicio Node (API + frontend)
                                        ├─ volumen persistente /data/uploads
                                        ├─ PostgreSQL de Supabase (privado, TLS, respaldos)
                                        └─ Correo: Resend o Brevo (salida)
```

Con 4 barberías basta **un servicio pequeño** (≈ 512 MB de RAM), **PostgreSQL de Supabase** y **1–5 GB de volumen**. Opciones válidas:

| Opción | Servicio | PostgreSQL | Volumen |
|---|---|---|---|
| Railway (elegida) | Servicio desde el `Dockerfile` | Supabase | Volumen montado en `/data` |
| Render | Web Service (Docker) | Supabase | Persistent Disk en `/data` |
| DigitalOcean | App Platform o Droplet con Docker | Managed PostgreSQL | Volumen del Droplet |
| VPS propio | Docker + Caddy/Nginx (HTTPS automático) | PostgreSQL en el mismo VPS o administrado | Disco del VPS + respaldos externos |

Requisitos de cualquier opción: HTTPS, PostgreSQL 15 o superior, disco persistente, variables secretas y un comando de arranque `node src/server.js` (en `backend/`) o el `Dockerfile`.

## 4. Puesta en marcha paso a paso

### 4.1 Base de datos

Proyecto de Supabase y cadenas de conexión: [DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md) § 2. Las migraciones las aplica `npm run db:migrate` (pre-deploy en Railway).

### 4.2 Servicio

1. Variables según `backend/.env.production.example` (en los secretos del proveedor). Imprescindibles: `NODE_ENV=production`, `FRONTEND_URL`, `JWT_SECRET` nuevo, `DATABASE_URL` y `MIGRATION_DATABASE_URL` con `DATABASE_SSL=true`, `SERVE_FRONTEND=true`, `UPLOADS_DIR=/data/uploads`, `TRUST_PROXY=true`, `EMAIL_*`.
2. Construir: `npm ci && npm run build`. Arrancar: `npm start` (o la imagen del `Dockerfile`).
3. Dominio: apuntar el DNS de `app.tudominio.com` al servicio y activar HTTPS del proveedor.
4. Comprobar `https://app.tudominio.com/api/health/ready` → `{"ok":true,"database":"up"}`.

### 4.3 Primeras cuentas y barberías

1. Registrarse en `https://app.tudominio.com/t/empyrean-studio` con la cuenta del operador.
2. En el servidor: `npm run platform:admin -- agregar operador@tudominio.com`.
3. Entrar a `/platform`:
   - **Asignar dueño** a Empyrean Studio.
   - **Crear las 3 barberías** con su dirección web (`/t/nombre`), ciudad, teléfono y dueño (contraseña temporal).
4. Cada dueño, en `/t/<su-barbería>/admin`:
   1. cambia su contraseña temporal (obligatorio);
   2. **Configuración**: dirección, horario visible, WhatsApp, mapa, redes, **QR de pagos**, **logo** y **portada**;
   3. **Servicios** (precio y duración) y categorías;
   4. **Barberos**: ficha, foto, servicios que realiza, **horario semanal**, permisos y **cuenta de acceso**.
5. Compartir con cada barbería su enlace `https://app.tudominio.com/t/<slug>`.

### 4.4 Prueba final en el dominio real (por cada barbería)

- [ ] La página muestra su nombre, logo, portada, dirección y teléfono.
- [ ] Registro de un cliente nuevo y login/logout.
- [ ] Recuperación de contraseña: llega el correo con su marca y el enlace vuelve a la barbería.
- [ ] Reserva con QR y comprobante → el dueño lo abre, aprueba y la cita queda confirmada.
- [ ] El barbero ve la cita en su portal y la marca como atendida; el cliente deja una reseña.
- [ ] Cancelación y reprogramación por el cliente.
- [ ] Recordatorio por correo y aviso dentro de la plataforma.
- [ ] El dueño de una barbería no entra al panel de otra.

## 5. Operación

- **Respaldos:** los automáticos requieren Supabase Pro (el plan Free no tiene) y, además, un respaldo diario con `npm run db:backup -- --con-archivos` guardado **fuera** del servidor (retención 30 días). Probar una restauración al mes.
- **Monitoreo:** un monitor de disponibilidad (UptimeRobot, Better Stack…) sobre `/api/health/ready` cada 5 min, con aviso por correo. Revisar los registros del proveedor ante errores 500.
- **Despliegues:** probar primero con `npm run verify` y `npm run verify:fresh-install`; desplegar en horario de poca actividad. El proceso cierra ordenadamente con SIGTERM.
- **Nuevas migraciones:** respaldo antes. Cada una corre en una transacción: si falla, no deja cambios a medias.
- **Secretos:** rotar cualquier token o contraseña que haya pasado por chats o capturas (Meta, SMTP, JWT, PostgreSQL). `JWT_SECRET` nuevo cierra todas las sesiones.
- **Suspender una barbería** (impago, baja): `/platform` → Suspender. Sus datos se conservan; se reactiva con un clic.

## 6. Plan de vuelta atrás

1. Antes de lanzar: respaldo de la base y del volumen.
2. Si algo falla tras desplegar: volver a la imagen/commit anterior en el proveedor.
3. Si la base quedó dañada: restaurar desde Supabase (*Database* → *Backups*) o el último respaldo propio (`gunzip -c respaldo.sql.gz | psql "$MIGRATION_DATABASE_URL"`).
