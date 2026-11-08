# Despliegue en Railway (paso a paso)

Revisión: 8 de noviembre de 2026. Complementa [PRODUCTION_LAUNCH.md](PRODUCTION_LAUNCH.md).

Resultado final: **un proyecto de Railway con 2 servicios** (la aplicación desde GitHub y MySQL) y un volumen para las subidas.

```text
Proyecto Railway
├─ app      ← repo JOKER1602/PG_BarberTeamMachine (Dockerfile), volumen /data, dominio HTTPS
└─ MySQL    ← base administrada (red privada), respaldos
```

## Antes de empezar: 3 cosas que Railway cambió y que ya están resueltas

1. **`railway.json` ya no sirve.** Railway lo ignora en servicios nuevos y deja de leerlo el **1 de diciembre de 2026**. Por eso este repositorio **no** usa archivo de configuración: los 3 ajustes (pre-deploy, healthcheck y volumen) se configuran en el panel, como indica esta guía. La construcción usa el `Dockerfile`, que Railway detecta solo.
2. **Railway bloquea el correo SMTP en los planes Free, Trial y Hobby** (solo Pro lo permite). La aplicación envía correo por **API HTTPS de Resend o Brevo** (`RESEND_API_KEY` o `BREVO_API_KEY`), que sí funciona en Hobby.
3. **El MySQL de Railway usa `root`** y la API se niega a arrancar con `root` en producción. El migrador (pre-deploy) crea automáticamente un usuario propio de la aplicación con permisos mínimos.

## Paso 1. Cuentas necesarias

- **Railway**, con plan **Hobby** (suficiente para 4 barberías; Pro solo si quisieras SMTP o más recursos). Revisa los precios vigentes en railway.com.
- **Resend** (o Brevo) para el correo, con tu **dominio verificado** (registros DNS SPF/DKIM que te indique) y una clave de API.
- Tu **dominio** (p. ej. `reservas.tudominio.com`), con acceso a su DNS.

## Paso 2. Crear el proyecto

1. Railway → **New Project** → **Deploy from GitHub repo** → `JOKER1602/PG_BarberTeamMachine`.
   - Rama: la que vayas a publicar (`main` cuando fusiones el PR #1, o `saas/incremento-2` para un ensayo).
   - Renombra el servicio a **app**.
2. En el mismo proyecto: **New** → **Database** → **MySQL**. Déjalo con el nombre **MySQL** (las referencias de abajo lo usan).
3. En MySQL → pestaña **Backups**: activa los respaldos (y la recuperación a un punto en el tiempo de 7 días, si está disponible).

## Paso 3. Volumen para fotos, QR, logos y comprobantes

Servicio **app** → **Volumes** (o clic derecho → *Attach volume*) → ruta de montaje **`/data`**.

> Un servicio con volumen no admite réplicas y cada redespliegue tiene unos segundos sin servicio. Es lo esperado con una instancia.

## Paso 4. Variables del servicio app

Servicio **app** → **Variables** → *Raw Editor*, pega y completa lo marcado con `<...>`:

```env
NODE_ENV=production
TRUST_PROXY=true
CLIENT_IP_HEADER=x-real-ip
SERVE_FRONTEND=true
UPLOADS_DIR=/data/uploads
RAILWAY_RUN_UID=0
FRONTEND_URL=https://<tu-dominio>

DATABASE_HOST=${{MySQL.MYSQLHOST}}
DATABASE_PORT=${{MySQL.MYSQLPORT}}
DATABASE_NAME=${{MySQL.MYSQLDATABASE}}
DATABASE_USER=reservas_app
DATABASE_PASSWORD=<contraseña larga y aleatoria>
DATABASE_SSL=false
MIGRATION_DATABASE_URL=${{MySQL.MYSQL_URL}}

JWT_SECRET=<64 caracteres aleatorios>
DEFAULT_TENANT_SLUG=empyrean-studio
PLATFORM_NAME=<nombre de tu plataforma>

RESEND_API_KEY=<clave de Resend>
EMAIL_FROM=<Nombre> <notificaciones@tu-dominio>
```

- Genera `DATABASE_PASSWORD` y `JWT_SECRET` en tu computadora con:
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` (uno distinto para cada una).
- `DATABASE_SSL=false`: la API y MySQL se comunican por la **red privada** de Railway.
- `CLIENT_IP_HEADER=x-real-ip`: el límite de intentos usa la IP real del cliente que el proxy de Railway escribe en `X-Real-IP` (la cantidad de saltos del proxy no está documentada, así que no conviene depender de `TRUST_PROXY` para esto).
- `RAILWAY_RUN_UID=0`: necesario porque la imagen corre sin privilegios y Railway monta el volumen como root.
- Después de guardarlas, usa **Seal** en `DATABASE_PASSWORD`, `JWT_SECRET` y `RESEND_API_KEY` para que no se puedan volver a leer en el panel.
- Opcional, WhatsApp: `WHATSAPP_PROVIDER=meta` y las variables `META_WHATSAPP_*` de `backend/.env.production.example`.

## Paso 5. Ajustes del servicio app (Settings)

| Ajuste | Valor |
|---|---|
| Builder | Dockerfile (detectado automáticamente) |
| **Pre-deploy command** | `node /app/scripts/migrate.mjs` |
| **Healthcheck path** | `/api/health/ready` |
| Start command | vacío (usa el del Dockerfile: `node src/server.js`) |
| Restart policy | On failure |

El **pre-deploy** se ejecuta antes de cada despliegue: aplica solo las migraciones pendientes (en una base vacía, 001 → 016), crea o actualiza `reservas_app` con permisos SELECT/INSERT/UPDATE/DELETE y registra lo aplicado en `schema_migrations`. Si falla, Railway no publica la versión nueva.

El **healthcheck** espera `{"ok":true}`: si faltara una migración responde 503 y Railway mantiene la versión anterior.

## Paso 6. Dominio

1. Servicio **app** → **Settings** → **Networking** → *Generate Domain* (te da `algo.up.railway.app` para probar).
2. *Custom Domain* → `reservas.tudominio.com` → crea en tu DNS el registro **CNAME** que Railway indique. El certificado HTTPS es automático.
3. Ajusta `FRONTEND_URL=https://reservas.tudominio.com` (sin barra final). Si quieres que también funcione el dominio `*.up.railway.app`, agrégalo separado por coma: el primero se usa en los enlaces de los correos.

## Paso 7. Primer despliegue y comprobación

1. **Deploy**. En los registros del pre-deploy deberías ver:
   `[migraciones] ... pendientes: 001_initial_schema.sql, ..., 016_relative_upload_urls.sql` y `usuario de la aplicación reservas_app listo`.
2. Abre `https://<tu-dominio>/api/health/ready` → `{"ok":true,"database":"up"}`.
3. Abre `https://<tu-dominio>/t/empyrean-studio`.

## Paso 8. Operador, dueños y barberías

1. Regístrate en `https://<tu-dominio>/t/empyrean-studio` con el correo del **operador**.
2. En Variables agrega `PLATFORM_ADMIN_EMAILS=<ese correo>` → Railway redespliega y el pre-deploy lo convierte en operador (en los registros: `operador de plataforma: ... (agregado)`).
3. Entra a `https://<tu-dominio>/platform`:
   - **Asignar dueño** a Empyrean Studio.
   - **Crear las otras 3 barberías** con su dueño y contraseña temporal.
4. Cada dueño completa su barbería (contraseña, configuración, QR, logo, portada, servicios, barberos, horarios y cuentas). Detalle en `PRODUCTION_LAUNCH.md` § 4.3.
5. Haz la prueba final de `PRODUCTION_LAUNCH.md` § 4.4 en cada barbería.

## Operación en Railway

- **Respaldos de la base:** pestaña *Backups* del servicio MySQL. Para una copia propia fuera de Railway, habilita temporalmente *Public Networking* en MySQL y ejecuta en tu computadora `npm run db:backup` con las variables `DATABASE_*` apuntando a `MYSQL_PUBLIC_URL`; luego vuelve a deshabilitarlo.
- **Respaldos del volumen:** revisa si tu plan ofrece respaldos de volúmenes; si no, descarga periódicamente las subidas.
- **Registros:** pestaña *Deployments* → *View logs* (avisos de configuración, errores 500, recordatorios).
- **Monitoreo externo:** UptimeRobot o similar sobre `https://<tu-dominio>/api/health/ready` cada 5 minutos.
- **Nuevas versiones:** fusiona en la rama conectada; Railway construye, ejecuta el pre-deploy (migraciones) y publica si el healthcheck responde bien.
- **Volver atrás:** *Deployments* → versión anterior → *Redeploy*. Si una migración dañó datos, restaura desde *Backups*.
- **Rotar secretos:** cambiar `JWT_SECRET` cierra todas las sesiones; cambiar `DATABASE_PASSWORD` se aplica solo (el pre-deploy actualiza el usuario).

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| El despliegue falla en el pre-deploy | `MIGRATION_DATABASE_URL` sin la referencia `${{MySQL.MYSQL_URL}}`, o MySQL todavía iniciando: reintenta |
| «Configuración de producción insegura» en los registros | `JWT_SECRET` corto, `DATABASE_USER=root` o `FRONTEND_URL` sin `https://` |
| Error de permisos al subir fotos | Falta `RAILWAY_RUN_UID=0` o el volumen no está montado en `/data` |
| Las fotos desaparecen tras redesplegar | `UPLOADS_DIR` no apunta al volumen (`/data/uploads`) |
| No llegan correos | Falta `RESEND_API_KEY`/`EMAIL_FROM` o el dominio no está verificado en Resend (el error aparece en los registros) |
| Inicio de sesión bloqueado para todos tras pocos intentos | Falta `CLIENT_IP_HEADER=x-real-ip` (todos comparten la IP del proxy) |
