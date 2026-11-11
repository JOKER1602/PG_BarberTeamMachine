// Designa o retira operadores de la plataforma SaaS (tabla platform_administrators).
//
//   node scripts/platform-admin.mjs agregar correo@dominio.com
//   node scripts/platform-admin.mjs quitar  correo@dominio.com
//   node scripts/platform-admin.mjs listar
//
// La persona debe tener una cuenta activa. Ser operador permite crear y
// suspender barberías desde /platform, pero NO ver los datos de ninguna
// barbería (para eso hace falta una membresía en ella).
// Usa la conexión de backend/.env. Se ejecuta en el servidor, nunca desde la web.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend');
const require = createRequire(path.join(backend, 'package.json'));
require('dotenv').config({ path: path.join(backend, '.env') });

const [action, rawEmail] = process.argv.slice(2);
const email = rawEmail?.toLowerCase().trim();
if (!['agregar', 'quitar', 'listar'].includes(action) || (action !== 'listar' && !email)) {
  console.error('Uso: node scripts/platform-admin.mjs <agregar|quitar> <correo>  |  node scripts/platform-admin.mjs listar');
  process.exit(1);
}

const { default: pool } = await import(pathToFileURL(path.join(backend, 'src/config/database.js')).href);

try {
  if (action === 'listar') {
    const [rows] = await pool.execute('SELECT u.email, p.created_at AS desde FROM platform_administrators p JOIN users u ON u.id = p.user_id ORDER BY p.created_at');
    console.log(rows.length ? rows.map((row) => `- ${row.email} (desde ${new Date(row.desde).toISOString().slice(0, 10)})`).join('\n') : 'No hay operadores de plataforma.');
  } else {
    const [[user]] = await pool.execute('SELECT id, is_active AS "isActive" FROM users WHERE email = ?', [email]);
    if (!user) throw new Error(`No existe una cuenta con el correo ${email}. Debe registrarse primero.`);
    if (action === 'agregar') {
      if (!user.isActive) throw new Error('La cuenta está desactivada.');
      await pool.execute('INSERT INTO platform_administrators (user_id) VALUES (?) ON CONFLICT DO NOTHING', [user.id]);
      console.log(`${email} es operador de la plataforma. Puede entrar a /platform.`);
    } else {
      const [result] = await pool.execute('DELETE FROM platform_administrators WHERE user_id = ?', [user.id]);
      console.log(result.affectedRows ? `${email} ya no es operador de la plataforma.` : `${email} no era operador.`);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
