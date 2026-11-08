// Migrador de la base de datos (instalación nueva y actualizaciones).
//
//   npm run db:migrate                 → aplica las migraciones pendientes
//   npm run db:migrate -- --estado     → solo muestra qué está aplicado y qué falta
//   npm run db:migrate -- --confirmar-014
//                                      → permite aplicar 014 sobre una base CON datos
//
// Pensado para el "pre-deploy command" de Railway: se ejecuta antes de cada
// despliegue, aplica solo lo pendiente y registra cada migración en la tabla
// schema_migrations, así repetirlo no hace nada.
//
// Conexión:
//   MIGRATION_DATABASE_URL  mysql://root:clave@host:puerto/base (usuario administrador;
//                           en Railway: ${{MySQL.MYSQL_URL}}). Si no existe, usa DATABASE_*.
// Usuario de la aplicación (opcional, recomendado):
//   si MIGRATION_DATABASE_URL usa otro usuario que DATABASE_USER, crea o actualiza
//   DATABASE_USER con DATABASE_PASSWORD y solo permisos SELECT/INSERT/UPDATE/DELETE
//   sobre la base. Así la API nunca usa root.
//
// Una base nueva recibe: 001, 002, 007, 013, 014, 015, 016 y cualquier archivo
// posterior (017_...). 003–012 ya están incluidas en 001.
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const require = createRequire(path.join(backend, 'package.json'));
require('dotenv').config({ path: path.join(backend, '.env') });
const mysql = require('mysql2/promise');

const showOnly = process.argv.includes('--estado');
const confirm014 = process.argv.includes('--confirmar-014');
const BASE_CHAIN = ['001', '002', '007', '013', '014', '015', '016'];
const LOCK = 'barber-team-machine-migrations';

function connectionConfig() {
  const ssl = String(process.env.DATABASE_SSL).toLowerCase() === 'true' ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined;
  if (process.env.MIGRATION_DATABASE_URL) {
    const url = new URL(process.env.MIGRATION_DATABASE_URL);
    return {
      host: url.hostname, port: Number(url.port || 3306),
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')) || process.env.DATABASE_NAME, ssl
    };
  }
  return {
    host: process.env.DATABASE_HOST ?? 'localhost', port: Number(process.env.DATABASE_PORT ?? 3306),
    user: process.env.DATABASE_USER ?? 'root', password: process.env.DATABASE_PASSWORD ?? '',
    database: process.env.DATABASE_NAME ?? 'barber_team_machine', ssl
  };
}

// Migraciones disponibles en el orden de una instalación nueva.
function availableMigrations() {
  const files = readdirSync(path.join(root, 'database')).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
  const byNumber = new Map(files.map((name) => [name.slice(0, 3), name]));
  const chain = BASE_CHAIN.map((number) => {
    if (!byNumber.has(number)) throw new Error(`Falta la migración ${number} en database/`);
    return byNumber.get(number);
  });
  // Migraciones futuras (017 en adelante) se agregan al final, en orden.
  for (const name of files) if (Number(name.slice(0, 3)) > 16) chain.push(name);
  return chain;
}

function migrationSql(file, database) {
  return readFileSync(path.join(root, 'database', file), 'utf8')
    .replace(/CREATE DATABASE IF NOT EXISTS barber_team_machine[\s\S]*?;/, '')
    .replaceAll('USE barber_team_machine;', `USE \`${database}\`;`);
}

const config = connectionConfig();
if (!config.database) throw new Error('No se pudo determinar el nombre de la base (MIGRATION_DATABASE_URL o DATABASE_NAME).');
const db = await mysql.createConnection({ ...config, multipleStatements: true });
const q = async (sql, values) => (await db.query(sql, values))[0];
const log = (message) => console.log(`[migraciones] ${message}`);

try {
  const [{ acquired }] = await q('SELECT GET_LOCK(?, 60) AS acquired', [LOCK]);
  if (Number(acquired) !== 1) throw new Error('Otra ejecución del migrador tiene el bloqueo; reintenta en un minuto.');

  await q(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(190) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note VARCHAR(255) NULL
  )`);
  const exists = async (sql, values) => Number((await q(sql, values))[0].n) > 0;
  const tableExists = (table) => exists('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [table]);
  const columnExists = (table, column) => exists('SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', [table, column]);

  const chain = availableMigrations();
  let applied = new Set((await q('SELECT name FROM schema_migrations')).map((row) => row.name));

  // Base existente sin registro (instalada antes del migrador): se detecta qué
  // ya tiene y se registra como aplicado sin volver a ejecutarlo.
  const hasData = await tableExists('users');
  if (!applied.size && hasData) {
    const present = {
      '001': true, '002': true, '007': await columnExists('services', 'category_id'),
      '013': await tableExists('tenants'), '014': await columnExists('appointments', 'tenant_id'), '015': await columnExists('tenant_settings', 'logo_url')
    };
    for (const file of chain) {
      if (present[file.slice(0, 3)]) await q('INSERT INTO schema_migrations (name, note) VALUES (?, ?)', [file, 'detectada en una base existente']);
    }
    applied = new Set((await q('SELECT name FROM schema_migrations')).map((row) => row.name));
    log(`base existente sin registro: se registraron ${applied.size} migraciones ya presentes`);
  }

  const pending = chain.filter((file) => !applied.has(file));
  log(`base: ${config.database} · aplicadas: ${applied.size} · pendientes: ${pending.length ? pending.join(', ') : 'ninguna'}`);

  if (!showOnly) {
    // 014 añade tenant_id obligatorio y no es atómica: sobre datos existentes
    // exige respaldo previo y confirmación explícita.
    const has014 = pending.find((file) => file.startsWith('014'));
    if (has014 && hasData && !confirm014) {
      throw new Error('014 está pendiente en una base con datos. Respalda la base y vuelve a ejecutar con --confirmar-014.');
    }
    for (const file of pending) {
      log(`aplicando ${file}...`);
      await db.query(migrationSql(file, config.database));
      await db.query(`USE \`${config.database}\``);
      await q('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
    }
    if (pending.length) log('migraciones aplicadas correctamente');

    // Usuario propio de la aplicación (nunca root para la API).
    const appUser = process.env.DATABASE_USER;
    if (process.env.MIGRATION_DATABASE_URL && appUser && appUser !== config.user) {
      if (!process.env.DATABASE_PASSWORD) throw new Error(`DATABASE_PASSWORD es obligatorio para crear el usuario ${appUser}.`);
      await q("CREATE USER IF NOT EXISTS ?@'%' IDENTIFIED BY ?", [appUser, process.env.DATABASE_PASSWORD]);
      await q("ALTER USER ?@'%' IDENTIFIED BY ?", [appUser, process.env.DATABASE_PASSWORD]);
      await q(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${config.database}\`.* TO ?@'%'`, [appUser]);
      log(`usuario de la aplicación ${appUser} listo (solo SELECT, INSERT, UPDATE, DELETE)`);
    }

    // Operadores de la plataforma sin necesidad de una consola en el servidor:
    // PLATFORM_ADMIN_EMAILS=uno@dominio,otra@dominio. Solo agrega (nunca quita)
    // y solo a cuentas ya registradas; para quitar, usar scripts/platform-admin.mjs.
    const operatorEmails = (process.env.PLATFORM_ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
    for (const email of operatorEmails) {
      const result = await q('INSERT IGNORE INTO platform_administrators (user_id) SELECT id FROM users WHERE email = ? AND is_active = TRUE', [email]);
      const [{ n }] = await q('SELECT COUNT(*) AS n FROM platform_administrators p JOIN users u ON u.id = p.user_id WHERE u.email = ?', [email]);
      if (Number(n)) log(`operador de plataforma: ${email}${result.affectedRows ? ' (agregado)' : ''}`);
      else log(`AVISO: ${email} no tiene una cuenta activa; regístrala en la web y vuelve a desplegar`);
    }
  }
} catch (error) {
  console.error(`[migraciones] ERROR: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.query('SELECT RELEASE_LOCK(?)', [LOCK]).catch(() => {});
  await db.end();
}
