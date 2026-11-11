// Migrador de la base PostgreSQL (Supabase).
//
//   npm run db:migrate                 → aplica las migraciones pendientes
//   npm run db:migrate -- --estado     → solo muestra qué está aplicado y qué falta
//
// Pensado para el "pre-deploy command": aplica solo database/postgres/*.sql
// pendientes y los registra en reservas.schema_migrations. Cada migración corre
// en una transacción: si falla, no queda nada a medias.
//
// Conexión:
//   MIGRATION_DATABASE_URL  usuario administrador (postgres); si no existe, DATABASE_URL.
// Usuario de la aplicación:
//   si DATABASE_URL usa un usuario distinto al administrador, lo crea o actualiza
//   con solo permisos SELECT/INSERT/UPDATE/DELETE sobre el esquema "reservas".
// Operadores:
//   PLATFORM_ADMIN_EMAILS=uno@dominio,otra@dominio (cuentas ya registradas).
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const require = createRequire(path.join(backend, 'package.json'));
require('dotenv').config({ path: path.join(backend, '.env') });
const { Client } = require('pg');

const SCHEMA = process.env.DATABASE_SCHEMA || 'reservas';
const showOnly = process.argv.includes('--estado');
const log = (message) => console.log(`[migraciones] ${message}`);

function sslConfig() {
  if (String(process.env.DATABASE_SSL).toLowerCase() !== 'true') return undefined;
  return {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
    ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT.replaceAll('\\n', '\n') } : {})
  };
}

function withoutSslMode(value) {
  const url = new URL(value);
  url.searchParams.delete('sslmode');
  return url.toString();
}

const adminUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!adminUrl) {
  console.error('[migraciones] ERROR: define MIGRATION_DATABASE_URL o DATABASE_URL.');
  process.exit(1);
}

// En el pooler de Supabase el usuario es "rol.ref-del-proyecto"; el rol real es la primera parte.
const roleName = (user) => decodeURIComponent(user ?? '').split('.')[0];
const adminRole = roleName(new URL(adminUrl).username);
const appUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;

const db = new Client({ connectionString: withoutSslMode(adminUrl), ssl: sslConfig() });
await db.connect();
const q = async (sql, values) => (await db.query(sql, values)).rows;

try {
  await q("SELECT pg_advisory_lock(hashtext('barber-team-machine-migrations'))");
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await db.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.schema_migrations (name VARCHAR(190) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);

  const directory = path.join(root, 'database', 'postgres');
  const files = readdirSync(directory).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
  const applied = new Set((await q(`SELECT name FROM ${SCHEMA}.schema_migrations`)).map((row) => row.name));
  const pending = files.filter((file) => !applied.has(file));
  log(`aplicadas: ${applied.size} · pendientes: ${pending.length ? pending.join(', ') : 'ninguna'}`);

  if (!showOnly) {
    for (const file of pending) {
      log(`aplicando ${file}...`);
      await db.query('BEGIN');
      try {
        await db.query(readFileSync(path.join(directory, file), 'utf8'));
        await q(`INSERT INTO ${SCHEMA}.schema_migrations (name) VALUES ($1)`, [file]);
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw new Error(`${file}: ${error.message}`);
      }
    }
    if (pending.length) log('migraciones aplicadas correctamente');

    // Usuario propio de la aplicación: la API nunca usa el administrador.
    const appRole = roleName(appUrl?.username);
    if (process.env.MIGRATION_DATABASE_URL && appRole && appRole !== adminRole) {
      const password = decodeURIComponent(appUrl.password);
      if (!password) throw new Error(`DATABASE_URL debe incluir la contraseña de ${appRole}.`);
      const role = db.escapeIdentifier(appRole);
      const secret = db.escapeLiteral(password);
      const exists = (await q('SELECT 1 FROM pg_roles WHERE rolname = $1', [appRole])).length > 0;
      await db.query(exists ? `ALTER ROLE ${role} WITH LOGIN PASSWORD ${secret}` : `CREATE ROLE ${role} WITH LOGIN PASSWORD ${secret}`);
      await db.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${role}`);
      await db.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${role}`);
      await db.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${SCHEMA} TO ${role}`);
      await db.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${SCHEMA} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
      await db.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${SCHEMA} GRANT USAGE, SELECT ON SEQUENCES TO ${role}`);
      log(`usuario de la aplicación ${appRole} listo (solo SELECT, INSERT, UPDATE, DELETE)`);
    }

    // Solo agrega (nunca quita) y solo cuentas registradas.
    const operatorEmails = (process.env.PLATFORM_ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
    for (const email of operatorEmails) {
      const inserted = await db.query(`INSERT INTO ${SCHEMA}.platform_administrators (user_id) SELECT id FROM ${SCHEMA}.users WHERE email = $1 AND is_active = TRUE ON CONFLICT DO NOTHING`, [email]);
      const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM ${SCHEMA}.platform_administrators p JOIN ${SCHEMA}.users u ON u.id = p.user_id WHERE u.email = $1`, [email]);
      if (n) log(`operador de plataforma: ${email}${inserted.rowCount ? ' (agregado)' : ''}`);
      else log(`AVISO: ${email} no tiene una cuenta activa; regístrala en la web y vuelve a desplegar`);
    }
  }
} catch (error) {
  console.error(`[migraciones] ERROR: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.query("SELECT pg_advisory_unlock(hashtext('barber-team-machine-migrations'))").catch(() => {});
  await db.end();
}
