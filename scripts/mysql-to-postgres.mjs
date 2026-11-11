// Copia los datos de la base MySQL antigua a PostgreSQL (Supabase).
//
//   node scripts/mysql-to-postgres.mjs                → simulación: solo cuenta filas
//   node scripts/mysql-to-postgres.mjs --copiar       → copia a una base recién migrada
//   node scripts/mysql-to-postgres.mjs --copiar --reemplazar
//                                                     → borra lo que haya en destino y copia
//
// Origen:  MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE.
// Destino: MIGRATION_DATABASE_URL o DATABASE_URL, con `npm run db:migrate` ya aplicado.
//
// Todo ocurre en una transacción: si algo falla, el destino queda como estaba.
// Los archivos subidos (backend/uploads) se copian aparte, al volumen.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const require = createRequire(path.join(backend, 'package.json'));
require('dotenv').config({ path: path.join(backend, '.env') });
const mysql = require('mysql2/promise');
const { Client } = require('pg');

const SCHEMA = process.env.DATABASE_SCHEMA || 'reservas';
const copy = process.argv.includes('--copiar');
const replace = process.argv.includes('--reemplazar');
// En orden de dependencias. business_settings se reemplazó por tenant_settings.
const TABLES = ['roles', 'users', 'password_reset_tokens', 'tenants', 'tenant_memberships', 'platform_administrators', 'tenant_settings', 'service_categories', 'services', 'barbers', 'barber_services', 'barber_working_hours', 'schedule_blocks', 'appointments', 'notifications', 'payment_proofs', 'reviews', 'reminder_jobs'];

const target = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!target) { console.error('Define MIGRATION_DATABASE_URL o DATABASE_URL (destino PostgreSQL).'); process.exit(1); }
const targetUrl = new URL(target);
targetUrl.searchParams.delete('sslmode');
const ssl = String(process.env.DATABASE_SSL).toLowerCase() === 'true'
  ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined;

const source = await mysql.createConnection({
  host: process.env.MYSQL_HOST ?? 'localhost', port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? 'root', password: process.env.MYSQL_PASSWORD ?? '',
  database: process.env.MYSQL_DATABASE ?? 'barber_team_machine_saas', timezone: 'Z', dateStrings: false
});
// Las columnas TIMESTAMP se leen en UTC, igual que las DATETIME guardadas en UTC.
await source.query("SET time_zone = '+00:00'");
const pg = new Client({ connectionString: targetUrl.toString(), ssl });
await pg.connect();

async function targetColumns(table) {
  const { rows } = await pg.query('SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position', [SCHEMA, table]);
  if (!rows.length) throw new Error(`No existe ${SCHEMA}.${table} en el destino: ejecuta npm run db:migrate.`);
  return rows;
}

try {
  const counts = {};
  for (const table of TABLES) counts[table] = Number((await source.query(`SELECT COUNT(*) AS n FROM \`${table}\``))[0][0].n);
  console.log(`Origen ${process.env.MYSQL_DATABASE ?? 'barber_team_machine_saas'}:`, counts);
  if (!copy) {
    console.log('Simulación: no se copió nada. Usa --copiar para copiar.');
  } else {
    await pg.query('BEGIN');
    const { rows: [{ users }] } = await pg.query(`SELECT COUNT(*)::int AS users FROM ${SCHEMA}.users`);
    if (users > 0 && !replace) throw new Error(`El destino ya tiene ${users} usuarios. Usa --reemplazar para borrar su contenido.`);
    await pg.query(`TRUNCATE ${TABLES.map((table) => `${SCHEMA}.${table}`).join(', ')} RESTART IDENTITY CASCADE`);

    for (const table of TABLES) {
      const columns = await targetColumns(table);
      const names = columns.map((column) => column.name);
      const booleans = new Set(columns.filter((column) => column.type === 'boolean').map((column) => column.name));
      const [rows] = await source.query(`SELECT ${names.map((name) => `\`${name}\``).join(', ')} FROM \`${table}\``);
      for (const row of rows) {
        const values = names.map((name) => (booleans.has(name) && row[name] !== null ? Boolean(row[name]) : row[name]));
        await pg.query(`INSERT INTO ${SCHEMA}.${table} (${names.join(', ')}) OVERRIDING SYSTEM VALUE VALUES (${names.map((_, index) => `$${index + 1}`).join(', ')})`, values);
      }
      // Los próximos id continúan después de los copiados.
      if (names.includes('id') && rows.length && typeof rows[0].id === 'number') {
        await pg.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), (SELECT MAX(id) FROM ${SCHEMA}.${table}))`, [`${SCHEMA}.${table}`]);
      }
      const { rows: [{ n }] } = await pg.query(`SELECT COUNT(*)::int AS n FROM ${SCHEMA}.${table}`);
      if (n !== counts[table]) throw new Error(`${table}: origen ${counts[table]}, destino ${n}`);
    }
    await pg.query('COMMIT');
    console.log('Datos copiados y verificados por tabla.');
  }
} catch (error) {
  await pg.query('ROLLBACK').catch(() => {});
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
} finally {
  await source.end();
  await pg.end();
}
