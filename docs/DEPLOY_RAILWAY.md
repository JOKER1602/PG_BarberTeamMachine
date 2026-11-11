# Despliegue: Railway + Supabase (paso a paso)

Revisión: 11 de noviembre de 2026. Complementa [PRODUCTION_LAUNCH.md](PRODUCTION_LAUNCH.md).

Resultado final: **Railway** ejecuta la aplicación (API + frontend, con un volumen para las subidas) y **Supabase** aloja la base PostgreSQL.

```text
Railway: servicio app  ← repo JOKER1602/PG_BarberTeamMachine (Dockerfile), volumen /data, dominio HTTPS
                │  TLS, pooler en modo sesión (IPv4, puerto 5432)
                ▼
Supabase: PostgreSQL   ← esquema privado "reservas", usuario propio de la app
```

Supabase se usa **solo como base de datos**: la autenticación, las subidas y la lógica siguen en esta aplicación.

## Antes de empezar: lo que condiciona la configuración

1. **`railway.json` ya no sirve:** Railway lo ignora en servicios nuevos y deja de leerlo el 1 de diciembre de 2026. Los ajustes se hacen en el panel, como indica esta guía. La construcción usa el `Dockerfile`, que Railway detecta solo.
2. **Railway bloquea el correo SMTP en Free, Trial y Hobby.** La aplicación envía por **API HTTPS de Resend o Brevo**.
3. **Plan de Supabase:** el plan Free se pausa tras alrededor de una semana de poca actividad y **no tiene respaldos automáticos**. Para clientes reales usa **Pro** (respaldos diarios de 7 días, sin pausa). Revisa los precios vigentes en supabase.com.
4. **Conexión por el pooler en modo sesión (puerto 5432):** la conexión directa de Supabase usa IPv6, y el pooler funciona por IPv4. No uses el modo transacción (6543): el worker de recordatorios necesita un candado de sesión.
5. **Las tablas están en el esquema `reservas`, no en `public`:** Supabase publica `public` por su API REST y aquí hay hashes de contraseñas y datos personales. No muevas las tablas a `public` ni agregues `reservas` a *Exposed schemas*.

## Paso 1. Cuentas

- **Supabase** (plan Pro para producción) · **Railway** (plan Hobby basta para 4 barberías) · **Resend** o Brevo con tu **dominio verificado** (SPF/DKIM) · tu **dominio** con acceso a su DNS.

## Paso 2. Proyecto en Supabase

1. **New project**. Región: la más cercana al servidor de Railway, no a los clientes, porque cada página hace varias consultas a la base. Con Railway en **US East**, usa **Canada (Central)** o **East US**. Guarda la contraseña de la base (la llamaremos `CLAVE_ADMIN`).
2. Botón **Connect** → **Session pooler**. Anota el host (`aws-N-REGION.pooler.supabase.com`) y la referencia del proyecto (`REF`).

Con esos datos se arman dos cadenas de conexión (si la contraseña tiene símbolos, escápalos para URL):

```text
MIGRATION_DATABASE_URL = postgresql://postgres.REF:CLAVE_ADMIN@aws-N-REGION.pooler.supabase.com:5432/postgres
DATABASE_URL           = postgresql://reservas_app.REF:CLAVE_APP@aws-N-REGION.pooler.supabase.com:5432/postgres
```

`CLAVE_APP` es una contraseña nueva que eliges tú. El usuario `reservas_app` lo crea el migrador; solo tiene permisos de lectura y escritura de datos en `reservas`.

Genera `CLAVE_APP` y `JWT_SECRET` (uno distinto cada uno) con:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Paso 3. Proyecto en Railway

1. **New Project** → **Deploy from GitHub repo** → `JOKER1602/PG_BarberTeamMachine`, con la rama que vayas a publicar. Renombra el servicio a **app** y, en *Settings* → *Region*, elige **US East**, cerca de la base de Supabase.
2. Servicio **app** → **Volumes** → ruta de montaje **`/data`**. (Con volumen no hay réplicas y cada redespliegue tiene unos segundos sin servicio.)

## Paso 4. Variables del servicio app

*Variables* → *Raw Editor*:

```env
NODE_ENV=production
TRUST_PROXY=true
CLIENT_IP_HEADER=x-real-ip
SERVE_FRONTEND=true
UPLOADS_DIR=/data/uploads
RAILWAY_RUN_UID=0
FRONTEND_URL=https://<tu-dominio>

DATABASE_URL=<la del usuario reservas_app>
MIGRATION_DATABASE_URL=<la del usuario postgres>
DATABASE_SSL=true
DATABASE_SSL_REJECT_UNAUTHORIZED=false

JWT_SECRET=<64 caracteres aleatorios>
DEFAULT_TENANT_SLUG=empyrean-studio
PLATFORM_NAME=<nombre de tu plataforma>

RESEND_API_KEY=<clave de Resend>
EMAIL_FROM=<Nombre> <notificaciones@tu-dominio>
```

- `DATABASE_SSL_REJECT_UNAUTHORIZED=false` cifra la conexión sin verificar el certificado. Para verificarlo, descarga el certificado en *Database settings* de Supabase, ponlo en `DATABASE_CA_CERT` (con `\n` en los saltos de línea) y quita esa variable.
- `CLIENT_IP_HEADER=x-real-ip`: el límite de intentos usa la IP real que escribe el proxy de Railway.
- `RAILWAY_RUN_UID=0`: la imagen corre sin privilegios y el volumen se monta como root.
- Después de guardarlas, usa **Seal** en las contraseñas y claves.
- `DATABASE_POOL_MAX`: conexiones a la base por instancia (10 por defecto). La suma de todas las instancias debe quedar bajo el *pool size* de Supabase en modo sesión, 15 en el plan Micro: con 2 réplicas usa 7.
- Opcional, `PAYMENT_PROOF_RETENTION_DAYS`: días que se guardan los comprobantes de pago (20 si no se define). Una tarea diaria borra la imagen y su registro; los pagos pendientes de revisión nunca se borran.

## Paso 5. Ajustes del servicio app (Settings)

| Ajuste | Valor |
|---|---|
| Builder | Dockerfile (automático) |
| **Pre-deploy command** | `node /app/scripts/migrate.mjs` |
| **Healthcheck path** | `/api/health/ready` |
| Start command | vacío (usa el del Dockerfile) |
| Restart policy | On failure |

El pre-deploy aplica solo las migraciones pendientes, cada una en su transacción, y crea o actualiza `reservas_app`. Si falla, Railway no publica la versión nueva.

## Paso 6. Dominio

1. *Settings* → *Networking* → *Generate Domain* para probar.
2. *Custom Domain* → crea el **CNAME** que indique Railway; el certificado HTTPS es automático.
3. Ajusta `FRONTEND_URL=https://reservas.tudominio.com` (sin barra final).

## Paso 7. Primer despliegue

1. **Deploy**. En el pre-deploy deberías ver `aplicando 001_schema.sql...`, `002_seed.sql` y `usuario de la aplicación reservas_app listo`.
2. `https://<tu-dominio>/api/health/ready` → `{"ok":true,"database":"up"}`.
3. Abre `https://<tu-dominio>/t/empyrean-studio`.

### Si quieres llevar los datos actuales de MySQL (opcional)

La recomendación sigue siendo empezar limpio, porque la base local tiene datos de prueba. Si los quieres conservar, desde tu computadora, con la base ya migrada y el `DATABASE_URL` de administrador:

```bash
node scripts/mysql-to-postgres.mjs
```

```bash
node scripts/mysql-to-postgres.mjs --copiar --reemplazar
```

El primero solo cuenta filas. El segundo copia todo en una transacción y borra lo que haya en destino. Variables: `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`. Las subidas (`backend/uploads`) se copian aparte al volumen.

## Paso 8. Operador, dueños y barberías

1. Regístrate en `https://<tu-dominio>/t/empyrean-studio` con el correo del **operador**.
2. Agrega la variable `PLATFORM_ADMIN_EMAILS=<ese correo>`: Railway redespliega y el pre-deploy lo convierte en operador.
3. En `https://<tu-dominio>/platform`: **Asignar dueño** a Empyrean Studio y **crear las otras barberías**.
4. Cada dueño completa su barbería y se hace la prueba final de `PRODUCTION_LAUNCH.md` § 4.4.

## Operación

- **Respaldos:** con Supabase Free, el respaldo diario cifrado de GitHub Actions (sección «Respaldos con Supabase Free»); con Supabase Pro, además, los automáticos de Supabase. Una copia propia, además, con `npm run db:backup` (requiere `pg_dump`, versión igual o mayor a la del servidor). Probar una restauración al mes.
- **Subidas:** viven en el volumen de Railway; respáldalas con `npm run db:backup -- --con-archivos` o revisa si tu plan ofrece respaldos de volúmenes.
- **Monitoreo:** UptimeRobot o similar sobre `/api/health/ready` cada 5 minutos.
- **Volver atrás:** Railway → *Deployments* → versión anterior → *Redeploy*. Si una migración dañó datos, restaura desde Supabase.
- **Rotar secretos:** cambiar `JWT_SECRET` cierra todas las sesiones; cambiar la contraseña en `DATABASE_URL` se aplica sola en el siguiente despliegue.

## Respaldos con Supabase Free (GitHub Actions)

El plan Free de Supabase no guarda respaldos. El flujo `.github/workflows/respaldo-diario.yml` respalda cada día a las 03:00 (hora de Bolivia) el esquema `reservas`, lo **cifra** con AES-256 y lo guarda 30 días como artefacto de GitHub. El repositorio es público: sin la clave de cifrado nadie puede leer el respaldo.

**Configurarlo (una sola vez):** en GitHub → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*:

| Secreto | Valor |
|---|---|
| `SUPABASE_BACKUP_DATABASE_URL` | La misma cadena de `MIGRATION_DATABASE_URL` (usuario `postgres.REF`) |
| `BACKUP_ENCRYPTION_KEY` | Una clave nueva de al menos 32 caracteres (genérala con el comando del paso 2). **Guárdala también fuera de GitHub**: sin ella los respaldos no se pueden abrir. |

Después: pestaña *Actions* → *Respaldo diario de la base* → *Run workflow*, para comprobar que termina en verde.

**Restaurar un respaldo:** descarga el artefacto desde la ejecución en *Actions*, descomprímelo y, con `pg_restore` 17 o superior:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in respaldo-AAAA-MM-DD.dump.enc -out respaldo.dump -pass env:BACKUP_ENCRYPTION_KEY
```

```bash
pg_restore --no-owner --clean --if-exists -d "$MIGRATION_DATABASE_URL" respaldo.dump
```

`--clean` reemplaza las tablas actuales por las del respaldo: pruébalo antes en una base de prueba. Al pasar a Supabase Pro, los respaldos diarios de Supabase se suman a estos.

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| Falla el pre-deploy con error de conexión | Host o `REF` incorrectos, o contraseña con símbolos sin escapar |
| `self-signed certificate` | Falta `DATABASE_SSL_REJECT_UNAUTHORIZED=false` o `DATABASE_CA_CERT` |
| «La API no puede conectarse con un usuario administrador» | `DATABASE_URL` usa `postgres.REF`; debe usar `reservas_app.REF` |
| «permission denied for schema reservas» | El pre-deploy no se ejecutó o falló |
| `Tenant or user not found` | Falta `.REF` en el usuario o la región del host no es la del proyecto |
| Error de permisos al subir fotos | Falta `RAILWAY_RUN_UID=0` o el volumen no está en `/data` |
| No llegan correos | Falta la clave o `EMAIL_FROM`, o el dominio no está verificado |
| Inicio de sesión bloqueado para todos | Falta `CLIENT_IP_HEADER=x-real-ip` |
