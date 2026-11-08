// Respaldo de la base MySQL (y opcionalmente de las subidas).
//
//   npm run db:backup                      → backups/<base>-<fecha>.sql.gz
//   BACKUP_DIR=/ruta npm run db:backup     → otra carpeta
//   BACKUP_KEEP_DAYS=14 npm run db:backup  → borra respaldos más antiguos
//   npm run db:backup -- --con-archivos    → además copia UPLOADS_DIR (.tar.gz)
//
// Usa la conexión de backend/.env y la herramienta mysqldump (MYSQLDUMP_PATH si
// no está en el PATH). La contraseña viaja por variable de entorno, nunca por
// la línea de comandos. Restaurar:
//   gunzip -c respaldo.sql.gz | mysql -h HOST -u USUARIO -p NOMBRE_BASE
//
// Un respaldo solo cuenta si se probó restaurarlo: hazlo al menos una vez al
// mes sobre una base de prueba. Si el proveedor de MySQL ofrece respaldos
// automáticos, actívalos además de este script.
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

const database = process.env.DATABASE_NAME ?? 'barber_team_machine';
const outputDir = path.resolve(process.env.BACKUP_DIR ?? path.join(root, 'backups'));
const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 30);
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
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
  const dumpFile = path.join(outputDir, `${database}-${stamp}.sql.gz`);
  await run(process.env.MYSQLDUMP_PATH ?? 'mysqldump', [
    '-h', process.env.DATABASE_HOST ?? 'localhost', '-P', String(process.env.DATABASE_PORT ?? 3306), '-u', process.env.DATABASE_USER ?? 'root',
    '--single-transaction', '--routines', '--triggers', '--default-character-set=utf8mb4', '--set-gtid-purged=OFF', '--databases', database,
    ...(String(process.env.DATABASE_SSL).toLowerCase() === 'true' ? ['--ssl-mode=REQUIRED'] : [])
  ], { env: { MYSQL_PWD: process.env.DATABASE_PASSWORD ?? '' }, outputFile: dumpFile });
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
