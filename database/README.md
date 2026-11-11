# Base de datos

La plataforma usa **PostgreSQL** (Supabase en producción).

- `postgres/`: migraciones vigentes. `001_schema.sql` crea el esquema privado `reservas` y `002_seed.sql` los roles y la barbería inicial.
- Las migraciones antiguas de MySQL (001 a 016) se eliminaron; siguen en el historial de git.

## Aplicar migraciones

```bash
npm run db:migrate
```

Aplica los archivos pendientes de `postgres/` en orden, cada uno en una transacción, y los registra en `reservas.schema_migrations`. Repetirlo no hace nada. Para ver el estado sin cambiar nada: `npm run db:migrate -- --estado`.

Variables: `MIGRATION_DATABASE_URL` (usuario administrador) y `DATABASE_URL` (usuario de la aplicación, que el migrador crea con solo permisos de datos). Una migración nueva es un archivo `003_descripcion.sql` que empieza con `SET search_path TO reservas;`.

## Por qué el esquema `reservas`

Supabase publica el esquema `public` mediante su API REST. Estas tablas guardan hashes de contraseñas y datos personales, así que viven en un esquema que esa API no expone y solo la aplicación accede a ellas.

## Traer datos desde MySQL

`node scripts/mysql-to-postgres.mjs` (solo cuenta) y `--copiar` (copia en una transacción y verifica por tabla). Detalle en `docs/DEPLOY_RAILWAY.md`.

## Comprobaciones

Requieren un PostgreSQL de pruebas en `TEST_POSTGRES_URL` (nunca Supabase: crean y borran bases temporales).

- `npm run verify:fresh-install`: instalación desde cero y puesta en marcha completa.
- `npm run test:routes`: todas las rutas de la API contra PostgreSQL real.
- `npm run test:stress`: prueba de estrés de 3 barberías.
