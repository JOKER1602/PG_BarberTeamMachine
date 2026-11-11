// Respaldo de la base PostgreSQL (y opcionalmente de las subidas).
//
//   npm run db:backup                      → backups/reservas-<fecha>.sql.gz
//   BACKUP_DIR=/ruta npm run db:backup     → otra carpeta
//   BACKUP_KEEP_DAYS=14 npm run db:backup  → borra respaldos más antiguos
//   npm run db:backup -- --con-archivos    → además copia UPLOADS_DIR (.tar.gz)
//
// Conexión: MIGRATION_DATABASE_URL o DATABASE_URL. Usa pg_dump (PG_DUMP_PATH si no
// está en el PATH; debe ser de versión igual o mayor a la del servidor). La
// contraseña viaja por variable de entorno, nunca por la línea de comandos.
// Restaurar en una base vacía:
//   gunzip -c respaldo.sql.gz | psql "postgresql://..." -v ON_ERROR_STOP=1
//
// Un respaldo solo cuenta si se probó restaurarlo: hazlo al menos una vez al mes
// sobre una base de prueba.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const require = createRequire(path.join(backend, 'package.json'));
require('dotenv').config({ path: path.join(backend, '.env') });

const outputDir = path.resolve(process.env.BACKUP_DIR ?? path.join(root, 'backups'));
const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 30);
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const schema = process.env.DATABASE_SCHEMA || 'reservas';
mkdirSync(outputDir, { recursive: true });

function run(command, args, { env, outputFile }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const done = outputFile ? pipeline(child.stdout, createGzip(), createWriteStream(outputFile)) : Promise.resolve();
    child.on('error', reject);
    child.on('close', async (code) => {
      await done.catch(reject);
      if (code === 0) resolve(); else reject(new Error(stderr.trim() || `${command} terminó con código ${code}`));
    });
  });
}

try {
  const connection = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!connection) throw new Error('Define MIGRATION_DATABASE_URL o DATABASE_URL.');
  const url = new URL(connection);
  const dumpFile = path.join(outputDir, `${schema}-${stamp}.sql.gz`);
  await run(process.env.PG_DUMP_PATH ?? 'pg_dump', ['--schema', schema, '--no-owner', '--no-privileges'], {
    env: {
      PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
      PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
      ...(String(process.env.DATABASE_SSL).toLowerCase() === 'true' ? { PGSSLMODE: 'require' } : {})
    },
    outputFile: dumpFile
  });
  console.log(`Base respaldada: ${dumpFile} (${Math.round(statSync(dumpFile).size / 1024)} KB)`);

  if (process.argv.includes('--con-archivos')) {
    const uploads = path.resolve(process.env.UPLOADS_DIR || path.join(backend, 'uploads'));
    if (!existsSync(uploads)) throw new Error(`No existe la carpeta de subidas ${uploads}`);
    const filesArchive = path.join(outputDir, `uploads-${stamp}.tar.gz`);
    await run('tar', ['-czf', filesArchive, '-C', path.dirname(uploads), path.basename(uploads)], {});
    console.log(`Archivos respaldados: ${filesArchive} (${Math.round(statSync(filesArchive).size / 1024)} KB)`);
  }

  const limit = Date.now() - keepDays * 86_400_000;
  for (const name of readdirSync(outputDir)) {
    const file = path.join(outputDir, name);
    if (/\.(sql|tar)\.gz$/.test(name) && statSync(file).mtimeMs < limit) {
      rmSync(file);
      console.log(`Eliminado por antigüedad (> ${keepDays} días): ${name}`);
    }
  }
} catch (error) {
  console.error(`Respaldo fallido: ${error.message}`);
  process.exitCode = 1;
}
